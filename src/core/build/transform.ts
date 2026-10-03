/**
 * Transformacao de TypeScript/JSX para JavaScript puro, no cliente.
 *
 * Objetivo: rodar um projeto Vite/React no preview sem bundler de 10MB.
 * Nao e um compilador completo - cobre o subconjunto que aparece em codigo
 * de aplicacao. Onde a heuristica falha, o preview mostra o erro em vez de
 * gerar codigo silenciosamente errado.
 */

export interface TransformOptions {
  extension: string;
  jsxFactory?: string;
  jsxAutomatic?: boolean;
  filename?: string;
}

export class TransformError extends Error {
  constructor(message: string, readonly line?: number) {
    super(message);
    this.name = 'TransformError';
  }
}

const TYPE_KEYWORDS =
  /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\[\])?|\{[^{}]*\}|'[^']*'|"[^"]*"|`[^`]*`|\|.*|null|undefined|unknown|any|never|void|boolean|number|string|symbol|object|bigint)$/;

/** Anda ate o fim de um tipo, respeitando aninhamento. */
function typeRun(src: string, start: number): number {
  let i = start;
  let depth = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '<' || ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '>' || ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (ch === ',' || ch === ')' || ch === ';' || ch === '=' || ch === '\n')) break;
    i++;
  }
  return i;
}

/**
 * Remove `: Tipo` das listas de parametro.
 *
 * O truque e o contexto: dentro de `{...}` o `:` e chave de objeto literal e
 * nao pode ser tocado; dentro de `(...)` e anotacao de tipo e deve sumir.
 * Sem isso, `const o = { a: 1, b: "x" }` viraria `const o = { a: 1, b}`.
 */
function stripParamTypes(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  const stack: Array<'brace' | 'paren' | 'bracket'> = [];

  while (i < n) {
    const ch = src[i] as string;

    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = src[i] as string;
        out += c;
        i++;
        if (c === '\\') {
          out += src[i] ?? '';
          i++;
          continue;
        }
        if (c === q) break;
      }
      continue;
    }

    if (ch === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      const end = e === -1 ? n : e;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e === -1 ? n : e + 2;
      out += src.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '{' || ch === '[' || ch === '(') {
      stack.push(ch === '{' ? 'brace' : ch === '[' ? 'bracket' : 'paren');
      out += ch;
      i++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      stack.pop();
      out += ch;
      i++;
      continue;
    }

    if (ch === ':' && stack[stack.length - 1] === 'paren') {
      const end = typeRun(src, i + 1);
      const raw = src.slice(i + 1, end).trim();
      const candidate = raw.replace(/\s*=.*$/, '').trim();
      if (candidate && TYPE_KEYWORDS.test(candidate)) {
        i = end;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/** Remove anotacao de retorno de funcao: `): Tipo {` -> `) {`. */
function stripReturnTypes(src: string): string {
  return src.replace(/\)\s*:\s*[A-Za-z_$][\w$.<>[\],]*\s*(?=\{)/g, (match, offset: number) => {
    const before = src.slice(Math.max(0, offset - 400), offset);
    if (/=>\s*$/.test(before) && !/\)\s*$/.test(before)) return match;
    const trailing = /\s*$/.exec(match)?.[0] ?? '';
    return `)${trailing}`;
  });
}

function stripVarAnnotations(src: string): string {
  return src.replace(
    /(\b(?:const|let|var)\s+[A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$.,<>[\]]*(?=\s*=\s*[^=])/g,
    '$1',
  );
}

/** Remove `!` de non-null assertion sem confundir com negacao logica. */
export function stripNonNull(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i] as string;

    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = src[i] as string;
        out += c;
        i++;
        if (c === '\\') {
          out += src[i] ?? '';
          i++;
          continue;
        }
        if (c === q) break;
      }
      continue;
    }

    if (ch === '!') {
      const prev = out.slice(-1);
      const next = src[i + 1];
      const afterValue = /[A-Za-z0-9_$)\]'"]/.test(prev);
      if (afterValue && next !== '=') {
        i++;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/** Remove tipos e sintaxe TS, preservando o codigo executavel. */
export function stripTypes(src: string, _extension: string): string {
  let out = src;

  out = out.replace(/(^|\n)\s*(?:export\s+)?interface\s+[A-Za-z_$][\w$]*[^{]*\{(?:[^{}]|\{[^{}]*\})*\}[^\n]*/g, '$1');
  out = out.replace(/(^|\n)\s*(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*(?:<[^=]*?>)?\s*=[^\n]*(?:;[^\n]*)?/g, '$1');

  out = out.replace(/^\s*import\s+type\s+[^;]+;?$/gm, '');
  out = out.replace(/^\s*export\s+type\s*\{[^}]*\}\s*;?$/gm, '');
  out = out.replace(/^(\s*import)\s+type\s+\{([^}]*)\}/gm, '$1 {$2}');
  out = out.replace(/\btype\s+([A-Za-z_$][\w$]*)\s*,/g, '$1,');

  out = stripParamTypes(out);
  out = stripReturnTypes(out);
  out = stripVarAnnotations(out);
  out = out.replace(/\s*\bsatisfies\s+[A-Za-z_$][\w$.,<>[\]]*/g, '');
  out = stripNonNull(out);
  out = out.replace(/([A-Za-z_$][\w$]*)\?(?=\s*[:),=])/g, '$1');
  out = out.replace(/([(,]\s*)(public|private|protected|readonly)\s+/g, '$1');

  // Em .tsx so remove quando o generic e seguido de '(' - JSX nunca tem isso.
  out = out.replace(/<[A-Za-z_$][\w$.,<>[\]]*>(?=\()/g, '');

  return out;
}

/* -------------------------------------------------------------------- JSX */

const JSX_KEYWORDS = new Set([
  'return',
  'case',
  'yield',
  'await',
  'typeof',
  'void',
  'delete',
  'in',
  'of',
  'do',
  'else',
  'default',
  'export',
  'const',
  'let',
  'var',
]);

/** `<` abre tag JSX ou e comparacao/generico? */
function jsxTagStart(src: string, i: number): boolean {
  const next = src[i + 1];
  if (next === undefined) return false;
  if (!/[A-Za-z/>]/.test(next)) return false;
  if (next === '/') return true;

  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j] as string)) j--;
  if (j < 0) return true;
  const prev = src[j] as string;
  if (!/[A-Za-z0-9_$]/.test(prev)) return true;

  let k = j;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k] as string)) k--;
  return JSX_KEYWORDS.has(src.slice(k + 1, j + 1));
}

interface ParsedElement {
  code: string;
  next: number;
}

function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i] as string;
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      i++;
      while (i < src.length) {
        const c = src[i] as string;
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === q) break;
        i++;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseChildren(
  src: string,
  start: number,
  factory: string,
  file: string,
): { props: string; next: number } | null {
  const n = src.length;
  let i = start;
  const children: string[] = [];
  let text = '';

  const flushText = (): void => {
    const trimmed = text.replace(/\s+/g, ' ');
    if (trimmed.trim().length > 0) children.push(JSON.stringify(trimmed.replace(/^\s+|\s+$/g, '')));
    text = '';
  };

  while (i < n) {
    if (src.startsWith('</', i)) {
      const close = src.indexOf('>', i);
      if (close === -1) return null;
      flushText();
      const args = children.length > 0 ? `, ${children.join(', ')}` : '';
      return { props: args, next: close + 1 };
    }

    if (src[i] === '{' && !/^\{\s*\.\.\./.test(src.slice(i, i + 5))) {
      const end = matchBrace(src, i);
      if (end === -1) return null;
      flushText();
      const inner = src.slice(i + 1, end).trim();
      if (inner) children.push(inner);
      i = end + 1;
      continue;
    }
    if (src.startsWith('{...', i)) {
      const end = matchBrace(src, i);
      if (end === -1) return null;
      text += src.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    if (src[i] === '<' && /[A-Za-z/>]/.test(src[i + 1] ?? '')) {
      const parsed = parseElement(src, i, factory, file);
      if (!parsed) return null;
      flushText();
      children.push(parsed.code);
      i = parsed.next;
      continue;
    }

    text += src[i];
    i++;
  }

  return null;
}

function parseElement(src: string, start: number, factory: string, file: string): ParsedElement | null {
  const n = src.length;
  let i = start + 1;

  if (src[i] === '/') return null;

  let nameEnd = i;
  while (nameEnd < n && /[A-Za-z0-9_$.:-]/.test(src[nameEnd] as string)) nameEnd++;
  const rawName = src.slice(i, nameEnd);

  if (rawName.length === 0) {
    if (src[i] === '>') {
      const inner = parseChildren(src, i + 1, factory, file);
      if (!inner) return null;
      return { code: `${factory}(_Fragment, null${inner.props})`, next: inner.next };
    }
    return null;
  }
  i = nameEnd;

  const tagName = /^[a-z][a-z0-9-]*$/.test(rawName) ? JSON.stringify(rawName) : rawName;
  const props: string[] = [];
  let selfClosing = false;

  for (;;) {
    while (i < n && /\s/.test(src[i] as string)) i++;
    if (i >= n) return null;

    if (src[i] === '/' && src[i + 1] === '>') {
      selfClosing = true;
      i += 2;
      break;
    }
    if (src[i] === '>') {
      i++;
      break;
    }
    if (src[i] === '{') {
      const end = matchBrace(src, i);
      if (end === -1) return null;
      props.push(`...${src.slice(i + 1, end).trim()}`);
      i = end + 1;
      continue;
    }

    let attrEnd = i;
    while (attrEnd < n && /[A-Za-z0-9_:.-]/.test(src[attrEnd] as string)) attrEnd++;
    const attrName = src.slice(i, attrEnd);
    if (!attrName) return null;
    i = attrEnd;

    while (i < n && /\s/.test(src[i] as string)) i++;
    if (src[i] !== '=') {
      props.push(`${JSON.stringify(attrName)}: true`);
      continue;
    }
    i++;
    while (i < n && /\s/.test(src[i] as string)) i++;

    const quote = src[i];
    if (quote === '"' || quote === "'") {
      let j = i + 1;
      while (j < n && src[j] !== quote) j++;
      if (j >= n) return null;
      props.push(`${JSON.stringify(attrName)}: ${JSON.stringify(src.slice(i + 1, j))}`);
      i = j + 1;
      continue;
    }
    if (quote === '{') {
      const end = matchBrace(src, i);
      if (end === -1) return null;
      const inner = src.slice(i + 1, end).trim();
      props.push(`${JSON.stringify(attrName)}: ${inner === '' ? 'true' : inner}`);
      i = end + 1;
      continue;
    }

    let j = i;
    while (j < n && !/[\s>/]/.test(src[j] as string)) j++;
    props.push(`${JSON.stringify(attrName)}: ${JSON.stringify(src.slice(i, j))}`);
    i = j;
  }

  const propsExpr = props.length > 0 ? `, { ${props.join(', ')} }` : '';

  if (selfClosing) {
    return { code: `${factory}(${tagName}, null${propsExpr})`, next: i };
  }

  const children = parseChildren(src, i, factory, file);
  if (!children) return null;
  return { code: `${factory}(${tagName}, null${propsExpr}${children.props})`, next: children.next };
}

/** Converte JSX para chamadas de createElement. */
export function transformJsx(src: string, options: TransformOptions): string {
  const factory = options.jsxFactory ?? 'React.createElement';
  const file = options.filename ?? 'arquivo';

  let out = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i] as string;

    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = src[i] as string;
        out += c;
        i++;
        if (c === '\\') {
          out += src[i] ?? '';
          i++;
          continue;
        }
        if (c === q) break;
      }
      continue;
    }

    if (ch === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      const end = e === -1 ? n : e;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e === -1 ? n : e + 2;
      out += src.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '<' && jsxTagStart(src, i)) {
      const parsed = parseElement(src, i, factory, file);
      if (!parsed) {
        out += ch;
        i++;
        continue;
      }
      out += parsed.code;
      i = parsed.next;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/* ---------------------------------------------------------------- pipeline */

export function transform(source: string, options: TransformOptions): string {
  const ext = options.extension || '.ts';
  let out = stripTypes(source, ext);
  if (ext === '.tsx' || ext === '.jsx') {
    out = transformJsx(out, options);
  }
  return out;
}

/** Injeta o import do runtime JSX quando a fonte usa JSX e nao importa React. */
export function ensureJsxRuntime(code: string, options: TransformOptions): string {
  if (options.extension !== '.tsx' && options.extension !== '.jsx') return code;

  if (options.jsxAutomatic === false) {
    if (/import\s+React\b/.test(code)) return code;
    return `import React from 'react';\n${code}`;
  }

  if (/react\/jsx-(dev-)?runtime/.test(code)) return code;
  return `import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";\n${code}`;
}

/** Reescreve imports para os caminhos servidos. */
export function rewriteImports(code: string, map: Record<string, string>): string {
  let out = code;

  out = out.replace(/(\bfrom\s*)(['"])([^'"]+)\2/g, (match, from, quote, spec) => {
    const target = map[spec];
    return target ? `${from}${quote}${target}${quote}` : match;
  });

  out = out.replace(/(\bimport\s*\(\s*)(['"])([^'"]+)\2/g, (match, head, quote, spec) => {
    const target = map[spec];
    return target ? `${head}${quote}${target}${quote}` : match;
  });

  out = out.replace(/(\bimport\s+)(['"])([^'"]+)\2/g, (match, head, quote, spec) => {
    const target = map[spec];
    return target ? `${head}${quote}${target}${quote}` : match;
  });

  return out;
}

/** Declara as variaveis do runtime JSX geradas pela transformacao. */
export function declareJsxHelpers(code: string, factory: string): string {
  if (!/_Fragment|_jsx|_jsxs/.test(code)) return code;
  if (factory !== 'React.createElement') return code;
  return `import React from 'react';\nconst _Fragment = React.Fragment;\nconst _jsx = React.createElement;\nconst _jsxs = React.createElement;\n${code}`;
}