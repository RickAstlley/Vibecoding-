import type { StagedChange } from '../git/repo';
import type { Commit } from '../git/repo';
import { vfs } from '../vfs/vfs';

export interface WalkthroughEntry {
  index: number;
  path: string;
  kind: StagedChange['kind'];
  before: string | null;
  after: string | null;
  decision: 'pending' | 'accepted' | 'reverted';
}

export interface WalkthroughState {
  entries: WalkthroughEntry[];
  cursor: number;
  base: Commit | null;
  finished: boolean;
}

export type WalkthroughAction = 'accept' | 'revert' | 'skip' | 'undo' | 'next' | 'prev';

export interface WalkthroughResult {
  applied: string[];
  reverted: string[];
}

export function buildWalkthrough(changes: StagedChange[]): WalkthroughState {
  return {
    entries: changes.map((c, index) => ({
      index,
      path: c.path,
      kind: c.kind,
      before: c.before?.content ?? null,
      after: c.after?.content ?? null,
      decision: 'pending' as const,
    })),
    cursor: 0,
    base: null,
    finished: false,
  };
}

export function current(state: WalkthroughState): WalkthroughEntry | null {
  return state.entries[state.cursor] ?? null;
}

export function isLast(state: WalkthroughState): boolean {
  return state.cursor >= state.entries.length - 1;
}

export function pendingCount(state: WalkthroughState): number {
  return state.entries.filter((e) => e.decision === 'pending').length;
}

/** Avanca e registra a decisao. `undo` volta sem decidir. */
export function advance(state: WalkthroughState, action: WalkthroughAction): WalkthroughState {
  const entry = current(state);

  if (action === 'prev') {
    return { ...state, cursor: Math.max(0, state.cursor - 1) };
  }

  if (action === 'undo') {
    if (!entry) return state;
    const entries = state.entries.map((e) =>
      e.index === entry.index ? { ...e, decision: 'pending' as const } : e,
    );
    return { ...state, entries };
  }

  if (!entry) {
    return { ...state, finished: true };
  }

  const decision = action === 'accept' ? 'accepted' : action === 'revert' ? 'reverted' : entry.decision;
  const entries = state.entries.map((e) => (e.index === entry.index ? { ...e, decision } : e));
  const cursor = Math.min(state.cursor + 1, entries.length - 1);

  return {
    entries,
    cursor,
    base: state.base,
    finished: entries.every((e) => e.decision !== 'pending'),
  };
}

/**
 * Aplica as decisoes: aceita escreve o conteudo novo, reverte devolve
 * ao conteudo do commit base.
 */
export async function applyWalkthrough(state: WalkthroughState): Promise<WalkthroughResult> {
  const applied: string[] = [];
  const reverted: string[] = [];

  for (const entry of state.entries) {
    if (entry.decision === 'accepted') {
      if (entry.after === null) {
        await vfs().delete(entry.path, { reason: 'walkthrough aceitar exclusao' });
      } else {
        await vfs().writeText(entry.path, entry.after, { origin: 'user', reason: 'walkthrough aceitar' });
      }
      applied.push(entry.path);
      continue;
    }

    if (entry.decision === 'reverted') {
      if (entry.before === null) {
        await vfs().delete(entry.path, { reason: 'walkthrough reverter criacao' });
      } else {
        await vfs().writeText(entry.path, entry.before, { origin: 'user', reason: 'walkthrough reverter' });
      }
      reverted.push(entry.path);
    }
  }

  return { applied, reverted };
}
