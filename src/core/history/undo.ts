import { sha256Hex } from '@/lib/hash';
import { db, type HistoryDbRow as HistoryRow } from '../vfs/db';

export type HistoryActor = 'human' | 'agent' | 'system';
export type HistoryOp = 'write' | 'create' | 'delete' | 'rename';

export interface FileSnapshot {
  path: string;
  content: string | null;
}

export interface HistoryEntry {
  id: string;
  seq: number;
  ts: number;
  actor: HistoryActor;
  op: HistoryOp;
  paths: string[];
  /** Estado anterior: e o que undo restaura. */
  before: FileSnapshot[];
  /** Estado posterior: e o que redo reaplica. */
  after: FileSnapshot[];
  label: string;
  runId: string | null;
  patchId: string | null;
  undone: boolean;
}

export type ApplyState = (snapshots: FileSnapshot[]) => Promise<void>;

const MAX_HISTORY = 500;

let counter = 0;
function nextId(): string {
  counter = (counter + 1) % 1e6;
  return `h${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * Historico unificado de alteracoes.
 *
 * Antes, a edicao humana vivia nos snapshots do VFS e a do agente no
 * journal, o que impedia um Ctrl+Z que atravessasse os dois. Aqui toda
 * escrita passa por `record`, guardando o estado ANTES e DEPOIS de cada
 * operacao - assim undo e redo sao a mesma operacao, independente de
 * quem fez a mudanca.
 */
export class History {
  private seq = 0;

  async init(): Promise<void> {
    const row = await db().history.orderBy('seq').last();
    this.seq = row?.seq ?? 0;
  }

  async record(input: {
    actor: HistoryActor;
    op: HistoryOp;
    before: FileSnapshot[];
    after: FileSnapshot[];
    label?: string;
    runId?: string | null;
    patchId?: string | null;
  }): Promise<HistoryEntry> {
    this.seq += 1;

    const paths = [...new Set([...input.before.map((b) => b.path), ...input.after.map((a) => a.path)])];
    const entry: HistoryEntry = {
      id: nextId(),
      seq: this.seq,
      ts: Date.now(),
      actor: input.actor,
      op: input.op,
      paths,
      before: input.before,
      after: input.after,
      label: input.label ?? describe(input.op, paths),
      runId: input.runId ?? null,
      patchId: input.patchId ?? null,
      undone: false,
    };

    await db().history.put(toRow(entry));
    await this.trim();
    return entry;
  }

  private async trim(): Promise<void> {
    const count = await db().history.count();
    if (count <= MAX_HISTORY) return;
    const old = await db().history.orderBy('seq').limit(count - MAX_HISTORY).primaryKeys();
    await db().history.bulkDelete(old);
  }

  /** Entradas da mais recente para a mais antiga. */
  async list(limit = 100): Promise<HistoryEntry[]> {
    const rows = await db().history.orderBy('seq').reverse().limit(limit).toArray();
    return rows.map(rowToEntry);
  }

  async lastApplied(): Promise<HistoryEntry | null> {
    const row = await db().history.orderBy('seq').reverse().filter((r) => !r.undone).first();
    return row ? rowToEntry(row) : null;
  }

  /**
   * Entrada desfeita mais ANTIGA. Undo desfaz do mais novo para o mais
   * velho, entao redo precisa refazer na ordem inversa - usar a mais
   * nova aqui desfaria e refaria a mesma entrada duas vezes.
   */
  async lastUndone(): Promise<HistoryEntry | null> {
    const row = await db().history.orderBy('seq').filter((r) => r.undone).first();
    return row ? rowToEntry(row) : null;
  }

  async canUndo(): Promise<boolean> {
    return (await this.lastApplied()) !== null;
  }

  async canRedo(): Promise<boolean> {
    return (await this.lastUndone()) !== null;
  }

  /** Desfaz a ultima alteracao aplicada. */
  async undo(apply: ApplyState): Promise<HistoryEntry | null> {
    const entry = await this.lastApplied();
    if (!entry) return null;
    await apply(entry.before);
    await db().history.update(entry.id, { undone: true });
    return entry;
  }

  /** Refaz a ultima alteracao desfeita. */
  async redo(apply: ApplyState): Promise<HistoryEntry | null> {
    const entry = await this.lastUndone();
    if (!entry) return null;
    await apply(entry.after);
    await db().history.update(entry.id, { undone: false });
    return entry;
  }

  /** Desfaz ou refaz uma entrada especifica (usado ao clicar no historico). */
  async jumpTo(apply: ApplyState, seq: number): Promise<HistoryEntry | null> {
    const rows = await db().history.orderBy('seq').toArray();
    const target = rows.find((r) => r.seq === seq);
    if (!target) return null;

    const entry = rowToEntry(target);
    await apply(entry.undone ? entry.after : entry.before);
    await db().history.update(entry.id, { undone: !entry.undone });
    return entry;
  }

  async clear(): Promise<void> {
    await db().history.clear();
    this.seq = 0;
  }

  async stats(): Promise<{ total: number; undone: number }> {
    const rows = await db().history.toArray();
    return { total: rows.length, undone: rows.filter((r) => r.undone).length };
  }
}

function toRow(entry: HistoryEntry): HistoryRow {
  return {
    id: entry.id,
    seq: entry.seq,
    ts: entry.ts,
    actor: entry.actor,
    op: entry.op,
    paths: entry.paths,
    payload: JSON.stringify({ before: entry.before, after: entry.after }),
    label: entry.label,
    runId: entry.runId,
    patchId: entry.patchId,
    undone: entry.undone,
  };
}

function rowToEntry(row: HistoryRow): HistoryEntry {
  const payload = JSON.parse(row.payload) as { before: FileSnapshot[]; after: FileSnapshot[] };
  return {
    id: row.id,
    seq: row.seq,
    ts: row.ts,
    actor: row.actor as HistoryActor,
    op: row.op as HistoryOp,
    paths: row.paths,
    before: payload.before,
    after: payload.after,
    label: row.label,
    runId: row.runId,
    patchId: row.patchId,
    undone: row.undone,
  };
}

function describe(op: HistoryOp, paths: string[]): string {
  const name = paths.length === 1 ? (paths[0] as string) : `${paths.length} arquivos`;
  switch (op) {
    case 'create':
      return `criou ${name}`;
    case 'delete':
      return `excluiu ${name}`;
    case 'rename':
      return `renomeou ${name}`;
    default:
      return `editou ${name}`;
  }
}

let instance: History | null = null;

export function history(): History {
  if (!instance) instance = new History();
  return instance;
}

export async function contentHash(content: string | null): Promise<string> {
  return sha256Hex(content ?? '');
}