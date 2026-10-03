import { unzip, zip, type Unzipped, type Zippable } from 'fflate';
import type { ImportStats, ZipLimits } from './guards';
import { DEFAULT_LIMITS, ZipGuardError, shouldSkip } from './guards';
import { basename, commonAncestor, dirname, joinPath, normalizePath, tryNormalizePath } from '../vfs/paths';

export interface ExtractedEntry {
  path: string;
  bytes: Uint8Array;
}

export interface ScanResult {
  entries: Array<{ path: string; isDir: boolean; originalSize: number }>;
  rootPrefix: string;
  stats: ImportStats;
}

function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler arquivo'));
    reader.readAsArrayBuffer(file);
  });
}

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
}

function zipAsync(data: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(data, { level: 6 }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
}

/**
 * Remove o prefixo de pasta raiz de um ZIP exportado por github/ferramentas
 * (ex.: "meu-projeto-main/src/App.tsx" -> "src/App.tsx").
 */
export function detectRootPrefix(paths: string[]): string {
  const files = paths.filter((p) => !p.endsWith('/'));
  if (files.length === 0) return '';
  const first = files[0] as string;
  if (!first.includes('/')) return '';
  const candidate = commonAncestor(files);
  if (candidate === '') return '';
  const top = candidate.split('/')[0] ?? '';
  if (top === 'src' || top === 'public' || top === 'dist' || top === 'app' || top === 'pages') return '';
  return candidate;
}

export function scanZip(data: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): Promise<ScanResult> {
  return unzipAsync(data).then((entries) => {
    const rawPaths = Object.keys(entries);
    if (rawPaths.length > limits.maxFiles) {
      throw new ZipGuardError(
        `ZIP contem ${rawPaths.length} entradas, acima do limite de ${limits.maxFiles}`,
        'too-many-files',
      );
    }
    const rootPrefix = detectRootPrefix(rawPaths);
    const stats: ImportStats = {
      total: rawPaths.length,
      dirs: 0,
      files: 0,
      skipped: [],
      rootPrefix,
      totalBytes: 0,
      largest: null,
    };

    const out: Array<{ path: string; isDir: boolean; originalSize: number }> = [];
    for (const raw of rawPaths) {
      const isDir = raw.endsWith('/');
      const withoutRoot = rootPrefix && raw.startsWith(`${rootPrefix}/`) ? raw.slice(rootPrefix.length + 1) : raw;
      const normalized = tryNormalizePath(withoutRoot);
      if (!normalized) {
        stats.skipped.push(raw);
        continue;
      }
      if (shouldSkip(normalized)) {
        stats.skipped.push(raw);
        continue;
      }
      const size = entries[raw]?.byteLength ?? 0;
      if (size > limits.maxSingleFileBytes) {
        throw new ZipGuardError(`Arquivo excede limite: ${normalized} (${size} bytes)`, 'file-too-large');
      }
      if (isDir) {
        stats.dirs++;
      } else {
        stats.files++;
        stats.totalBytes += size;
        if (!stats.largest || size > stats.largest.size) stats.largest = { path: normalized, size };
        if (stats.totalBytes > limits.maxTotalBytes) {
          throw new ZipGuardError('Tamanho total descomprimido excede o limite', 'total-too-large');
        }
      }
      out.push({ path: normalized, isDir, originalSize: size });
    }

    if (stats.totalBytes > 0 && data.byteLength > 0) {
      const ratio = stats.totalBytes / Math.max(1, data.byteLength);
      if (ratio > limits.maxCompressionRatio * 20) {
        throw new ZipGuardError(`Razao de compressao suspeita (${ratio.toFixed(0)}x) - possivel zip bomb`, 'zip-bomb');
      }
    }

    return { entries: out, rootPrefix, stats };
  });
}

export async function extractZip(
  data: Uint8Array,
  limits: ZipLimits = DEFAULT_LIMITS,
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<{ entries: ExtractedEntry[]; stats: ImportStats; rootPrefix: string }> {
  const raw = await unzipAsync(data);
  const scan = await scanZip(data, limits);
  const results: ExtractedEntry[] = [];

  for (let i = 0; i < scan.entries.length; i++) {
    const entry = scan.entries[i];
    if (!entry || entry.isDir) continue;
    const bytes = raw[entry.path];
    if (!bytes) continue;
    results.push({ path: entry.path, bytes });
    onProgress?.(i + 1, scan.entries.length, entry.path);
  }

  return { entries: results, stats: scan.stats, rootPrefix: scan.rootPrefix };
}

export interface ZipSourceFile {
  path: string;
  bytes: Uint8Array;
}

export interface ZipOptions {
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  includeBinary?: boolean;
}

export async function createZip(files: ZipSourceFile[], options: ZipOptions = {}): Promise<Uint8Array> {
  const payload: Zippable = {};
  for (const file of files) {
    const path = tryNormalizePath(file.path);
    if (!path) continue;
    if (!options.includeBinary && path.endsWith('/')) continue;
    payload[path] = [file.bytes, { level: options.level ?? 6 }];
  }
  return zipAsync(payload);
}

export async function zipFromZipFile(file: File, options: ZipOptions = {}): Promise<Uint8Array> {
  const data = await readFileAsBytes(file);
  const { entries } = await extractZip(data, DEFAULT_LIMITS);
  return createZip(entries, options);
}

export function isZipFile(name: string, type?: string): boolean {
  return name.toLowerCase().endsWith('.zip') || type === 'application/zip' || type === 'application/x-zip-compressed';
}

export { basename, dirname, joinPath, normalizePath };
