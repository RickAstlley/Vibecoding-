import Dexie, { type Table } from 'dexie';
import type { Snapshot, VDir, VFile } from '@/types/vfs';

export interface ChatMessageRow {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: number;
  runId: string | null;
  tokensIn: number;
  tokensOut: number;
  compression: string | null;
  toolCalls: string | null;
}

export interface JournalRow {
  seq: number;
  runId: string;
  type: string;
  payload: string;
  prevHash: string;
  hash: string;
  ts: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  root: string;
}

export interface KvRow {
  key: string;
  value: unknown;
}

export interface HistoryDbRow {
  id: string;
  seq: number;
  ts: number;
  actor: string;
  op: string;
  paths: string[];
  payload: string;
  label: string;
  runId: string | null;
  patchId: string | null;
  undone: boolean;
}

export interface CommitDbRow {
  id: string;
  message: string;
  createdAt: number;
  hash: string;
  parent: string | null;
  author: string;
  payload: string;
}

export interface TaskRow {
  id: string;
  runId: string;
  text: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  targetPath: string | null;
  createdAt: number;
  updatedAt: number;
}

export class WeaverDatabase extends Dexie {
  files!: Table<VFile, string>;
  dirs!: Table<VDir, string>;
  snapshots!: Table<Snapshot, string>;
  messages!: Table<ChatMessageRow, string>;
  journal!: Table<JournalRow, number>;
  projects!: Table<ProjectRow, string>;
  kv!: Table<KvRow, string>;
  checkpoints!: Table<CheckpointRow, string>;
  tasks!: Table<TaskRow, string>;
  commits!: Table<CommitDbRow, string>;
  history!: Table<HistoryDbRow, string>;

  constructor(name = 'arcanum-weaver') {
    super(name);
    this.version(1).stores({
      files: '&path, hash, updatedAt, encoding, size',
      dirs: '&path, updatedAt',
      snapshots: '&id, path, version, createdAt, [path+version], patchId',
      messages: '&id, createdAt, runId, role',
      journal: '&[runId+seq], runId, ts, type, hash',
      projects: '&id, updatedAt',
      kv: '&key',
    });
    this.version(2).stores({
      files: '&path, hash, updatedAt, encoding, size',
      dirs: '&path, updatedAt',
      snapshots: '&id, path, version, createdAt, [path+version], patchId',
      messages: '&id, createdAt, runId, role',
      journal: '&[runId+seq], runId, ts, type, hash',
      projects: '&id, updatedAt',
      kv: '&key',
      checkpoints: '&id, runId, seq, createdAt',
      tasks: '&id, runId, status, createdAt',
    });
    this.version(3).stores({
      files: '&path, hash, updatedAt, encoding, size',
      dirs: '&path, updatedAt',
      snapshots: '&id, path, version, createdAt, [path+version], patchId',
      messages: '&id, createdAt, runId, role',
      journal: '&[runId+seq], runId, ts, type, hash',
      projects: '&id, updatedAt',
      kv: '&key',
      checkpoints: '&id, runId, seq, createdAt',
      tasks: '&id, runId, status, createdAt',
      commits: '&id, createdAt, parent, hash',
    });
    this.version(4).stores({
      files: '&path, hash, updatedAt, encoding, size',
      dirs: '&path, updatedAt',
      snapshots: '&id, path, version, createdAt, [path+version], patchId',
      messages: '&id, createdAt, runId, role',
      journal: '&[runId+seq], runId, ts, type, hash',
      projects: '&id, updatedAt',
      kv: '&key',
      checkpoints: '&id, runId, seq, createdAt',
      tasks: '&id, runId, status, createdAt',
      commits: '&id, createdAt, parent, hash',
      history: '&id, seq, ts, actor, undone, [actor+seq]',
    });
  }
}

export interface CheckpointRow {
  id: string;
  runId: string;
  seq: number;
  label: string;
  createdAt: number;
  payload: string;
  tokens: number;
}

let instance: WeaverDatabase | null = null;

export function db(): WeaverDatabase {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB indisponivel neste ambiente');
  }
  if (!instance) instance = new WeaverDatabase();
  return instance;
}

export function isDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
