export type LayerId = 'strip' | 'dedupe' | 'structure' | 'window' | 'sketch' | 'semantic';

export interface LayerResult {
  id: LayerId;
  label: string;
  applied: boolean;
  tokensBefore: number;
  tokensAfter: number;
  detail: string;
}

export interface CompressResult {
  text: string;
  layers: LayerResult[];
  tokensBefore: number;
  tokensAfter: number;
  savedPercent: number;
  sketchOf: string[];
}

export interface CompressOptions {
  enabled?: LayerId[];
  /** janela de linhas ao redor da referencia */
  windowSize?: number;
  /** tokens alvo por arquivo */
  perFileBudget?: number;
  /** numeros de linha citados na pergunta -> recorta o arquivo */
  focusLines?: number[];
  /** profundidade maxima de indentation preservada no sketch */
  sketchDepth?: number;
  /** hash reversivel: referencia o bloco original em vez de remove-lo */
  reversible?: boolean;
}

const DEFAULT_ENABLED: LayerId[] = ['strip', 'dedupe', 'structure', 'window'];

export const LAYER_LABELS: Record<LayerId, string> = {
  strip: 'Remover comentarios e ruido',
  dedupe: 'Deduplicar blocos repetidos',
  structure: 'Comprimir boilerplate repetido',
  window: 'Recortar para regiao citada',
  sketch: 'Substituir por esboco de estrutura',
  semantic: 'Compressao semantica (WASM)',
};

const HASH_COMMENT = /^\s*#[^\n]*$/gm;

/**
 * Remove comentarios de bloco sem tocar em delimitadores que estejam
 * dentro de strings. Faz varredura caractere a caractere para nao corromper
 * codigo valido (ex.: a string "/* nao e comentario *\/").
 */
export function stripBlockComments(src: string, lineComment: string): { text: string; removed: number } {
  let out = '';
  let i = 0;
  let removed = 0;
  const n = src.length;
  const stripsLines = lineComment.length > 0;

  while (i < n) {
    const ch = src[i] as string;

    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      removed++;
      continue;
    }

    if (stripsLines && src.startsWith(lineComment, i)) {
      const end = src.indexOf('\n', i);
      i = end === -1 ? n : end;
      removed++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = src[i] as string;
        if (c === '\\') {
          out += c + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += c;
        i++;
        if (c === quote) break;
        if (quote !== '`' && c === '\n') break;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return { text: out, removed };
}

/**
 * L1: remove comentarios de bloco, espaco final e linhas vazias consecutivas.
 * Preservado o conteudo de strings e template literals.
 */
export function layerStrip(text: string, language: string): { text: string; removed: number } {
  const lineComment = language === 'python' || language === 'shell' || language === 'yaml' ? '#' : '';
  const scanned = stripBlockComments(text, lineComment);

  let removed = scanned.removed;
  let out = scanned.text;

  if (lineComment === '#') {
    const hashMatches = out.match(HASH_COMMENT);
    if (hashMatches) removed += hashMatches.length;
    out = out.replace(HASH_COMMENT, '');
  }

  out = out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n');

  const blankCollapse = (out.match(/\n{3,}/g) ?? []).length;
  removed += blankCollapse;
  out = out.replace(/\n{3,}/g, '\n\n');

  return { text: out, removed };
}

/**
 * L2: remove blocos de import duplicados e linhas repetidas
 * na mesma janela (copias de boilerplate).
 */
export function layerDedupe(text: string, language: string): { text: string; removed: number } {
  const lines = text.split('\n');
  const seen = new Map<string, number>();
  const out: string[] = [];
  let removed = 0;

  const isStructural = (l: string): boolean => {
    const t = l.trim();
    if (t.length < 12) return false;
    return (
      t.startsWith('import ') ||
      t.startsWith('from ') ||
      t.startsWith('export ') ||
      t.startsWith('const ') ||
      t.startsWith('return ') ||
      t.startsWith('<') ||
      /^["'`].*["'`],?$/.test(t)
    );
  };

  for (const line of lines) {
    const t = line.trim();
    if (isStructural(t)) {
      const count = (seen.get(t) ?? 0) + 1;
      seen.set(t, count);
      if (count > 1) {
        removed++;
        continue;
      }
    }
    out.push(line);
  }

  if (language === 'json') {
    return { text: out.join('\n'), removed };
  }
  return { text: out.join('\n'), removed };
}

export interface Boilerplate {
  id: string;
  lines: string[];
  occurrences: number;
}

/**
 * Descobre blocos de boilerplate identicos que se repetem
 * (ex.: validadores repetidos, blocos de try/catch iguais).
 */
export function findBoilerplate(text: string, blockSize = 5, minOccurrences = 3): Boilerplate[] {
  const lines = text.split('\n').map((l) => l.trim());
  const groups = new Map<string, number>();
  for (let i = 0; i + blockSize <= lines.length; i++) {
    const block = lines.slice(i, i + blockSize);
    if (block.every((l) => l.length === 0)) continue;
    if (block.join('').length < 40) continue;
    const key = block.join('\n');
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const out: Boilerplate[] = [];
  let n = 0;
  for (const [key, occurrences] of groups) {
    if (occurrences >= minOccurrences) {
      out.push({ id: `bp${n++}`, lines: key.split('\n'), occurrences });
    }
  }
  return out;
}

/**
 * L3: substitui repeticoes de boilerplate por marcadores `{id:N}`.
 * Sempre com legenda, para o modelo saber o que o marcador significa.
 */
export function layerStructure(text: string, blockSize = 5, minOccurrences = 3): { text: string; removed: number; legend: string } {
  const boiler = findBoilerplate(text, blockSize, minOccurrences);
  if (boiler.length === 0) return { text, removed: 0, legend: '' };

  const lines = text.split('\n');
  const trims = lines.map((l) => l.trim());
  const used = new Set<Boilerplate>();
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let matched = false;
    for (const bp of boiler) {
      if (used.has(bp)) continue;
      const slice = trims.slice(i, i + bp.lines.length);
      if (slice.join('\n') === bp.lines.join('\n')) {
        out.push(`${/^\s*/.exec(lines[i] ?? '')?.[0] ?? ''}{${bp.id}:${bp.occurrences}}`);
        i += bp.lines.length - 1;
        used.add(bp);
        matched = true;
        break;
      }
    }
    if (!matched) out.push(lines[i] as string);
  }

  const legend = [...used]
    .map((bp) => `${bp.id} (x${bp.occurrences}):\n${bp.lines.map((l) => `  ${l}`).join('\n')}`)
    .join('\n\n');

  const removed = [...used].reduce((acc, bp) => acc + bp.lines.length * (bp.occurrences - 1), 0);
  return { text: out.join('\n'), removed, legend };
}

/**
 * L4: recorta o arquivo para a janela em torno das linhas citadas.
 * Preserva cabecalho (imports) e rodape (exports).
 */
export function layerWindow(text: string, focusLines: number[], size = 40): { text: string; removed: number; covered: boolean } {
  const validFocus = focusLines.filter((n) => Number.isInteger(n) && n > 0);
  if (validFocus.length === 0) return { text, removed: 0, covered: false };
  const lines = text.split('\n');
  if (lines.length <= size * 2) return { text, removed: 0, covered: false };

  const keep = new Set<number>();
  for (let i = 1; i <= Math.min(30, lines.length); i++) keep.add(i);
  for (let i = Math.max(1, lines.length - 19); i <= lines.length; i++) keep.add(i);

  for (const focus of validFocus) {
    for (let i = Math.max(1, focus - size); i <= Math.min(lines.length, focus + size); i++) {
      keep.add(i);
    }
  }

  const out: string[] = [];
  let removed = 0;
  let skipping = false;
  let lastKeptLine = 0;
  for (let i = 1; i <= lines.length; i++) {
    if (keep.has(i)) {
      if (skipping) {
        out.push(`  // ... ${i - lastKeptLine - 1} linhas omitidas ...`);
        skipping = false;
      }
      out.push(lines[i - 1] as string);
      lastKeptLine = i;
    } else {
      if (!skipping) skipping = true;
      removed++;
    }
  }
  return { text: out.join('\n'), removed, covered: true };
}

/**
 * L5: substitui o corpo por um esboco de estrutura (assinaturas, imports, exports).
 * Preserva tudo que define a forma do arquivo.
 */
export function layerSketch(text: string, language: string, maxLines = 60): { text: string; removed: number } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { text, removed: 0 };

  const keep: string[] = [];
  let removed = 0;
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const t = line.trim();

    const structural =
      t.startsWith('import ') ||
      t.startsWith('export ') ||
      t.startsWith('from ') ||
      /^(export\s+)?(default\s+)?(async\s+)?function\s/.test(t) ||
      /^(export\s+)?(abstract\s+)?class\s/.test(t) ||
      /^(export\s+)?(const|let|var|interface|type|enum)\s/.test(t) ||
      /^\s*(public|private|protected|static|async)\s/.test(t) ||
      /^\s*[A-Za-z_$][\w$]*\s*\(.*\)\s*[:{]/.test(t) ||
      /^\s*(#region|#endregion)/.test(t) ||
      /^\s*\/\*\*/.test(t);

    if (t.startsWith('/*') && !t.endsWith('*/')) inBlock = true;
    if (inBlock) {
      if (t.endsWith('*/')) inBlock = false;
      if (!structural) {
        removed++;
        continue;
      }
    }

    if (structural) {
      if (keep.length >= maxLines) {
        removed++;
        continue;
      }
      keep.push(line);
      const opensBody = /\{\s*$/.test(t) && !/\}\s*$/.test(t);
      if (opensBody) {
        keep.push(line.replace(/\{\s*$/, '{ /* ... */ }'));
        // consome o corpo ate fechar a chave
        let depth = 1;
        i++;
        while (i < lines.length && depth > 0) {
          const l = lines[i] ?? '';
          for (const ch of l) {
            if (ch === '{') depth++;
            if (ch === '}') depth--;
          }
          removed++;
          i++;
        }
        i--;
      }
    } else if (t.length > 0 && !t.startsWith('//')) {
      removed++;
    }
  }

  if (language === 'json' && keep.length < 5) {
    return { text: lines.slice(0, maxLines).join('\n'), removed: lines.length - maxLines };
  }

  return { text: keep.join('\n'), removed };
}

/** Extrai numeros de linha citados no texto do usuario. */
export function extractLineRefs(text: string): number[] {
  const out = new Set<number>();
  const patterns = [
    /linha\s+(\d+)/gi,
    /line\s+(\d+)/gi,
    /^\s*(\d+)\s*:/gm,
    /L(\d+)/g,
    /:\d+/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1] ?? m[0].replace(/\D/g, ''));
      if (Number.isInteger(n) && n > 0 && n < 100000) out.add(n);
    }
  }
  return [...out];
}

export function compressPrompt(
  text: string,
  language: string,
  options: CompressOptions = {},
  countTokens: (s: string) => number,
): CompressResult {
  const enabled = options.enabled ?? DEFAULT_ENABLED;
  const layers: LayerResult[] = [];
  const sketchOf: string[] = [];
  let current = text;

  const run = (id: LayerId, fn: (t: string) => { text: string; detail: string }): void => {
    if (!enabled.includes(id)) {
      layers.push({ id, label: LAYER_LABELS[id], applied: false, tokensBefore: countTokens(current), tokensAfter: countTokens(current), detail: 'desativada' });
      return;
    }
    const before = countTokens(current);
    const { text: next, detail } = fn(current);
    const after = countTokens(next);
    layers.push({ id, label: LAYER_LABELS[id], applied: after < before, tokensBefore: before, tokensAfter: after, detail });
    current = next;
  };

  run('strip', (t) => {
    const r = layerStrip(t, language);
    return { text: r.text, detail: `${r.removed} trechos removidos` };
  });

  run('dedupe', (t) => {
    const r = layerDedupe(t, language);
    return { text: r.text, detail: `${r.removed} linhas duplicadas removidas` };
  });

  run('structure', (t) => {
    const r = layerStructure(t);
    return {
      text: r.legend ? `${t}\n\n/* BOILERPLATE LEGEND (use {id:N} to expand) */\n${r.legend}` : t,
      detail: r.legend ? `${r.removed} boilerplate lines replaced` : 'no repeated boilerplate',
    };
  });

  run('window', (t) => {
    const focus = options.focusLines ?? [];
    const r = layerWindow(t, focus, options.windowSize ?? 40);
    return { text: r.text, detail: r.covered ? `${r.removed} lines outside window` : 'no lines cited' };
  });

  run('sketch', (t) => {
    const budget = options.perFileBudget ?? 0;
    const maxLines = budget > 0 ? Math.max(20, Math.floor(budget / 12)) : 60;
    const r = layerSketch(t, language, maxLines);
    if (r.removed > 0) sketchOf.push('structure preserved');
    return { text: r.text, detail: r.removed > 0 ? `${r.removed} body lines omitted` : 'already compact' };
  });

  const tokensBefore = countTokens(text);
  const tokensAfter = countTokens(current);
  return {
    text: current,
    layers,
    tokensBefore,
    tokensAfter,
    savedPercent: tokensBefore > 0 ? Math.max(0, Math.round((1 - tokensAfter / tokensBefore) * 100)) : 0,
    sketchOf,
  };
}
