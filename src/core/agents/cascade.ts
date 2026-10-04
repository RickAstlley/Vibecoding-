import type { AgentMode } from './modes';
import { parseTasks } from './tasks';

export type PlanStatus = 'draft' | 'approved' | 'rejected' | 'executing' | 'done';

export interface PlanStep {
  id: string;
  /** Numero de ordem exibido. */
  order: number;
  text: string;
  targetPath: string | null;
  status: 'pending' | 'active' | 'done' | 'skipped';
  /** Caminho que este passo alterou, quando aplicavel. */
  touchedPath: string | null;
  /** Resumo do que o agente fez no passo. */
  outcome: string | null;
  tokens: number;
}

export interface CascadePlan {
  runId: string;
  goal: string;
  steps: PlanStep[];
  status: PlanStatus;
  createdAt: number;
  /** Perguntas que o agente precisa do usuario antes de agir. */
  questions: string[];
  risks: string[];
}

/**
 * Extrai um plano a partir da resposta do Planejador.
 * Aceita checklist ("- [ ] ...") e a estrutura em secoes do modo.
 */
export function parsePlan(text: string, runId: string, now = Date.now()): CascadePlan {
  const tasks = parseTasks(text, runId, now);
  const steps: PlanStep[] = tasks.map((task, index) => ({
    id: task.id,
    order: index + 1,
    text: task.text,
    targetPath: task.targetPath,
    status: task.status === 'done' ? 'done' : 'pending',
    touchedPath: null,
    outcome: null,
    tokens: 0,
  }));

  return {
    runId,
    goal: '',
    steps,
    status: 'draft',
    createdAt: now,
    questions: extractSection(text, 'Perguntas'),
    risks: extractSection(text, 'Riscos'),
  };
}

function extractSection(text: string, heading: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^#+\\s*${heading}`, 'i').test(l.trim()));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (/^#+\s/.test(line)) break;
    if (!line || /^\[[ x~-]\]/i.test(line)) continue;
    out.push(line.replace(/^[-*+]\s*/, ''));
  }
  return out;
}

export function planProgress(steps: PlanStep[]): { done: number; total: number; percent: number } {
  const total = steps.length;
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Marca o proximo passo como ativo. Idempotente. */
export function activateNext(plan: CascadePlan): CascadePlan {
  if (plan.steps.every((s) => s.status !== 'pending')) return plan;
  const steps = plan.steps.map((s) => (s.status === 'pending' && s.order === nextOrder(plan) ? { ...s, status: 'active' as const } : s));
  return { ...plan, steps };
}

function nextOrder(plan: CascadePlan): number {
  let order = 1;
  for (const step of plan.steps) {
    if (step.status === 'done' || step.status === 'skipped') order = Math.max(order, step.order + 1);
  }
  return order;
}

export function completeStep(
  plan: CascadePlan,
  stepId: string,
  outcome: { touchedPath?: string; text?: string; tokens?: number } = {},
): CascadePlan {
  const steps = plan.steps.map((s) =>
    s.id === stepId
      ? {
          ...s,
          status: 'done' as const,
          touchedPath: outcome.touchedPath ?? s.touchedPath,
          outcome: outcome.text ?? s.outcome,
          tokens: outcome.tokens ?? s.tokens,
        }
      : s,
  );
  return { ...plan, steps, status: steps.every((s) => s.status === 'done') ? 'done' : plan.status };
}

export function skipStep(plan: CascadePlan, stepId: string, reason?: string): CascadePlan {
  const steps = plan.steps.map((s) =>
    s.id === stepId ? { ...s, status: 'skipped' as const, outcome: reason ?? 'pulado' } : s,
  );
  return { ...plan, steps };
}

export function approvePlan(plan: CascadePlan): CascadePlan {
  return { ...plan, status: 'approved' };
}

export function rejectPlan(plan: CascadePlan, reason = 'rejeitado pelo usuario'): CascadePlan {
  return { ...plan, status: 'rejected', risks: [...plan.risks, reason] };
}

/** Passos que tocam o mesmo arquivo: sao sequenciais por regra do runtime. */
export function conflictingSteps(plan: CascadePlan): string[][] {
  const byPath = new Map<string, string[]>();
  for (const step of plan.steps) {
    if (!step.targetPath) continue;
    const list = byPath.get(step.targetPath) ?? [];
    list.push(step.id);
    byPath.set(step.targetPath, list);
  }
  return [...byPath.values()].filter((ids) => ids.length > 1);
}

/** Passos que rodam em paralelo (arquivos distintos). */
export function parallelizable(plan: CascadePlan, maxConcurrency = 3): string[][] {
  const groups: string[][] = [];
  for (const step of plan.steps) {
    if (step.status !== 'pending') continue;
    const conflict = conflictingSteps(plan).find((ids) => ids.includes(step.id));
    if (conflict) {
      if (!groups.includes(conflict)) groups.push(conflict);
      continue;
    }
    const existing = groups.find((g) => g.every((id) => plan.steps.find((s) => s.id === id)?.targetPath !== step.targetPath));
    if (existing) existing.push(step.id);
    else groups.push([step.id]);
  }
  return groups.filter((g) => g.length > 0).slice(0, maxConcurrency);
}

export const MODE_REQUIRES_PLAN: AgentMode[] = ['planner', 'architect'];

export function needsPlan(mode: AgentMode, toolset: string[]): boolean {
  void toolset;
  return MODE_REQUIRES_PLAN.includes(mode);
}