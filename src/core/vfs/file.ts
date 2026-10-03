import type { Binary, Language, VFile } from '@/types/vfs';
import { basename, extname } from './paths';
import { sha256Hex } from '@/lib/hash';

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tar', '.br', '.7z', '.rar', '.bz2',
  '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.mov', '.avi',
  '.pdf', '.wasm', '.so', '.dll', '.dylib', '.exe', '.bin', '.node',
  '.db', '.sqlite', '.lock', '.pack', '.idx',
]);

const LANG_BY_EXT: Record<string, Language> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'jsx',
  '.json': 'json', '.jsonc': 'json', '.json5': 'json',
  '.html': 'html', '.htm': 'html', '.svg': 'html', '.vue': 'html', '.svelte': 'html',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.md': 'markdown', '.mdx': 'markdown', '.markdown': 'markdown',
  '.py': 'python', '.pyi': 'python',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',
  '.txt': 'text', '.env': 'text', '.toml': 'text', '.ini': 'text', '.cfg': 'text',
};

const TEXT_EXT = new Set(['.csv', '.graphql', '.gql', '.sql', '.diff', '.patch', '.gitignore', '']);

export function detectLanguage(path: string): Language {
  const ext = extname(path);
  const lang = LANG_BY_EXT[ext];
  if (lang) return lang;
  const name = basename(path).toLowerCase();
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'shell';
  if (name === 'makefile') return 'text';
  if (name === '.gitignore' || name === '.env' || name === '.npmrc') return 'text';
  return BINARY_EXT.has(ext) ? 'binary' : TEXT_EXT.has(ext) ? 'text' : 'text';
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXT.has(extname(path));
}

export function looksBinary(bytes: Uint8Array, sampleSize = 4096): boolean {
  const len = Math.min(bytes.length, sampleSize);
  for (let i = 0; i < len; i++) {
    const b = bytes[i] as number;
    if (b === 0) return true;
  }
  return false;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function encodeUtf8(text: string): Uint8Array {
  return encoderEncode(text);
}

const encoder = new TextEncoder();
function encoderEncode(text: string): Uint8Array {
  return encoder.encode(text);
}

export async function buildTextFile(path: string, content: string): Promise<VFile> {
  const bytes = encodeUtf8(content);
  return {
    path,
    kind: 'file',
    content,
    blob: null,
    size: bytes.byteLength,
    hash: await sha256Hex(bytes),
    encoding: 'utf8',
    updatedAt: Date.now(),
    version: 1,
  };
}

export async function buildBinaryFile(path: string, bytes: Binary): Promise<VFile> {
  return {
    path,
    kind: 'file',
    content: null,
    blob: bytes,
    size: bytes.byteLength,
    hash: await sha256Hex(bytes),
    encoding: 'binary',
    updatedAt: Date.now(),
    version: 1,
  };
}
