import type { AgentRuntime } from './runtime';
import { newRunId } from './runtime';

export interface AgentJob {
  id: string;
  goal: string;
  /** Arquivos que este job pode tocar. Vazio = sem restricao. */
  files: string[];
  mode: string;
  providerId: string;
  model: string;
  apiKey: string;
  baseUrlOverride?: string;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'blocked' | 'cancelled';

export interface JobState {
  id: string;
  goal: string;
  files: string[];
  status: JobStatus;
  runId: string | null;
  step: number;
  tokensUsed: number;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  summary: string;
}

export interface SchedulerOptions {
  maxConcurrent: number;
  /**
   * Um patch so e aceito se o job for dono exclusivo do arquivo.
   * Esta e a mesma garantia do patch singular, estendida para varios jobs.
   */
  exclusiveFileLocks: boolean;
}

export const DEFAULT_SCHEDULER: SchedulerOptions = {
  maxConcurrent: 3,
  exclusiveFileLocks: true,
};

/** Um job pode rodar agora? Nao ha lock em nenhum dos seus arquivos. */
export function canStart(job: AgentJob, locks: Map<string, string>): boolean {
  if (job.files.length === 0) return false;
  for (const file of job.files) {
    if (locks.has(file)) return false;
  }
  return true;
}

/** Jobs que disputam o mesmo arquivo: nunca rodam juntos. */
export function conflicts(a: AgentJob, b: AgentJob): boolean {
  if (a.files.length === 0 || b.files.length === 0) return false;
  const setB = new Set(b.files);
  return a.files.some((f) => setB.has(f));
}

/**
 * Monta os grupos que podem rodar em paralelo.
 * Jobs conflitantes ficam no mesmo grupo, que roda em sequencia.
 */
export function buildBatches(jobs: AgentJob[], maxConcurrent = DEFAULT_SCHEDULER.maxConcurrent): AgentJob[][] {
  const batches: AgentJob[][] = [];
  const used = new Set<string>();

  for (const job of jobs) {
    if (used.has(job.id)) continue;
    const batch = [job];
    used.add(job.id);
    for (const other of jobs) {
      if (used.has(other.id)) continue;
      if (conflicts(job, other)) continue;
      if (batch.length >= maxConcurrent) break;
      batch.push(other);
      used.add(other.id);
    }
    batches.push(batch);
  }

  return batches;
}

/** Detecta jobs que nunca podem rodar juntos por disputarem arquivo. */
export function deadlocks(jobs: AgentJob[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const job of jobs) {
    for (const file of job.files) {
      const list = groups.get(file) ?? [];
      list.push(job.id);
      groups.set(file, list);
    }
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

/** Estado inicial de um job. */
export function initialState(job: AgentJob): JobState {
  return {
    id: job.id,
    goal: job.goal,
    files: job.files,
    status: 'queued',
    runId: null,
    step: 0,
    tokensUsed: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    summary: '',
  };
}

export interface SchedulerEvents {
  onChange?(states: JobState[]): void;
  onJobStart?(state: JobState): void;
  onJobEnd?(state: JobState): void;
}

/**
 * Executa uma fila de jobs respeitando exclusividade de arquivo.
 * Cada job so recebe o contexto dos proprios arquivos, para nao cruzar
 * linhas entre agentes que estao mexendo em arquivos diferentes.
 */
export class AgentScheduler {
  private states = new Map<string, JobState>();
  private running = new Set<string>();
  private aborted = false;

  constructor(
    private readonly options: SchedulerOptions = DEFAULT_SCHEDULER,
    private readonly events: SchedulerEvents = {},
  ) {}

  snapshot(): JobState[] {
    return [...this.states.values()];
  }

  abort(): void {
    this.aborted = true;
  }

  private emit(): void {
    this.events.onChange?.(this.snapshot());
  }

  private setState(id: string, patch: Partial<JobState>): void {
    const current = this.states.get(id);
    if (!current) return;
    this.states.set(id, { ...current, ...patch });
    this.emit();
  }

  async runAll(
    jobs: AgentJob[],
    makeRuntime: (job: AgentJob, runId: string) => AgentRuntime,
  ): Promise<JobState[]> {
    this.aborted = false;
    for (const job of jobs) this.states.set(job.id, initialState(job));
    this.emit();

    for (const job of jobs) {
      const state = this.states.get(job.id);
      if (state && state.status === 'done') continue;
    }

    const batches = buildBatches(jobs, this.options.maxConcurrent);

    for (const batch of batches) {
      if (this.aborted) break;

      await Promise.all(
        batch.map(async (job) => {
          if (this.aborted) {
            this.setState(job.id, { status: 'cancelled', finishedAt: Date.now() });
            return;
          }
          const runId = newRunId();
          const runtime = makeRuntime(job, runId);
          this.setState(job.id, { status: 'running', runId, startedAt: Date.now() });
          this.events.onJobStart?.(this.snapshot().find((s) => s.id === job.id) as JobState);

          try {
            const result = await runtime.run(
              {
                runId,
                mode: job.mode as never,
                goal: job.goal,
                providerId: job.providerId,
                model: job.model,
                apiKey: job.apiKey,
                baseUrlOverride: job.baseUrlOverride,
                budget: { maxSteps: 12 },
              },
              {
                onStatus: (status) => {
                  if (status.step !== this.states.get(job.id)?.step || status.tokensUsed !== this.states.get(job.id)?.tokensUsed) {
                    this.setState(job.id, { step: status.step, tokensUsed: status.tokensUsed });
                  }
                },
              },
            );

            const finished: JobState = {
              ...(this.states.get(job.id) as JobState),
              status: result.status === 'done' ? 'done' : result.status === 'paused' ? 'blocked' : 'failed',
              error: result.error,
              finishedAt: Date.now(),
              summary: result.lastSummary.slice(0, 400),
              step: result.step,
              tokensUsed: result.tokensUsed,
            };
            this.states.set(job.id, finished);
            this.events.onJobEnd?.(finished);
          } catch (e) {
            const failed: JobState = {
              ...(this.states.get(job.id) as JobState),
              status: 'failed',
              error: e instanceof Error ? e.message : String(e),
              finishedAt: Date.now(),
            };
            this.states.set(job.id, failed);
            this.events.onJobEnd?.(failed);
          } finally {
            this.running.delete(job.id);
            runtime.abort();
          }
        }),
      );
    }

    return this.snapshot();
  }
}