const MAX_SEGMENT = 255;
const ILLEGAL = /[\0<>:"|?*\\]/;

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

/**
 * Normaliza um caminho relativo para a raiz do projeto.
 * Remove barras duplicadas, resolve `.` e `..`, e rejeita escape da raiz.
 */
export function normalizePath(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new PathError('Caminho vazio');
  }
  if (input.length > 4096) {
    throw new PathError('Caminho excede 4096 caracteres');
  }

  const unified = input.replace(/\\/g, '/');
  if (unified.startsWith('/')) {
    throw new PathError(`Caminho absoluto nao permitido: ${input}`);
  }
  if (/^[a-zA-Z]:/.test(unified)) {
    throw new PathError(`Caminho com drive letter nao permitido: ${input}`);
  }

  const out: string[] = [];
  for (const raw of unified.split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') {
      if (out.length === 0) {
        throw new PathError(`Path traversal detectado: ${input}`);
      }
      out.pop();
      continue;
    }
    if (raw.length > MAX_SEGMENT) {
      throw new PathError(`Segmento excede ${MAX_SEGMENT} caracteres em: ${input}`);
    }
    if (ILLEGAL.test(raw)) {
      throw new PathError(`Caractere invalido no caminho: ${raw}`);
    }
    out.push(raw);
  }

  if (out.length === 0) {
    throw new PathError(`Caminho resolve para a raiz: ${input}`);
  }
  return out.join('/');
}

export function tryNormalizePath(input: string): string | null {
  try {
    return normalizePath(input);
  } catch {
    return null;
  }
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  return base.slice(i).toLowerCase();
}

export function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

export function isAncestor(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return false;
  return descendant.startsWith(`${ancestor}/`);
}

export function commonAncestor(paths: string[]): string {
  if (paths.length === 0) return '';
  let prefix = segments(paths[0] ?? '');
  for (const p of paths.slice(1)) {
    const segs = segments(p);
    let i = 0;
    while (i < prefix.length && i < segs.length && prefix[i] === segs[i]) i++;
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) return '';
  }
  return prefix.join('/');
}
