/**
 * Indexacao e busca semantica do projeto, 100% no browser.
 *
 * Usa BM25 sobre chunks de codigo em vez de embeddings: nao depende de
 * nenhum modelo, nao custa token, funciona offline e roda em milissegundos.
 * Para o caso de uso (achar "onde eu trato o login"), BM25 bate embeddings
 * de grao pequeno com muito menos complexidade.
 */

export interface Chunk {
  id: string;
  path: string;
  /** Texto usado na busca. */
  text: string;
  /** Linha inicial (1-indexada). */
  startLine: number;
  endLine: number;
  /** Tokens normalizados. */
  tokens: string[];
  kind: 'function' | 'class' | 'component' | 'method' | 'block' | 'file';
  name: string;
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
  /** Trecho com o termo em destaque. */
  snippet: string;
}

export interface IndexStats {
  chunks: number;
  files: number;
  terms: number;
  builtAt: number;
}

const STOPWORDS = new Set([
  'de','da','do','das','dos','a','o','as','os','um','uma','e','em','no','na','nos','nas','para','por','com','sem','que','se','ou','ao','aos',
  'the','a','an','of','in','on','to','for','and','or','is','it','this','that','with','be','as','at','by','from',
  'const','let','var','function','return','if','else','for','while','import','export','default','new','class','extends',
]);

/** Divide identificadores em partes: "useAuthToken" -> use, auth, token. */
export function tokenize(text: string): string[] {
  const raw = text
    .split(/[^A-Za-z0-9_$]+/)
    .flatMap((token) => {
      if (!token) return [];
      const parts = token.split('_').filter(Boolean);
      const camel = token
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/\s+/)
        .filter(Boolean);
      return [token, ...parts, ...camel];
    })
    .map((t) => t.toLowerCase());

  return raw.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface SymbolRule {
  re: RegExp;
  kind: Chunk['kind'];
}

const SYMBOL_RULES: SymbolRule[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^\s{2,}(?:(?:public|private|protected|static|async)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/, kind: 'method' },
  { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, kind: 'component' },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
];

/**
 * Fatia o arquivo em chunks por simbolo. Um simbolo grande vira varios
 * chunks de no maximo `maxLines`, para o trecho retrieved ser util.
 */
export function chunkFile(path: string, source: string, maxLines = 40): Chunk[] {
  const lines = source.split('\n');
  if (lines.length === 0) return [];

  const chunks: Chunk[] = [];
  let currentStart = 0;
  let currentKind: Chunk['kind'] = 'file';
  let currentName = path.split('/').pop() ?? path;
  let depth = 0;

  const flush = (endLine: number): void => {
    const text = lines.slice(currentStart, endLine).join('\n');
    if (text.trim().length === 0) return;
    chunks.push(makeChunk(path, text, currentStart + 1, endLine, currentKind, currentName));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    if (depth === 0) {
      const rule = SYMBOL_RULES.find((r) => r.re.test(line));
      if (rule) {
        // so divide se ja ha linhas acumuladas; na primeira linha do arquivo
        // apenas rotula o chunk, senao o primeiro simbolo seria perdido
        if (i > currentStart) flush(i);
        currentStart = i;
        currentKind = rule.kind;
        currentName = rule.re.exec(line)?.[1] ?? currentName;
      }
    }

    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }

    if (i - currentStart >= maxLines && depth === 0) {
      flush(i + 1);
      currentStart = i + 1;
      currentKind = 'block';
      currentName = `${currentName} (cont.)`;
    }
  }

  flush(lines.length);
  return chunks;
}

function makeChunk(path: string, text: string, startLine: number, endLine: number, kind: Chunk['kind'], name: string): Chunk {
  return {
    id: `${path}#${startLine}`,
    path,
    text,
    startLine,
    endLine,
    // o caminho entra nos tokens: sem isso, buscar "login" nao acha
    // src/auth/login.ts mesmo com o arquivo todo no indice
    tokens: tokenize(`${path} ${name} ${text}`),
    kind,
    name,
  };
}

export interface Bm25Options {
  k1?: number;
  b?: number;
}

export class ProjectIndex {
  private chunks: Chunk[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  private paths = new Set<string>();
  private builtAt = 0;

  constructor(private readonly options: Bm25Options = {}) {}

  build(files: Array<{ path: string; content: string }>, maxLines = 40): IndexStats {
    this.chunks = [];
    this.df.clear();
    this.paths.clear();

    for (const file of files) {
      this.paths.add(file.path);
      this.chunks.push(...chunkFile(file.path, file.content, maxLines));
    }

    this.avgLen = this.chunks.length > 0
      ? this.chunks.reduce((acc, c) => acc + c.tokens.length, 0) / this.chunks.length
      : 0;

    for (const chunk of this.chunks) {
      for (const term of new Set(chunk.tokens)) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }

    this.builtAt = Date.now();
    return { chunks: this.chunks.length, files: this.paths.size, terms: this.df.size, builtAt: this.builtAt };
  }

  stats(): IndexStats {
    return { chunks: this.chunks.length, files: this.paths.size, terms: this.df.size, builtAt: this.builtAt };
  }

  search(query: string, limit = 8, pathFilter?: string): SearchHit[] {
    if (this.chunks.length === 0) return [];

    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const k1 = this.options.k1 ?? 1.5;
    const b = this.options.b ?? 0.75;
    const N = this.chunks.length;

    const scored: SearchHit[] = [];

    for (const chunk of this.chunks) {
      if (pathFilter && !chunk.path.startsWith(pathFilter)) continue;

      const counts = new Map<string, number>();
      for (const token of chunk.tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

      let score = 0;
      let matched = 0;

      for (const term of terms) {
        const tf = counts.get(term) ?? 0;
        if (tf === 0) continue;
        matched++;
        const df = this.df.get(term) ?? 1;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const lenNorm = 1 - b + b * (chunk.tokens.length / (this.avgLen || 1));
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * lenNorm));
      }

      if (matched === 0) continue;

      // Bonus: trecho que contem o caminho ou o nome do simbolo.
      const lowerQuery = query.toLowerCase();
      if (chunk.path.toLowerCase().includes(lowerQuery)) score *= 1.4;
      if (chunk.name.toLowerCase() === lowerQuery) score *= 1.6;
      score *= 1 + matched / terms.length / 2;

      scored.push({ chunk, score, snippet: snippetOf(chunk.text, terms) });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Nomes de simbolos que casam com a consulta: alimenta o autocomplete. */
  symbols(query: string, limit = 10): Array<{ name: string; path: string; kind: Chunk['kind']; line: number }> {
    const q = query.toLowerCase();
    const seen = new Set<string>();
    const out: Array<{ name: string; path: string; kind: Chunk['kind']; line: number }> = [];

    for (const chunk of this.chunks) {
      if (out.length >= limit) break;
      if (!chunk.name.toLowerCase().includes(q)) continue;
      const key = `${chunk.path}:${chunk.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: chunk.name, path: chunk.path, kind: chunk.kind, line: chunk.startLine });
    }
    return out;
  }
}

/** Trecho em torno da primeira ocorrencia de qualquer termo. */
export function snippetOf(text: string, terms: string[], width = 220): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return text.slice(0, width).trim();

  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '...' : ''}`;
}

/** Converte hits em contexto para o modelo. */
export function renderContext(hits: SearchHit[], maxChars = 3000): string {
  const parts: string[] = [];
  for (const hit of hits) {
    parts.push(`--- ${hit.chunk.path}:${hit.chunk.startLine}-${hit.chunk.endLine} (${hit.chunk.kind} ${hit.chunk.name}) ---`);
    parts.push(hit.chunk.text.slice(0, 800));
  }
  return parts.join('\n\n').slice(0, maxChars);
}

export const RAG_INSTRUCTIONS = `
Voce tem acesso a busca semantica do projeto (buscar_codigo).
Use para localizar implementacoes antes de presumir. A busca divide os
arquivos por simbolo, entao o resultado ja vem com arquivo e intervalo de linhas.
`.trim();