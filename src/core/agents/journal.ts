import { db } from '../vfs/db';
import { sha256Hex } from '@/lib/hash';

export type JournalType =
  | 'run_start'
  | 'plan'
  | 'step_start'
  | 'llm_call'
  | 'patch'
  | 'patch_revert'
  | 'verify'
  | 'step_end'
  | 'heartbeat'
  | 'error'
  | 'pause'
  | 'resume'
  | 'run_end'
  | 'token_usage';

export interface JournalEvent {
  seq: number;
  runId: string;
  type: JournalType;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
  ts: number;
}

export interface RunState {
  runId: string;
  status: 'idle' | 'running' | 'paused' | 'failed' | 'done';
  step: number;
  maxSteps: number;
  goal: string;
  mode: string;
  lastSeq: number;
  pendingApproval: string | null;
  startedAt: number;
  updatedAt: number;
  error: string | null;
}

const GENESIS = 'GENESIS';

export class Journal {
  private heads = new Map<string, { seq: number; hash: string }>();

  private async head(runId: string): Promise<{ seq: number; hash: string }> {
    const cached = this.heads.get(runId);
    if (cached) return cached;
    const last = await db().journal.where('runId').equals(runId).last();
    const value = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS };
    this.heads.set(runId, value);
    return value;
  }

  async append(runId: string, type: JournalType, payload: Record<string, unknown>): Promise<JournalEvent> {
    const { seq, hash: prevHash } = await this.head(runId);
    const ts = Date.now();
    const body = JSON.stringify({ seq: seq + 1, runId, type, payload, prevHash, ts });
    const hash = await sha256Hex(body);

    const event: JournalEvent = { seq: seq + 1, runId, type, payload, prevHash, hash, ts };
    await db().journal.put({ seq: event.seq, runId, type, payload: JSON.stringify(payload), prevHash, hash, ts });
    this.heads.set(runId, { seq: event.seq, hash });
    return event;
  }

  async read(runId: string, fromSeq = 0): Promise<JournalEvent[]> {
    const rows = await db().journal.where('runId').equals(runId).sortBy('seq');
    return rows.filter((r) => r.seq > fromSeq).map((r) => ({
      seq: r.seq,
      runId: r.runId,
      type: r.type as JournalType,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      prevHash: r.prevHash,
      hash: r.hash,
      ts: r.ts,
    }));
  }

  async lastEvent(runId: string): Promise<JournalEvent | null> {
    const rows = await db().journal.where('runId').equals(runId).last();
    if (!rows) return null;
    return {
      seq: rows.seq,
      runId: rows.runId,
      type: rows.type as JournalType,
      payload: JSON.parse(rows.payload) as Record<string, unknown>,
      prevHash: rows.prevHash,
      hash: rows.hash,
      ts: rows.ts,
    };
  }

  async runs(): Promise<string[]> {
    const rows = await db().journal.toArray();
    return [...new Set(rows.map((r) => r.runId))].sort();
  }

  async truncate(runId: string): Promise<void> {
    await db().journal.where('runId').equals(runId).delete();
    this.heads.delete(runId);
  }

  /** Verifica a cadeia de hashes: detecta corrupcao ou edicao manual do log. */
  async verifyChain(runId: string): Promise<{ valid: boolean; brokenAt: number | null }> {
    const events = await this.read(runId);
    let prev = GENESIS;
    for (const e of events) {
      if (e.prevHash !== prev) return { valid: false, brokenAt: e.seq };
      const body = JSON.stringify({ seq: e.seq, runId: e.runId, type: e.type, payload: e.payload, prevHash: e.prevHash, ts: e.ts });
      const expected = await sha256Hex(body);
      if (expected !== e.hash) return { valid: false, brokenAt: e.seq };
      prev = e.hash;
    }
    return { valid: true, brokenAt: null };
  }
}

let journalInstance: Journal | null = null;

export function journal(): Journal {
  if (!journalInstance) journalInstance = new Journal();
  return journalInstance;
}