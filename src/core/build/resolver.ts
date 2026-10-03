/**
 * Resolucao de imports para o preview.
 *
 * Duas origens, nessa ordem:
 *  1. Arquivos do proprio projeto (VFS) - resolvidos por caminho relativo.
 *  2. Pacotes de terceiros - `node_modules` do ZIP, ou CDN (esm.sh) como fallback.
 *
 * O objetivo e servir o bundle sem precisar instalar nada no servidor,
 * que e a premissa do Arcanum Weaver (site estatico).
 */

export interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  module?: string;
  browser?: string | Record<string, string>;
  exports?: unknown;
  types?: string;
  sideEffects?: boolean | string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface ResolvedFile {
  /** Caminho servido no namespace do preview. */
  servedPath: string;
  /** Onde o bytes veio. */
  origin: 'project' | 'node_modules' | 'cdn';
  bytes: Uint8Array;
}

export interface ResolveInput {
  /** Importador, ex.: "src/main.tsx". */
  importer: string;
  /** Especificador escrito no import. */
  specifier: string;
}

export interface ResolverDeps {
  readProject(path: string): Promise<string | null>;
  readNodeModule(path: string): Promise<string | null>;
  hasNodeModules(): boolean;
  allowCdn: boolean;
  fetchTimeoutMs: number;
}

export const BUILTIN_PREFIX = '/__preview__/__arcanum_';
export const CDN_ORIGIN = 'https://esm.sh';

const DEFAULT_CONDITIONS = ['browser', 'module', 'import', 'default'];

/** Candidatos de extensao quando o specifier nao tem. */
const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json', '.css'];

export class ResolveError extends Error {
  constructor(message: string, readonly code: 'not-found' | 'bad-export' | 'network' | 'timeout') {
    super(message);
    this.name = 'ResolveError';
  }
}

/* ------------------------------------------------------------------ utils */

export function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !/^https?:/.test(specifier);
}

export function isExternalUrl(specifier: string): boolean {
  return /^https?:\/\//.test(specifier);
}

/** Converte "./utils" relativo a "src/components/Button.tsx" -> "src/utils". */
export function resolveRelativePath(importer: string, specifier: string): string {
  const base = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
  const parts = base.split('/').filter(Boolean);
  for (const seg of specifier.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

/** Divide "react-dom/client" em pacote "react-dom" e subpath "client". */
export function splitPackage(specifier: string): { name: string; subpath: string } {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    const name = parts.slice(0, 2).join('/');
    return { name, subpath: parts.slice(2).join('/') };
  }
  return { name: parts[0] ?? specifier, subpath: parts.slice(1).join('/') };
}

const usedSpecifiers = new Set<string>();

export function nextSpecifier(key: string): string {
  let i = 1;
  let candidate = `__arc_${key.replace(/[^a-z0-9]+/gi, '_')}`;
  while (usedSpecifiers.has(candidate)) candidate = `__arc_${key.replace(/[^a-z0-9]+/gi, '_')}_${i++}`;
  usedSpecifiers.add(candidate);
  return candidate;
}

export function clearSpecifierRegistry(): void {
  usedSpecifiers.clear();
}

/* ---------------------------------------------------------- exports field */

type ExportsField = unknown;

function isStringExport(value: ExportsField): value is string {
  return typeof value === 'string';
}

function isConditionalExport(value: ExportsField): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(isStringExport)
  );
}

/**
 * Resolve o campo "exports" do package.json respeitando as condicoes.
 * Subpath map (chaves com '.') tem precedencia sobre conditional exports.
 */
export function resolveExports(exportsField: ExportsField, subpath: string): string | null {
  const key = subpath ? `./${subpath}` : '.';

  if (isStringExport(exportsField)) return exportsField;
  if (Array.isArray(exportsField)) {
    for (const entry of exportsField) {
      const hit = resolveExports(entry, subpath);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof exportsField !== 'object' || exportsField === null) return null;

  const record = exportsField as Record<string, unknown>;

  // wildcard dentro de subpath map: "./*": "./lib/*.js"
  for (const [pattern, target] of Object.entries(record)) {
    if (!pattern.startsWith('.') || !pattern.includes('*')) continue;
    const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (!regex.test(key)) continue;
    const captured = regex.exec(key)?.[0] ?? '';
    const tail = captured.slice(pattern.indexOf('*'));
    if (isStringExport(target)) return target.replace('*', tail);
  }

  if (key in record) return resolveExports(record[key], '');
  if ('.' in record) return resolveExports(record['.'], '');

  if (isConditionalExport(record)) {
    for (const condition of DEFAULT_CONDITIONS) {
      if (record[condition]) return record[condition] as string;
    }
  }
  return null;
}

export function packageEntry(pkg: PackageJson, subpath: string): string | null {
  const fromExports = pkg.exports ? resolveExports(pkg.exports, subpath) : null;
  if (fromExports) return fromExports;

  if (typeof pkg.browser === 'string') return subpath ? `./${subpath}` : pkg.browser;
  if (pkg.browser && typeof pkg.browser === 'object') {
    const mapped = (pkg.browser as Record<string, string>)[subpath ? `./${subpath}` : '.'];
    if (mapped) return mapped;
  }
  return subpath ? `./${subpath}` : (pkg.module ?? pkg.main ?? './index.js');
}

/* ---------------------------------------------------------------- resolve */

async function findInProject(deps: ResolverDeps, basePath: string): Promise<string | null> {
  const candidates: string[] = [];
  if (/\.[a-z0-9]{1,6}$/i.test(basePath)) candidates.push(basePath);
  candidates.push(`${basePath}.tsx`, `${basePath}.ts`, `${basePath}.jsx`, `${basePath}.js`, `${basePath}.mjs`);
  candidates.push(
    `${basePath}/index.tsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.jsx`,
    `${basePath}/index.js`,
    `${basePath}/index.mjs`,
  );
  for (const ext of EXTENSIONS) candidates.push(`${basePath}${ext}`);

  for (const candidate of candidates) {
    if (await deps.readProject(candidate)) return candidate;
  }
  return null;
}

async function readAny(deps: ResolverDeps, path: string): Promise<string | null> {
  const fromProject = await deps.readProject(path);
  if (fromProject !== null) return fromProject;
  return deps.readNodeModule(path);
}

async function readJson<T>(deps: ResolverDeps, path: string): Promise<T | null> {
  const raw = await readAny(deps, path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function findInNodeModules(deps: ResolverDeps, pkgName: string, subpath: string): Promise<string | null> {
  const manifest = await readJson<PackageJson>(deps, `node_modules/${pkgName}/package.json`);
  if (!manifest) return null;

  const entry = packageEntry(manifest, subpath);
  if (!entry) return null;

  const base = `node_modules/${pkgName}/${entry.replace(/^\.\//, '')}`;

  const candidates = [base];
  for (const ext of EXTENSIONS) candidates.push(`${base}${ext}`);
  for (const ext of EXTENSIONS) candidates.push(`${base}/index${ext}`);

  for (const candidate of candidates) {
    if ((await readAny(deps, candidate)) !== null) return candidate;
  }
  return null;
}

async function fetchCdn(specifier: string, timeoutMs: number): Promise<string> {
  const url = `${CDN_ORIGIN}/${specifier}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new ResolveError(`CDN respondeu HTTP ${res.status} para "${specifier}"`, 'network');
    return await res.text();
  } catch (e) {
    if (e instanceof ResolveError) throw e;
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new ResolveError(
      aborted
        ? `Timeout de CDN para "${specifier}"`
        : `Falha de rede na CDN: ${e instanceof Error ? e.message : String(e)}`,
      aborted ? 'timeout' : 'network',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve um specifier para um caminho servido no preview.
 * Prioridade: projeto -> node_modules -> CDN.
 */
export async function resolveSpecifier(input: ResolveInput, deps: ResolverDeps): Promise<ResolvedFile> {
  const { importer, specifier } = input;

  if (isExternalUrl(specifier)) {
    throw new ResolveError(`Import externo "${specifier}" nao passa pelo preview`, 'not-found');
  }

  if (specifier.startsWith(BUILTIN_PREFIX)) {
    throw new ResolveError(`Import interno do preview nao pode ser resolvido: ${specifier}`, 'not-found');
  }

  if (!isBareSpecifier(specifier)) {
    const base = specifier.startsWith('/') ? specifier.slice(1) : resolveRelativePath(importer, specifier);
    const found = await findInProject(deps, base);
    if (found) return { servedPath: found, origin: 'project', bytes: new Uint8Array() };
    throw new ResolveError(`Nao encontrei "${specifier}" (importado de ${importer})`, 'not-found');
  }

  const { name, subpath } = splitPackage(specifier);

  if (deps.hasNodeModules()) {
    const found = await findInNodeModules(deps, name, subpath);
    if (found) return { servedPath: found, origin: 'node_modules', bytes: new Uint8Array() };
  }

  if (!deps.allowCdn) {
    throw new ResolveError(
      `Pacote "${name}" nao encontrado. Inclua node_modules no ZIP ou habilite o fallback CDN nas configuracoes.`,
      'not-found',
    );
  }

  const code = await fetchCdn(specifier, deps.fetchTimeoutMs);
  return {
    servedPath: `${BUILTIN_PREFIX}cdn/${encodeURIComponent(specifier)}.js`,
    origin: 'cdn',
    bytes: new TextEncoder().encode(code),
  };
}