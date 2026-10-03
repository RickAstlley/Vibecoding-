import { splitLines } from './line-edit';

export interface Anchor {
  id: string;
  path: string;
  /** linha 1-indexada do elemento */
  line: number;
  /** coluna 1-indexada do inicio do elemento */
  column: number;
  /** texto exato do elemento (ou do identificador unico) */
  text: string;
  /** linhas de contexto antes, para reancorar */
  before: string[];
  /** linhas de contexto depois, para reancorar */
  after: string[];
  kind: 'function' | 'class' | 'method' | 'const' | 'variable' | 'import' | 'property' | 'marker' | 'block';
}

export type AnchorOp =
  | { kind: 'replace-anchor'; anchor: string; text: string }
  | { kind: 'insert-before-anchor'; anchor: string; text: string }
  | { kind: 'insert-after-anchor'; anchor: string; text: string }
  | { kind: 'replace-block'; anchor: string; fromOffset: number; toOffset: number; text: string };

export class AnchorError extends Error {
  constructor(message: string, readonly code: 'not-found' | 'ambiguous' | 'bad-op') {
    super(message);
    this.name = 'AnchorError';
  }
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function normalize(s: string): string {
  return s.replace(/\r\n?/g, '\n').trim();
}

/**
 * Escaneia o arquivo e extrai ancoras nomeadas: declaracoes de topo
 * (function, class, const, import) e metodos dentro de classes/objects.
 */
export function extractAnchors(path: string, source: string): Anchor[] {
  const lines = splitLines(source);
  const anchors: Anchor[] = [];
  const seen = new Map<string, number>();

  const push = (a: Omit<Anchor, 'before' | 'after' | 'id'>): void => {
    const key = a.text;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    const id = count === 1 ? key : `${key}#${count}`;
    anchors.push({
      ...a,
      id,
      before: contextBefore(lines, a.line),
      after: contextAfter(lines, a.line),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNo = i + 1;

    const fn = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (fn?.[1]) {
      push({ path, line: lineNo, column: (line.indexOf(fn[1]) || 0) + 1, text: fn[1], kind: 'function' });
      continue;
    }

    const cls = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (cls?.[1]) {
      push({ path, line: lineNo, column: (line.indexOf(cls[1]) || 0) + 1, text: cls[1], kind: 'class' });
      continue;
    }

    const imp = line.match(/^\s*import\s+(?:type\s+)?(?:\{([^}]*)\}|([A-Za-z_$][A-Za-z0-9_$]*))/);
    if (imp) {
      const named = (imp[1] ?? '')
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0])
        .filter(Boolean);
      if (named.length > 0) {
        for (const name of named) {
          if (name && IDENT.test(name)) {
            push({ path, line: lineNo, column: (line.indexOf(name) || 0) + 1, text: name, kind: 'import' });
          }
        }
      } else if (imp[2]) {
        push({ path, line: lineNo, column: (line.indexOf(imp[2]) || 0) + 1, text: imp[2], kind: 'import' });
      }
      continue;
    }

    const decl = line.match(/^\s*(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (decl?.[1]) {
      push({ path, line: lineNo, column: (line.indexOf(decl[1]) || 0) + 1, text: decl[1], kind: 'const' });
      continue;
    }

    const method = line.match(/^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|\*\s*)*([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/);
    if (method?.[1] && !['if', 'for', 'while', 'switch', 'catch', 'return', 'constructor'].includes(method[1])) {
      push({ path, line: lineNo, column: (line.indexOf(method[1]) || 0) + 1, text: method[1], kind: 'method' });
      continue;
    }

    const prop = line.match(/^\s{2,}(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]/);
    if (prop?.[1] && !['if', 'else', 'return', 'for', 'while'].includes(prop[1])) {
      push({ path, line: lineNo, column: (line.indexOf(prop[1]) || 0) + 1, text: prop[1], kind: 'property' });
      continue;
    }

    const marker = line.match(/^\s*\/?\s*#region\s+(.+?)\s*$/);
    if (marker?.[1]) {
      push({ path, line: lineNo, column: 1, text: marker[1], kind: 'marker' });
    }
  }

  return anchors;
}

function contextBefore(lines: string[], line: number, size = 3): string[] {
  const start = Math.max(0, line - 1 - size);
  return lines.slice(start, line - 1).map(normalize);
}

function contextAfter(lines: string[], line: number, size = 3): string[] {
  return lines.slice(line, line + size).map(normalize);
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let hits = 0;
  for (const ch of a) if (setB.has(ch)) hits++;
  return (2 * hits) / (a.length + b.length);
}

/**
 * Reancora uma ancora declarada em uma versao anterior do arquivo.
 * Retorna a nova linha (1-indexada) ou null se nao encontrar.
 */
export function reanchor(anchor: Anchor, currentSource: string): number | null {
  const lines = splitLines(currentSource);

  const exact: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (normalize(lines[i] ?? '').includes(anchor.text)) exact.push(i + 1);
  }

  if (exact.length === 1) return exact[0] as number;
  if (exact.length === 0) {
    const fuzzy: Array<{ line: number; score: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const score = similarity(anchor.text, normalize(lines[i] ?? ''));
      if (score > 0.6) fuzzy.push({ line: i + 1, score });
    }
    fuzzy.sort((x, y) => y.score - x.score);
    if (fuzzy.length === 0) return null;
    if (fuzzy.length > 1 && (fuzzy[0]?.score ?? 0) - (fuzzy[1]?.score ?? 0) < 0.1) {
      throw new AnchorError(`Ancora "${anchor.text}" ficou ambigua apos edicoes`, 'ambiguous');
    }
    return fuzzy[0]?.line ?? null;
  }

  const best = exact
    .map((line) => {
      const idx = line - 1;
      let score = 0;
      const before = lines.slice(Math.max(0, idx - anchor.before.length), idx);
      const after = lines.slice(idx + 1, idx + 1 + anchor.after.length);
      anchor.before.forEach((b, i) => {
        if (normalize(before[i] ?? '') === b) score += 1;
      });
      anchor.after.forEach((a, i) => {
        if (normalize(after[i] ?? '') === a) score += 1;
      });
      score -= Math.abs(line - anchor.line) * 0.01;
      return { line, score };
    })
    .sort((x, y) => y.score - x.score);

  const top = best[0];
  const second = best[1];
  if (top && second && top.score === second.score && top.score === 0) {
    throw new AnchorError(`Ancora "${anchor.text}" nao pode ser reancorada com seguranca`, 'ambiguous');
  }
  return top?.line ?? null;
}

export interface AnchorPatchResult {
  path: string;
  before: string;
  after: string;
  appliedAt: number;
  anchor: string;
}

export function applyAnchorOp(source: string, anchors: Anchor[], op: AnchorOp): AnchorPatchResult {
  const found = anchors.find((a) => a.id === op.anchor || a.text === op.anchor);
  if (!found) {
    throw new AnchorError(`Ancora "${op.anchor}" nao existe no arquivo`, 'not-found');
  }
  const line = reanchor(found, source);
  if (line === null) {
    throw new AnchorError(`Nao foi possivel reancorar "${op.anchor}"`, 'not-found');
  }
  const lines = splitLines(source);

  switch (op.kind) {
    case 'replace-anchor': {
      const indent = /^(\s*)/.exec(lines[line - 1] ?? '')?.[1] ?? '';
      const payload = op.text.split('\n').map((l, i) => (i === 0 ? l : indent + l));
      lines.splice(line - 1, 1, ...payload);
      break;
    }
    case 'insert-before-anchor': {
      const indent = /^(\s*)/.exec(lines[line - 1] ?? '')?.[1] ?? '';
      const payload = op.text.split('\n').map((l) => indent + l);
      lines.splice(line - 1, 0, ...payload);
      break;
    }
    case 'insert-after-anchor': {
      const indent = /^(\s*)/.exec(lines[line - 1] ?? '')?.[1] ?? '';
      const payload = op.text.split('\n').map((l) => indent + l);
      lines.splice(line, 0, ...payload);
      break;
    }
    case 'replace-block': {
      lines.splice(line - 1 + op.fromOffset, op.toOffset - op.fromOffset, ...op.text.split('\n'));
      break;
    }
    default: {
      throw new AnchorError(`Operacao desconhecida: ${JSON.stringify(op)}`, 'bad-op');
    }
  }

  return {
    path: found.path,
    before: source,
    after: lines.join('\n'),
    appliedAt: line,
    anchor: op.anchor,
  };
}
