import type { Checkpoint, CheckpointStore } from './fast-apply';
import { db, type CheckpointRow } from '../vfs/db';

export const checkpointStore: CheckpointStore = {
  async save(cp: Checkpoint): Promise<void> {
    const row: CheckpointRow = {
      id: cp.id,
      runId: cp.runId,
      seq: cp.seq,
      label: cp.label,
      createdAt: cp.createdAt,
      payload: JSON.stringify(cp.files),
      tokens: cp.tokensAtCheckpoint,
    };
    await db().checkpoints.put(row);
  },
  async list(runId: string): Promise<Checkpoint[]> {
    const rows = await db().checkpoints.where('runId').equals(runId).sortBy('seq');
    return rows.map(rowToCheckpoint);
  },
  async get(id: string): Promise<Checkpoint | null> {
    const row = await db().checkpoints.get(id);
    return row ? rowToCheckpoint(row) : null;
  },
  async clear(runId: string): Promise<void> {
    await db().checkpoints.where('runId').equals(runId).delete();
  },
};

function rowToCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    runId: row.runId,
    seq: row.seq,
    label: row.label,
    createdAt: row.createdAt,
    files: JSON.parse(row.payload) as Checkpoint['files'],
    tokensAtCheckpoint: row.tokens,
  };
}

export async function restoreCheckpoint(
  cp: Checkpoint,
  write: (path: string, content: string | null) => Promise<void>,
): Promise<{ restored: number; deleted: number }> {
  const target = new Map(cp.files.map((f) => [f.path, f.content]));
  const current = await db().files.toArray();
  const currentPaths = new Set(current.map((f) => f.path));

  // Remove arquivos que nao existiam no checkpoint.
  let deleted = 0;
  for (const file of current) {
    if (!target.has(file.path)) {
      await db().files.delete(file.path);
      deleted++;
    }
  }

  // Reescreve o conteudo de quem mudou ou foi criado depois.
  let restored = 0;
  for (const [path, content] of target) {
    if (content === null) continue;
    const now = currentPaths.has(path) ? current.find((f) => f.path === path)?.content : undefined;
    if (now === content) continue;
    await write(path, content);
    restored++;
  }

  return { restored, deleted };
}