import {
  BUILTIN_PREFIX,
  clearSpecifierRegistry,
  isBareSpecifier,
  isExternalUrl,
  resolveSpecifier,
  splitPackage,
  type ResolvedFile,
  type ResolverDeps,
} from './resolver';
import { ensureJsxRuntime, rewriteImports, transform } from './transform';

export interface BundleInput {
  entry: string;
  readProject(path: string): Promise<string | null>;
  readNodeModule(path: string): Promise<string | null>;
  hasNodeModules(): boolean;
  allowCdn: boolean;
  fetchTimeoutMs?: number;
}

export interface BundleFile {
  path: string;
  bytes: Uint8Array;
  origin: 'project' | 'node_modules' | 'cdn';
}

export interface BundleResult {
  ok: boolean;
  entryUrl: string;
  files: BundleFile[];
  importMap: string;
  unresolved: Array<{ specifier: string; importer: string; reason: string }>;
  errors: string[];
  fromCdn: string[];
  stats: { modules: number; bytes: number; projectModules: number; cdnModules: number };
}

const extname = (path: string): string => {
  const base = path.split('/').pop() ?? '';
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase();
};

const SCRIPT_EXT = new Set(['.tsx', '.ts', '.jsx', '.js', '.mjs']);

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

/** Extrai specifiers de um modulo. */
export function collectSpecifiers(code: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(code)) !== null) {
    const spec = m[1] as string;
    if (spec) out.add(spec);
  }
  return [...out];
}

function toServed(path: string): string {
  return path.startsWith(BUILTIN_PREFIX) ? path : `${BUILTIN_PREFIX}${path}`;
}

/**
 * Percorre o grafo de imports a partir do entrypoint, transforma cada
 * modulo e devolve um import map para o navegador resolver em runtime.
 * Nao empacota: deixa o navegador fazer o fetching.
 */
export async function buildBundle(input: BundleInput): Promise<BundleResult> {
  const errors: string[] = [];
  const unresolved: BundleResult['unresolved'] = [];
  const fromCdn: string[] = [];
  const served = new Map<string, BundleFile>();
  const specifierMap = new Map<string, string>();

  clearSpecifierRegistry();

  const deps: ResolverDeps = {
    readProject: input.readProject,
    readNodeModule: input.readNodeModule,
    hasNodeModules: () => input.hasNodeModules(),
    allowCdn: input.allowCdn,
    fetchTimeoutMs: input.fetchTimeoutMs ?? 12000,
  };

  const readSource = async (path: string): Promise<string | null> => {
    const project = await input.readProject(path);
    if (project !== null) return project;
    return input.readNodeModule(path);
  };

  const queue: string[] = [input.entry];
  const seen = new Set<string>([input.entry]);
  let projectModules = 0;
  let cdnModules = 0;

  const processModule = async (path: string, source: string): Promise<void> => {
    const ext = extname(path);
    if (!SCRIPT_EXT.has(ext)) {
      served.set(path, { path, bytes: new TextEncoder().encode(source), origin: 'project' });
      return;
    }

    const code = ensureJsxRuntime(transform(source, { extension: ext, filename: path }), {
      extension: ext,
      filename: path,
    });

    for (const spec of collectSpecifiers(code)) {
      if (isExternalUrl(spec)) continue;
      if (specifierMap.has(spec)) continue;

      let resolved: ResolvedFile;
      try {
        resolved = await resolveSpecifier({ importer: path, specifier: spec }, deps);
      } catch (e) {
        unresolved.push({ specifier: spec, importer: path, reason: e instanceof Error ? e.message : String(e) });
        continue;
      }

      specifierMap.set(spec, resolved.servedPath);

      if (resolved.origin === 'cdn') {
        cdnModules++;
        fromCdn.push(spec);
        served.set(resolved.servedPath, { path: resolved.servedPath, bytes: resolved.bytes, origin: 'cdn' });
        continue;
      }

      const resolvedSource = await readSource(resolved.servedPath);
      if (resolvedSource === null) {
        unresolved.push({ specifier: spec, importer: path, reason: `arquivo resolvido "${resolved.servedPath}" esta vazio` });
        continue;
      }
      projectModules++;

      if (!seen.has(resolved.servedPath)) {
        seen.add(resolved.servedPath);
        const resolvedExt = extname(resolved.servedPath);
        if (SCRIPT_EXT.has(resolvedExt)) {
          queue.push(resolved.servedPath);
        } else {
          served.set(resolved.servedPath, {
            path: resolved.servedPath,
            bytes: new TextEncoder().encode(resolvedSource),
            origin: resolved.origin,
          });
        }
      }
    }

    const aliasMap: Record<string, string> = {};
    for (const [spec, target] of specifierMap) aliasMap[spec] = target;
    served.set(path, {
      path,
      bytes: new TextEncoder().encode(rewriteImports(code, aliasMap)),
      origin: 'project',
    });
  };

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const source = await readSource(current);
    if (source === null) {
      errors.push(`Nao encontrei "${current}"`);
      continue;
    }
    await processModule(current, source);
  }

  const importMap = JSON.stringify({
    imports: Object.fromEntries([...specifierMap.entries()].map(([spec, target]) => [spec, toServed(target)])),
  });

  return {
    ok: unresolved.length === 0,
    entryUrl: toServed(input.entry),
    files: [...served.values()],
    importMap,
    unresolved,
    errors,
    fromCdn,
    stats: {
      modules: served.size,
      bytes: [...served.values()].reduce((acc, f) => acc + f.bytes.byteLength, 0),
      projectModules,
      cdnModules,
    },
  };
}

/** Gera o HTML do preview ja apontando para o bundle. */
export function buildPreviewHtml(html: string, result: BundleResult): string {
  const mapScript = `<script type="importmap">${result.importMap.replace(/</g, '\\u003c')}</script>`;
  const entryScript = `<script type="module" src="${result.entryUrl}"></script>`;

  const withMap = html.includes('type="importmap"')
    ? html.replace(/<script[^>]*type="importmap"[^>]*>[\s\S]*?<\/script>/i, mapScript)
    : html.replace(/<\/head>/i, `${mapScript}\n</head>`);

  if (/<script[^>]*type="module"[^>]*src=/i.test(withMap)) {
    return withMap.replace(
      /<script([^>]*)type="module"([^>]*)src="[^"]*"([^>]*)><\/script>/i,
      `<script$1type="module"$2src="${result.entryUrl}"$3></script>`,
    );
  }

  return withMap.replace('</body>', `${entryScript}\n</body>`);
}

export { isBareSpecifier, isExternalUrl, splitPackage, BUILTIN_PREFIX };