export interface ParserIssue {
  severity: 'error' | 'warning';
  text: string;
  line: number | null;
  column: number | null;
}

export interface ParseResult {
  ok: boolean;
  errors: ParserIssue[];
  warnings: ParserIssue[];
}

const SCRIPT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function extToFormat(ext: string): 'ts' | 'js' | 'tsx' | 'jsx' {
  switch (ext) {
    case '.tsx':
      return 'tsx';
    case '.ts':
      return 'ts';
    case '.jsx':
      return 'jsx';
    default:
      return 'js';
  }
}

let cachedTransform: ((input: string, options: Record<string, unknown>) => Promise<unknown>) | null = null;

async function ensureEsbuild(): Promise<(input: string, options: Record<string, unknown>) => Promise<unknown>> {
  if (cachedTransform) return cachedTransform;

  const mod = await import('esbuild-wasm');
  const { transform } = mod;
  cachedTransform = (input: string, options: Record<string, unknown>): Promise<unknown> =>
    transform(input, options as never);

  return cachedTransform;
}

interface EsbuildLocation {
  line: number;
  column: number;
}

function extractLocation(loc: unknown): { line: number | null; column: number | null } {
  if (loc && typeof loc === 'object' && 'line' in loc && 'column' in loc) {
    const l = loc as EsbuildLocation;
    return { line: l.line, column: l.column };
  }
  return { line: null, column: null };
}

export async function parseWithEsbuild(path: string, source: string): Promise<ParseResult> {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (!SCRIPT_EXTS.has(`.${ext}`)) {
    throw new Error(`esbuild nao suporta "${ext}"`);
  }

  const format = extToFormat(`.${ext}`);
  const transform = await ensureEsbuild();

  const options: Record<string, unknown> = {
    loader: format,
  };

  let errorsRaw: Array<{ text: string; location: unknown }> = [];
  let warningsRaw: Array<{ text: string; location: unknown }> = [];

  try {
    const result = await transform(source, options);
    warningsRaw = (result as { warnings?: Array<{ text: string; location: unknown }> }).warnings ?? [];
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'errors' in e) {
      errorsRaw = (e as { errors: Array<{ text: string; location: unknown }> }).errors ?? [];
      warningsRaw = (e as { warnings?: Array<{ text: string; location: unknown }> }).warnings ?? [];
    } else {
      throw e;
    }
  }

  const errors: ParserIssue[] = errorsRaw.map((e) => {
    const loc = extractLocation(e.location);
    return { severity: 'error' as const, text: e.text, line: loc.line, column: loc.column };
  });

  const warnings: ParserIssue[] = warningsRaw.map((w) => {
    const loc = extractLocation(w.location);
    return { severity: 'warning' as const, text: w.text, line: loc.line, column: loc.column };
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export async function tryParseWithEsbuild(path: string, source: string): Promise<ParseResult | null> {
  try {
    return await parseWithEsbuild(path, source);
  } catch {
    return null;
  }
}
