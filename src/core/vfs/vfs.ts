import type { FileOrigin, Snapshot, VDir, VFile } from '@/types/vfs';
import { db, isDbAvailable } from './db';
import { PathError, dirname, isAncestor, joinPath, normalizePath, segments } from './paths';
import { buildBinaryFile, buildTextFile, decodeUtf8, encodeUtf8, looksBinary } from './file';
import { sha256Hex } from '@/lib/hash';

export const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024;

export class VfsError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'VfsError';
  }
}

export interface WriteOptions {
  origin?: FileOrigin;
  reason?: string;
  patchId?: string;
  skipSnapshot?: boolean;
}

type Listener = (paths: string[]) => void;

/**
 * Sistema de arquivos virtual. Persiste em IndexedDB via Dexie e
 * guarda snapshots para undo/redo infinito e recuperacao de patch.
 */
export class Vfs {
  private listeners = new Set<Listener>();
  private writeQueue: Promise<unknown> = Promise.resolve();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(paths: string[]): void {
    for (const fn of this.listeners) fn(paths);
  }

  private assertReady(): void {
    if (!isDbAvailable()) {
      throw new VfsError('VFS requer IndexedDB (indisponivel neste contexto)', 'no-idb');
    }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn, fn);
    this.writeQueue = next.catch(() => {});
    return next;
  }

  async init(): Promise<void> {
    this.assertReady();
    await db().open();
  }

  async listFiles(): Promise<VFile[]> {
    this.assertReady();
    return db().files.toArray();
  }

  async listDirs(): Promise<VDir[]> {
    this.assertReady();
    return db().dirs.toArray();
  }

  async stat(path: string): Promise<VFile | VDir | null> {
    this.assertReady();
    const p = normalizePath(path);
    const file = await db().files.get(p);
    if (file) return file;
    return (await db().dirs.get(p)) ?? null;
  }

  async exists(path: string): Promise<boolean> {
    this.assertReady();
    const p = normalizePath(path);
    return (await db().files.get(p)) !== undefined || (await db().dirs.get(p)) !== undefined;
  }

  async isFile(path: string): Promise<boolean> {
    this.assertReady();
    return (await db().files.get(normalizePath(path))) !== undefined;
  }

  async readText(path: string): Promise<string | null> {
    this.assertReady();
    const file = await db().files.get(normalizePath(path));
    if (!file) return null;
    if (file.content !== null) return file.content;
    if (file.blob) return decodeUtf8(file.blob);
    return null;
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    this.assertReady();
    const file = await db().files.get(normalizePath(path));
    if (!file) return null;
    if (file.blob) return file.blob;
    if (file.content !== null) return encodeUtf8(file.content);
    return new Uint8Array(0);
  }

  private async snapshot(file: VFile, options: WriteOptions): Promise<void> {
    if (options.skipSnapshot) return;
    const snap: Snapshot = {
      id: `${file.path}@${file.version}::${Date.now()}`,
      path: file.path,
      version: file.version,
      hash: file.hash,
      content: file.content,
      reason: options.reason ?? 'write',
      createdAt: Date.now(),
      origin: options.origin ?? 'user',
      ...(options.patchId ? { patchId: options.patchId } : {}),
    };
    await db().snapshots.add(snap);
  }

  private async ensureDirs(path: string): Promise<void> {
    const segs = segments(path);
    const dirs: VDir[] = [];
    let acc = '';
    for (let i = 0; i < segs.length - 1; i++) {
      acc = acc ? `${acc}/${segs[i]}` : (segs[i] as string);
      dirs.push({ path: acc, kind: 'dir', children: [], updatedAt: Date.now() });
    }
    if (dirs.length > 0) await db().dirs.bulkPut(dirs);
  }

  async writeText(path: string, content: string, options: WriteOptions = {}): Promise<VFile> {
    this.assertReady();
    const p = normalizePath(path);
    return this.serialize(async () => {
      const existing = await db().files.get(p);
      if (existing) await this.snapshot(existing, options);
      const next = await buildTextFile(p, content);
      next.version = (existing?.version ?? 0) + 1;
      next.updatedAt = Date.now();
      await this.ensureDirs(p);
      await db().files.put(next);
      this.emit([p]);
      return next;
    });
  }

  async writeBytes(path: string, bytes: Uint8Array, options: WriteOptions = {}): Promise<VFile> {
    this.assertReady();
    const p = normalizePath(path);
    return this.serialize(async () => {
      const existing = await db().files.get(p);
      if (existing) await this.snapshot(existing, options);
      const next = looksBinary(bytes) && !isProbablyText(bytes)
        ? await buildBinaryFile(p, bytes)
        : await buildTextFile(p, decodeUtf8(bytes));
      next.version = (existing?.version ?? 0) + 1;
      next.updatedAt = Date.now();
      await this.ensureDirs(p);
      await db().files.put(next);
      this.emit([p]);
      return next;
    });
  }

  async mkdir(path: string): Promise<VDir> {
    this.assertReady();
    const p = normalizePath(path);
    return this.serialize(async () => {
      await this.ensureDirs(`${p}/x`);
      const dir: VDir = { path: p, kind: 'dir', children: [], updatedAt: Date.now() };
      await db().dirs.put(dir);
      this.emit([p]);
      return dir;
    });
  }

  async delete(path: string, options: WriteOptions = {}): Promise<boolean> {
    this.assertReady();
    const p = normalizePath(path);
    return this.serialize(async () => {
      const file = await db().files.get(p);
      if (file) {
        await this.snapshot(file, { ...options, reason: options.reason ?? 'delete' });
        await db().files.delete(p);
        this.emit([p]);
        return true;
      }
      const dir = await db().dirs.get(p);
      if (!dir) return false;
      const children = await this.list(p);
      for (const child of children) {
        await this.delete(child.path, { ...options, skipSnapshot: true });
      }
      await db().dirs.delete(p);
      this.emit([p]);
      return true;
    });
  }

  async rename(from: string, to: string, options: WriteOptions = {}): Promise<void> {
    this.assertReady();
    const src = normalizePath(from);
    const rawDst = to.endsWith('/') ? `${to}x` : to;
    const dst = normalizePath(rawDst);
    if (src === dst) return;
    if (isAncestor(src, dst)) {
      throw new PathError(`Nao pode mover ${src} para dentro de si mesmo`);
    }
    await this.serialize(async () => {
      const file = await db().files.get(src);
      if (file) {
        const bytes = file.content !== null ? encodeUtf8(file.content) : (file.blob ?? new Uint8Array(0));
        await this.writeBytes(dst, bytes, { ...options, reason: options.reason ?? 'rename' });
        await this.delete(src, { ...options, skipSnapshot: true });
        return;
      }
      const children = await this.list(src);
      if (children.length === 0 && !(await db().dirs.get(src))) {
        throw new VfsError(`Caminho inexistente: ${src}`, 'not-found');
      }
      for (const child of children) {
        const suffix = child.path.slice(src.length + 1);
        await this.rename(child.path, joinPath(dst, suffix), { ...options, skipSnapshot: true });
      }
      await db().dirs.delete(src);
      this.emit([src, dst]);
    });
  }

  async list(dirPath: string): Promise<Array<{ path: string; kind: 'file' | 'dir' }>> {
    this.assertReady();
    const prefix = dirPath === '' || dirPath === '.' ? '' : `${normalizePath(dirPath)}/`;
    const [files, dirs] = await Promise.all([db().files.toArray(), db().dirs.toArray()]);
    const out: Array<{ path: string; kind: 'file' | 'dir' }> = [];
    for (const d of dirs) {
      if (d.path.startsWith(prefix)) out.push({ path: d.path, kind: 'dir' });
    }
    for (const f of files) {
      if (f.path.startsWith(prefix)) out.push({ path: f.path, kind: 'file' });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async tree(): Promise<{ files: string[]; dirs: string[] }> {
    this.assertReady();
    const [files, dirs] = await Promise.all([db().files.toArray(), db().dirs.toArray()]);
    return {
      files: files.map((f) => f.path).sort(),
      dirs: dirs.map((d) => d.path).sort(),
    };
  }

  async hashOf(path: string): Promise<string | null> {
    this.assertReady();
    const file = await db().files.get(normalizePath(path));
    return file?.hash ?? null;
  }

  async snapshotsFor(path: string, limit = 50): Promise<Snapshot[]> {
    this.assertReady();
    const p = normalizePath(path);
    const rows = await db().snapshots.where('path').equals(p).reverse().limit(limit).toArray();
    return rows;
  }

  async restoreSnapshot(id: string): Promise<VFile | null> {
    this.assertReady();
    return this.serialize(async () => {
      const snap = await db().snapshots.get(id);
      if (!snap) return null;
      const p = snap.path;
      if (snap.content === null) {
        const current = await db().files.get(p);
        if (current) {
          await this.snapshot(current, { reason: 'pre-restore' });
          await db().files.delete(p);
        }
        await this.emit([p]);
        return null;
      }
      const restored = await this.writeText(p, snap.content, { reason: 'restore' });
      return restored;
    });
  }

  async computeProjectHash(): Promise<string> {
    this.assertReady();
    const files = await db().files.toArray();
    files.sort((a, b) => a.path.localeCompare(b.path));
    const parts: string[] = [];
    for (const f of files) parts.push(`${f.path}:${f.hash}`);
    return sha256Hex(parts.join('\n'));
  }

  async clear(): Promise<void> {
    this.assertReady();
    await this.serialize(async () => {
      await Promise.all([
        db().files.clear(),
        db().dirs.clear(),
        db().snapshots.clear(),
        db().journal.clear(),
        db().messages.clear(),
      ]);
      this.emit(['*']);
    });
  }

  async usage(): Promise<{ files: number; bytes: number }> {
    this.assertReady();
    const files = await db().files.toArray();
    return {
      files: files.length,
      bytes: files.reduce((acc, f) => acc + f.size, 0),
    };
  }

  async quota(): Promise<{ usage: number; quota: number } | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  }
}

function isProbablyText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i] as number;
    if (b === 0) return false;
  }
  return true;
}

let vfsInstance: Vfs | null = null;

export function vfs(): Vfs {
  if (!vfsInstance) vfsInstance = new Vfs();
  return vfsInstance;
}

export { dirname, normalizePath };
