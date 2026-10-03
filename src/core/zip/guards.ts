export interface ZipLimits {
  maxTotalBytes: number;
  maxFiles: number;
  maxSingleFileBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_LIMITS: ZipLimits = {
  maxTotalBytes: 512 * 1024 * 1024,
  maxFiles: 20000,
  maxSingleFileBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 200,
};

export interface ImportStats {
  total: number;
  dirs: number;
  files: number;
  skipped: string[];
  rootPrefix: string;
  totalBytes: number;
  largest: { path: string; size: number } | null;
}

export interface ImportProgress {
  phase: 'reading' | 'decoding' | 'writing' | 'done';
  current: string;
  done: number;
  total: number;
}

export class ZipGuardError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ZipGuardError';
  }
}

export const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.turbo', '.DS_Store']);

export function shouldSkip(path: string): boolean {
  const parts = path.split('/');
  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) return true;
  }
  return false;
}
