import { sha256Hex } from '@/lib/hash';
import { countChangedLines } from './diff';
import { db, type CommitDbRow as CommitRow } from '../vfs/db';

export type ChangeKind = 'add' | 'modify' | 'delete' | 'rename';

export interface FileState {
  path: string;
  content: string | null;
  hash: string;
}

export interface Commit {
  id: string;
  message: string;
  createdAt: number;
  /** Hash do commit: sha256 do pai + da arvore. */
  hash: string;
  parent: string | null;
  author: string;
  /** Estado completo do projeto neste commit. */
  files: FileState[];
}

export interface StagedChange {
  path: string;
  kind: ChangeKind;
  before: FileState | null;
  after: FileState | null;
  /** Numero de linhas alteradas, para exibicao. */
  added: number;
  removed: number;
}

export const GENESIS = 'GENESIS';

function commitTable(): ReturnType<typeof db>['commits'] {
  return db().commits;
}

/** Estado atual do projeto, normalizado para comparar com um commit. */
export async function currentState(): Promise<FileState[]> {
  const files = await db().files.toArray();
  return files
    .map((f) => ({ path: f.path, content: f.content, hash: f.hash }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function treeHash(files: FileState[]): Promise<string> {
  const parts = files.map((f) => `${f.path}:${f.hash}`);
  return sha256Hex(parts.join('\n'));
}

/** Commit mais recente, ou null se o repositorio esta vazio. */
export async function head(): Promise<Commit | null> {
  const rows = await commitTable().orderBy('createdAt').reverse().limit(1).toArray();
  const row = rows[0];
  return row ? rowToCommit(row) : null;
}

export async function listCommits(limit = 50): Promise<Commit[]> {
  const rows = await commitTable().orderBy('createdAt').reverse().limit(limit).toArray();
  return rows.map(rowToCommit);
}

export async function getCommit(id: string): Promise<Commit | null> {
  const row = await commitTable().get(id);
  return row ? rowToCommit(row) : null;
}

function rowToCommit(row: CommitRow): Commit {
  return {
    id: row.id,
    message: row.message,
    createdAt: row.createdAt,
    hash: row.hash,
    parent: row.parent,
    author: row.author,
    files: JSON.parse(row.payload) as FileState[],
  };
}

/**
 * Diferenca o estado do projeto contra um commit. Base para `git status`,
 * o stage e o commit.
 */
export async function diffAgainst(base: Commit | null): Promise<StagedChange[]> {
  const now = await currentState();
  const before = new Map((base?.files ?? []).map((f) => [f.path, f]));
  const after = new Map(now.map((f) => [f.path, f]));
  const changes: StagedChange[] = [];

  for (const [path, state] of after) {
    const prev = before.get(path);
    if (!prev) {
      const d = countChangedLines(null, state.content);
      changes.push({ path, kind: 'add', before: null, after: state, ...d });
      continue;
    }
    if (prev.hash !== state.hash) {
      const d = countChangedLines(prev.content, state.content);
      changes.push({ path, kind: 'modify', before: prev, after: state, ...d });
    }
  }

  for (const [path, prev] of before) {
    if (after.has(path)) continue;
    const d = countChangedLines(prev.content, null);
    changes.push({ path, kind: 'delete', before: prev, after: null, ...d });
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Cria um commit com o estado atual do projeto.
 * `only` limita o commit a esses caminhos (equivale a stage seletivo);
 * sem `only`, commita tudo.
 */
export async function commit(
  message: string,
  author = 'arcanum',
  only?: string[],
): Promise<{ commit: Commit | null; skipped: string[] }> {
  const parent = await head();
  const all = await currentState();

  const toCommit = only ? all.filter((f) => only.includes(f.path)) : all;

  // Arquivos ja versionados e inalterados ficam como estao no commit.
  const parentFiles = new Map((parent?.files ?? []).map((f) => [f.path, f]));
  const finalFiles = only ? [...parentFiles.values()].filter((f) => !only.includes(f.path)).concat(toCommit) : all;

  finalFiles.sort((a, b) => a.path.localeCompare(b.path));

  const tree = await treeHash(finalFiles);
  const hash = await sha256Hex(`${parent?.hash ?? GENESIS}|${tree}|${message}`);
  const id = `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`;

  const row: CommitRow = {
    id,
    message: message.trim() || 'sem mensagem',
    createdAt: Date.now(),
    hash,
    parent: parent?.id ?? null,
    author,
    payload: JSON.stringify(finalFiles),
  };
  await commitTable().put(row);

  const skipped = only ? all.filter((f) => !only.includes(f.path)).map((f) => f.path) : [];
  return { commit: rowToCommit(row), skipped };
}

/** Restaura o projeto ao estado de um commit. */
export async function checkout(
  id: string,
  write: (path: string, content: string | null) => Promise<void>,
): Promise<{ restored: number; removed: number }> {
  const target = await getCommit(id);
  if (!target) throw new Error(`Commit nao encontrado: ${id}`);

  const targetPaths = new Map(target.files.map((f) => [f.path, f.content]));
  const current = await db().files.toArray();

  let removed = 0;
  for (const file of current) {
    if (!targetPaths.has(file.path)) {
      await db().files.delete(file.path);
      removed++;
    }
  }

  let restored = 0;
  for (const [path, content] of targetPaths) {
    if (content === null) continue;
    const now = current.find((f) => f.path === path)?.content;
    if (now === content) continue;
    await write(path, content);
    restored++;
  }

  return { restored, removed };
}

/** Caminho de checkout para um commit a partir de um diff. */
export function checkoutPath(from: Commit | null, to: Commit | null): string[] {
  if (!from || !to) return [];
  const changed = new Set<string>();
  const before = new Map(from.files.map((f) => [f.path, f.hash]));
  for (const f of to.files) {
    if (before.get(f.path) !== f.hash) changed.add(f.path);
  }
  for (const f of from.files) {
    if (!to.files.some((t) => t.path === f.path)) changed.add(f.path);
  }
  return [...changed];
}

/** Iniciais para o avatar, a partir do nome do autor. */
export function initialsOf(author: string): string {
  const parts = author.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0]}${(parts[parts.length - 1] as string)[0]}`.toUpperCase();
}

export function isClean(changes: StagedChange[]): boolean {
  return changes.length === 0;
}