import { basename, extname } from '../vfs/paths';

export interface RankableFile {
  path: string;
  content: string;
  size: number;
  recentlyEdited?: boolean;
  isOpen?: boolean;
  isEntry?: boolean;
}

export interface RankedFile extends RankableFile {
  score: number;
  reasons: string[];
}

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'um', 'uma', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'por', 'com', 'sem', 'que', 'se', 'ou', 'ao', 'aos', 'the', 'a', 'an', 'of', 'in', 'on', 'to',
  'for', 'and', 'or', 'is', 'it', 'this', 'that', 'with', 'me', 'meu', 'minha', 'voce', 'vc',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Ranqueia arquivos por relevancia para a pergunta.
 * Sinais: sobreposicao de termos, path mentioned, entry points,
 * dependencias (imports), arvore de arquivos abertos e editados recentemente.
 */
export function rankFiles(files: RankableFile[], question: string, graph: Map<string, string[]> = new Map()): RankedFile[] {
  const qTokens = new Set(tokenize(question));
  const qLower = question.toLowerCase();

  const scores = new Map<string, { score: number; reasons: string[] }>();
  const ensure = (path: string) => {
    let entry = scores.get(path);
    if (!entry) {
      entry = { score: 0, reasons: [] };
      scores.set(path, entry);
    }
    return entry;
  };

  const importers = new Map<string, string[]>();
  for (const [importer, imported] of graph) {
    for (const dep of imported) {
      const list = importers.get(dep) ?? [];
      list.push(importer);
      importers.set(dep, list);
    }
  }

  for (const file of files) {
    const entry = ensure(file.path);
    const pathLower = file.path.toLowerCase();
    const base = basename(file.path).toLowerCase();
    const ext = extname(file.path);

    if (qLower.includes(base)) {
      entry.score += 40;
      entry.reasons.push('nome do arquivo citado');
    }

    const pathTokens = tokenize(pathLower);
    for (const t of pathTokens) {
      if (qTokens.has(t)) {
        entry.score += 8;
        entry.reasons.push(`caminho: ${t}`);
      }
    }

    const contentTokens = new Set(tokenize(file.content.slice(0, 20000)));
    let overlap = 0;
    for (const t of qTokens) if (contentTokens.has(t)) overlap++;
    if (overlap > 0) {
      entry.score += Math.min(30, overlap * 4);
      entry.reasons.push(`${overlap} termos da pergunta`);
    }

    if (file.isEntry) {
      entry.score += 12;
      entry.reasons.push('entry point');
    }
    if (file.isOpen) {
      entry.score += 15;
      entry.reasons.push('aba aberta');
    }
    if (file.recentlyEdited) {
      entry.score += 10;
      entry.reasons.push('editado recentemente');
    }

    const importedBy = importers.get(file.path) ?? [];
    if (importedBy.length > 0) {
      entry.score += Math.min(20, importedBy.length * 4);
      entry.reasons.push(`importado por ${importedBy.length} arquivo(s)`);
    }

    if (['.md', '.txt', '.lock'].includes(ext) && !qLower.includes(base)) {
      entry.score -= 15;
    }
    if (base.includes('.min.') || ['.map', '.svg', '.woff', '.woff2', '.ttf'].includes(ext)) {
      entry.score -= 40;
    }
  }

  return files
    .map((f) => {
      const entry = scores.get(f.path) ?? { score: 0, reasons: [] };
      return { ...f, score: entry.score, reasons: entry.reasons };
    })
    .sort((a, b) => b.score - a.score);
}

/** Extrai arestas de import entre arquivos do projeto. */
export function buildImportGraph(files: RankableFile[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const f of files) {
    const base = basename(f.path);
    const noExt = base.replace(/\.[^.]+$/, '');
    for (const key of [base, noExt, `/${noExt}`]) {
      const list = byName.get(key) ?? [];
      list.push(f.path);
      byName.set(key, list);
    }
  }

  const graph = new Map<string, string[]>();
  const re = /(?:from\s+|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]/g;
  for (const f of files) {
    const deps: string[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(f.content)) !== null) {
      const spec = m[1] as string;
      if (!spec.startsWith('.')) continue;
      const resolved = resolveRelative(f.path, spec);
      const candidates = byName.get(resolved) ?? byName.get(basename(spec)) ?? byName.get(basename(spec).replace(/\.[^.]+$/, ''));
      const hit = candidates?.find((p) => p !== f.path);
      if (hit) deps.push(hit);
    }
    if (deps.length > 0) graph.set(f.path, [...new Set(deps)]);
  }
  return graph;
}

function resolveRelative(fromPath: string, spec: string): string {
  const parts = fromPath.split('/');
  parts.pop();
  for (const seg of spec.split('/')) {
    if (seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export const ENTRY_NAMES = new Set([
  'main.tsx', 'main.ts', 'index.tsx', 'index.ts', 'app.tsx', 'app.ts',
  'server.ts', 'index.html', 'main.js', 'index.js', 'app.jsx', 'app.js',
  'layout.tsx', 'page.tsx', 'route.ts',
]);

export function isEntryPoint(path: string): boolean {
  const base = basename(path);
  if (ENTRY_NAMES.has(base)) return true;
  if (path.startsWith('src/app/') && /page|route|layout/.test(base)) return true;
  return false;
}
