import { complete, stream, type ChatMessage, type CompletionRequest, type ToolDef } from '../ia/client';
import { getMode, type AgentMode } from './modes';
import { executeTool, toolsFor, type ToolExecutionContext } from './tools';
import { journal, type Journal } from './journal';
import { SYSTEM_PREAMBLE } from './modes';

export interface RunBudget {
  maxSteps: number;
  maxTokens: number;
  maxWallClockMs: number;
  maxPatchLines: number;
}

export const DEFAULT_BUDGET: RunBudget = {
  maxSteps: 30,
  maxTokens: 400000,
  maxWallClockMs: 15 * 60 * 1000,
  maxPatchLines: 200,
};

export interface RunConfig {
  runId: string;
  mode: AgentMode;
  goal: string;
  providerId: string;
  model: string;
  apiKey: string;
  baseUrlOverride?: string;
  budget?: Partial<RunBudget>;
  systemPrompt?: string;
  history?: ChatMessage[];
}

export interface StepReport {
  step: number;
  toolName: string | null;
  summary: string;
  tokensUsed: number;
  patchedPath: string | null;
  error: string | null;
  finished: boolean;
}

export interface RunEvents {
  onStep?: (report: StepReport) => void;
  onDelta?: (text: string) => void;
  onPatch?: (path: string, before: string, after: string) => void;
  onHeartbeat?: (info: { step: number; elapsedMs: number; tokens: number }) => void;
  onApprovalNeeded?: (path: string, reason: string) => Promise<boolean>;
  onStatus?: (status: RunStatus) => void;
}

export interface RunStatus {
  runId: string;
  status: 'running' | 'paused' | 'done' | 'failed' | 'aborted';
  step: number;
  maxSteps: number;
  tokensUsed: number;
  elapsedMs: number;
  lastSummary: string;
  patchedPaths: string[];
  error: string | null;
  resumed: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class AgentRuntime {
  private controller: AbortController | null = null;
  private tokens = 0;
  private patchedPaths: string[] = [];
  private steps = 0;
  private startedAt = 0;
  private runId = '';
  private mode: AgentMode = 'ask';

  constructor(
    private readonly ctx: ToolExecutionContext & {
      buildContext(goal: string, history: ChatMessage[]): Promise<{ system: string; userBlock: string; history: ChatMessage[] }>;
      /** Chamado a cada texto do assistente: extrai checklist, plano, etc. */
      onStepText?(text: string, runId: string): void | Promise<void>;
      /** Persiste um ponto de retorno antes do passo. */
      saveCheckpoint?(runId: string, seq: number, label: string, tokens: number): Promise<void>;
      /** Instrucoes adicionais do projeto (rules files). */
      extraSystem?(): Promise<string>;
      /** Habilita as ferramentas browser_* (ver preview). */
      browserTools?: { enabled: boolean; timeoutMs: number };
      /** Ponte para execucao de codigo (run_command). */
      exec?: import('../runtime').RuntimeToolContext;
      /** Instrucoes extras quando ha execucao disponivel. */
      runtimeInstructions?: string;
    },
    private readonly jrnl: Journal = journal(),
  ) {}

  get activeRunId(): string {
    return this.runId;
  }

  abort(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /**
   * Retoma uma run pausada a partir do journal. Nenhum passo e perdido:
   * o estado e reconstruido a partir do log append-only.
   */
  async resume(runId: string, config: RunConfig, events: RunEvents = {}): Promise<RunStatus> {
    const chain = await this.jrnl.read(runId);
    const resumedSteps = chain.filter((e) => e.type === 'step_end').length;
    const summary = chain[chain.length - 1]?.payload.summary;
    await this.jrnl.append(runId, 'resume', { fromStep: resumedSteps });
    return this.loop({ ...config, runId, startStep: resumedSteps }, events, typeof summary === 'string' ? summary : '');
  }

  async run(config: RunConfig, events: RunEvents = {}): Promise<RunStatus> {
    return this.loop({ ...config, startStep: 0 }, events, '');
  }

  private async loop(
    config: RunConfig & { startStep: number },
    events: RunEvents,
    carrySummary: string,
  ): Promise<RunStatus> {
    const mode = getMode(config.mode);
    const budget: RunBudget = { ...DEFAULT_BUDGET, maxSteps: mode.maxStepsDefault, ...config.budget };
    this.runId = config.runId;
    this.mode = config.mode;
    this.tokens = 0;
    this.patchedPaths = [];
    this.steps = config.startStep;
    this.startedAt = Date.now();
    this.controller = new AbortController();

    const projectRules = (await this.ctx.extraSystem?.()) ?? '';
    const systemPrompt = [
      SYSTEM_PREAMBLE,
      config.systemPrompt ?? mode.systemPrompt,
      projectRules ? `## Instrucoes do projeto\n${projectRules}` : '',
      this.ctx.runtimeInstructions ?? '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const tools: ToolDef[] = toolsFor(mode.id, mode.toolset, {
      browser: this.ctx.browserTools,
      exec: this.ctx.exec !== undefined,
    });
    const messages: ChatMessage[] = [
      ...(config.history ?? []),
      { role: 'user', content: config.goal },
    ];

    if (config.startStep === 0) {
      await this.jrnl.append(config.runId, 'run_start', {
        mode: mode.id,
        goal: config.goal,
        provider: config.providerId,
        model: config.model,
        budget,
      });
    }

    const emit = (status: RunStatus): void => events.onStatus?.(status);
    const status: RunStatus = {
      runId: config.runId,
      status: 'running',
      step: this.steps,
      maxSteps: budget.maxSteps,
      tokensUsed: 0,
      elapsedMs: 0,
      lastSummary: carrySummary,
      patchedPaths: [],
      error: null,
      resumed: config.startStep > 0,
    };
    emit(status);

    let finalSummary = '';
    let done = false;

    while (!done) {
      this.steps++;
      status.step = this.steps;
      status.elapsedMs = Date.now() - this.startedAt;

      if (this.steps > budget.maxSteps) {
        status.status = 'paused';
        status.error = `Limite de ${budget.maxSteps} passos atingido`;
        await this.jrnl.append(config.runId, 'pause', { reason: 'max-steps', step: this.steps });
        emit(status);
        return status;
      }
      if (this.tokens > budget.maxTokens) {
        status.status = 'paused';
        status.error = 'Limite de tokens atingido';
        await this.jrnl.append(config.runId, 'pause', { reason: 'max-tokens', tokens: this.tokens });
        emit(status);
        return status;
      }
      if (status.elapsedMs > budget.maxWallClockMs) {
        status.status = 'paused';
        status.error = 'Tempo maximo de execucao atingido';
        await this.jrnl.append(config.runId, 'pause', { reason: 'max-wallclock' });
        emit(status);
        return status;
      }

      await this.ctx.saveCheckpoint?.(config.runId, this.steps, `antes do passo ${this.steps}`, this.tokens);
      await this.jrnl.append(config.runId, 'step_start', { step: this.steps, tokens: this.tokens });
      events.onHeartbeat?.({ step: this.steps, elapsedMs: status.elapsedMs, tokens: this.tokens });

      const built = await this.ctx.buildContext(
        this.steps === 1 ? config.goal : (finalSummary || config.goal),
        messages.slice(-8),
      );

      const req: CompletionRequest = {
        providerId: config.providerId,
        model: config.model,
        apiKey: config.apiKey,
        baseUrlOverride: config.baseUrlOverride,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'system', content: built.userBlock },
          ...built.history,
        ],
        tools: tools.length > 0 ? tools : undefined,
        temperature: 0.2,
        maxTokens: 8192,
        stream: true,
        signal: this.controller.signal,
      };

      await this.jrnl.append(config.runId, 'llm_call', { step: this.steps, model: config.model, provider: config.providerId });

      let assistantText = '';
      let toolCalls: ChatMessage['toolCalls'] = [];
      try {
        const result = await new Promise<{ content: string; toolCalls: NonNullable<ChatMessage['toolCalls']> }>((resolve, reject) => {
          let acc = '';
          const calls: NonNullable<ChatMessage['toolCalls']> = [];
          stream(req, {
            onDelta: (chunk) => {
              acc += chunk;
              events.onDelta?.(chunk);
            },
            onToolCall: (call) => {
              calls.push(call);
            },
            onDone: (done2) => {
              this.tokens += done2.promptTokens + done2.completionTokens;
              if (acc) resolve({ content: acc, toolCalls: calls });
              else resolve({ content: done2.content, toolCalls: calls.length ? calls : (done2.toolCalls as never) });
            },
            onError: reject,
          }).catch(reject);
        });
        assistantText = result.content;
        toolCalls = result.toolCalls;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await this.jrnl.append(config.runId, 'error', { step: this.steps, message: msg });
        status.status = this.controller.signal.aborted ? 'aborted' : 'failed';
        status.error = msg;
        emit(status);
        return status;
      }

      await this.jrnl.append(config.runId, 'token_usage', {
        step: this.steps,
        total: this.tokens,
      });

      if (assistantText) await this.ctx.onStepText?.(assistantText, config.runId);

      messages.push({ role: 'assistant', content: assistantText, ...(toolCalls.length ? { toolCalls } : {}) });

      const stepReport: StepReport = {
        step: this.steps,
        toolName: null,
        summary: assistantText.slice(0, 400),
        tokensUsed: this.tokens,
        patchedPath: null,
        error: null,
        finished: false,
      };

      if (toolCalls.length === 0) {
        finalSummary = assistantText;
        done = true;
        stepReport.finished = true;
        await this.jrnl.append(config.runId, 'step_end', { step: this.steps, summary: assistantText.slice(0, 2000), finished: true });
        await this.jrnl.append(config.runId, 'run_end', { summary: assistantText.slice(0, 4000), steps: this.steps, tokens: this.tokens });
        events.onStep?.(stepReport);
        status.status = 'done';
        status.lastSummary = assistantText;
        emit(status);
        return status;
      }

      for (const call of toolCalls) {
        stepReport.toolName = call.name;
        await this.jrnl.append(config.runId, 'step_end', { step: this.steps, tool: call.name, summary: 'tool call', finished: false });

        if (call.name === 'finish') {
          finalSummary = String(call.arguments.summary ?? '');
          done = true;
          stepReport.finished = true;
          await this.jrnl.append(config.runId, 'run_end', { summary: finalSummary, steps: this.steps, tokens: this.tokens });
          break;
        }

        const patchPath = typeof call.arguments.path === 'string' ? call.arguments.path : null;
        if (patchPath) {
          const current = await this.ctx.read(patchPath);
          const newLines = typeof call.arguments.text === 'string' ? String(call.arguments.text).split('\n').length : (typeof call.arguments.content === 'string' ? String(call.arguments.content).split('\n').length : 0);
          const currentLines = current ? current.split('\n').length : 0;
          if (newLines > budget.maxPatchLines || Math.abs(newLines - currentLines) > budget.maxPatchLines) {
            const approved = events.onApprovalNeeded
              ? await events.onApprovalNeeded(patchPath, `Patch grande (${currentLines} -> ${newLines} linhas) exige aprovacao`)
              : false;
            if (!approved) {
              const denial = `Patch em ${patchPath} rejeitado: aguardava aprovacao humana (patch grande).`;
              messages.push({ role: 'tool', content: denial, toolCallId: call.id, name: call.name });
              await this.jrnl.append(config.runId, 'pause', { reason: 'approval-denied', path: patchPath });
              stepReport.error = denial;
              continue;
            }
          }
        }

        const result = await executeTool(call.name, call.arguments, this.ctx);
        messages.push({
          role: 'tool',
          content: result.ok ? result.summary : `ERRO: ${result.summary}`,
          toolCallId: call.id,
          name: call.name,
        });
        stepReport.summary = result.summary.slice(0, 400);
        if (!result.ok) stepReport.error = result.summary;

        if (result.patchPath) {
          stepReport.patchedPath = result.patchPath;
          this.patchedPaths.push(result.patchPath);
          await this.jrnl.append(config.runId, 'patch', { step: this.steps, path: result.patchPath, tool: call.name });
        }
      }

      status.patchedPaths = [...this.patchedPaths];
      status.tokensUsed = this.tokens;
      status.lastSummary = stepReport.summary;
      events.onStep?.(stepReport);
      emit(status);

      const delay = Math.min(8000, 300 * 2 ** Math.min(4, this.steps - 1)) + Math.floor(Math.random() * 200);
      await sleep(delay);
    }

    status.status = 'done';
    status.patchedPaths = [...this.patchedPaths];
    status.tokensUsed = this.tokens;
    status.lastSummary = finalSummary;
    emit(status);
    return status;
  }
}

export function newRunId(): string {
  return `run_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export { complete };