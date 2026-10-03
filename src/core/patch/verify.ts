export type VerifySeverity = 'error' | 'warning' | 'info';

export interface VerifyIssue {
  severity: VerifySeverity;
  message: string;
  line: number | null;
  rule: string;
}

export type VerifyKind =
  | 'typescript'
  | 'javascript'
  | 'jsx'
  | 'tsx'
  | 'json'
  | 'html'
  | 'css'
  | 'python'
  | 'yaml'
  | 'shell'
  | 'markdown'
  | 'text'
  | 'binary';

export interface VerifyResult {
  ok: boolean;
  issues: VerifyIssue[];
  balanced: boolean;
  kind: VerifyKind;
}

const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

type ScanMode = 'children' | 'tag' | 'expr';

export interface ScannedTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  line: number;
}

export interface ScanResult {
  /** Codigo com strings e comentarios neutralizados, para contar balances. */
  code: string;
  /** Tags JSX encontradas, na ordem em que aparecem. */
  tags: ScannedTag[];
}

/**
 * Scanner unico para JSX/TSX. Usa tres contextos porque eles se confundem:
 *  - `children`: texto entre tags. Aspas sao literais ("Don't" e texto valido).
 *  - `tag`:      atributos. Aspas sao strings; `{` abre expressao.
 *  - `expr`:     expressao JS. Aspas sao strings; `<Tag` ainda pode ser JSX.
 *
 * Sem essa distincao, "Don't panic" dentro de `{cond && <p>...</p>}` abriria
 * uma string e engoliria o resto da linha.
 */
function scanJsx(src: string): ScanResult {
  const out: string[] = [];
  const tags: ScannedTag[] = [];
  const modes: ScanMode[] = ['children'];
  let i = 0;
  let line = 1;
  const n = src.length;
  let depth = 0;
  let tagOpen = -1;
  const top = (): ScanMode => modes[modes.length - 1] ?? 'children';

  while (i < n) {
    const ch = src[i] as string;
    const mode = top();

    if (ch === '\n') {
      line++;
      out.push(ch);
      i++;
      continue;
    }

    if (src.startsWith('/*', i)) {
      const e = src.indexOf('*/', i + 2);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (src.startsWith('//', i) && (mode !== 'children' || atLineStart(src, i))) {
      const e = src.indexOf('\n', i);
      i = e === -1 ? n : e;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      out.push(ch);
      if (mode === 'children') {
        // Texto JSX: aspa nao abre string.
        i++;
        continue;
      }
      i++;
      while (i < n) {
        const c = src[i] as string;
        if (c === '\\') {
          out.push(c, src[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (c === '\n') line++;
        out.push(c);
        i++;
        if (c === ch) break;
        if (ch !== '`' && c === '\n') break;
      }
      continue;
    }

    if (mode === 'tag') {
      if (ch === '{') depth++;
      if (ch === '}') depth = Math.max(0, depth - 1);
      if (ch === '>' && depth === 0) {
        const raw = src.slice(tagOpen, i);
        const m = /^<\s*(\/?)\s*([A-Za-z][\w.:-]*)?/.exec(raw);
        const closing = m?.[1] === '/';
        const name = m?.[2] ?? FRAGMENT;
        tags.push({ name, closing, selfClosing: /\/\s*$/.test(raw), line });
        modes.pop();
        modes.push('children');
        out.push(ch);
        i++;
        continue;
      }
      out.push(ch);
      i++;
      continue;
    }

    if (ch === '<' && isJsxTagStart(src, i)) {
      modes.push('tag');
      depth = 0;
      tagOpen = i;
      out.push(ch);
      i++;
      continue;
    }

    if (ch === '{') {
      modes.push('expr');
      out.push(ch);
      i++;
      continue;
    }

    if (ch === '}') {
      // Fecha a expressao mais interna. Como uma tag aberta dentro de uma
      // expressao empilha 'children' por cima, procuramos o 'expr' real.
      const idx = modes.lastIndexOf('expr');
      if (idx !== -1) {
        modes.length = idx;
        out.push(ch);
        i++;
        continue;
      }
      // Em texto JSX, '}' e literal e nao participa do balanceamento.
      i++;
      continue;
    }

    out.push(ch);
    i++;
  }

  return { code: out.join(''), tags };
}

function stripStringsAndComments(src: string, kind: VerifyResult['kind']): string {
  if (kind === 'tsx' || kind === 'jsx') return scanJsx(src).code;
  return scanPlain(src, kind);
}

/** Varredura simples para linguagens sem JSX. */
function scanPlain(src: string, kind: VerifyResult['kind']): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  const hash = kind === 'python' || kind === 'shell' || kind === 'yaml';

  while (i < n) {
    const ch = src[i] as string;

    if (!hash && src.startsWith('/*', i)) {
      const e = src.indexOf('*/', i + 2);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (ch === '#' || (!hash && src.startsWith('//', i))) {
      const e = src.indexOf('\n', i);
      i = e === -1 ? n : e;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      out.push(ch);
      i++;
      while (i < n) {
        const c = src[i] as string;
        if (c === '\\') {
          out.push(c, src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out.push(c);
        i++;
        if (c === ch) break;
        if (ch !== '`' && c === '\n') break;
      }
      continue;
    }

    out.push(ch);
    i++;
  }

  return out.join('');
}

function checkBalance(src: string, kind: VerifyResult['kind']): VerifyIssue[] {
  if (kind === 'text' || kind === 'markdown' || kind === 'binary') return [];
  const code = stripStringsAndComments(src, kind);
  const stack: Array<{ ch: string; line: number }> = [];
  const issues: VerifyIssue[] = [];
  let line = 1;

  for (const ch of code) {
    if (ch === '\n') {
      line++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({ ch, line });
    } else if (PAIRS[ch]) {
      const top = stack.pop();
      if (!top) {
        issues.push({ severity: 'error', message: `'${ch}' sem abertura correspondente`, line, rule: 'balance' });
      } else if (top.ch !== PAIRS[ch]) {
        issues.push({
          severity: 'error',
          message: `Esperado '${top.ch}' (linha ${top.line}), encontrou '${ch}'`,
          line,
          rule: 'balance',
        });
      }
    }
  }

  for (const open of stack) {
    issues.push({ severity: 'error', message: `'${open.ch}' aberto na linha ${open.line} nunca fechado`, line: open.line, rule: 'balance' });
  }
  return issues;
}

function checkJson(src: string): VerifyIssue[] {
  try {
    JSON.parse(src);
    return [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = /position (\d+)/.exec(msg);
    let line: number | null = null;
    if (m?.[1]) {
      line = src.slice(0, Number(m[1])).split('\n').length;
    }
    return [{ severity: 'error', message: `JSON invalido: ${msg}`, line, rule: 'json' }];
  }
}

const VOID_JSX = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);

const JSX_KEYWORDS = new Set([
  'return', 'case', 'yield', 'await', 'typeof', 'void', 'delete', 'in', 'of', 'do', 'else',
  'default', 'export', 'const', 'let', 'var',
]);

const FRAGMENT = '#fragment';

function atLineStart(src: string, i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const c = src[j] as string;
    if (c === '\n') return true;
    if (!/\s/.test(c)) return false;
  }
  return true;
}

/**
 * Comentarios valem em modo texto (codigo de topo) quando `/*` aparece ou
 * quando `//` inicia a linha. Requirement extra: texto JSX pode conter
 * "http://..." no meio da linha, que nao e comentario.
 */
/**
 * Decide se `<` em posicao de codigo TSX abre tag JSX ou e um genérico
 * (`Foo<Bar>`). Heuristica: se o token imediatamente anterior e um
 * identificador que NAO e keyword JS, entao e comparacao/generico.
 */
function isJsxTagStart(src: string, i: number): boolean {
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
  const word = src.slice(k + 1, j + 1);
  return JSX_KEYWORDS.has(word);
}

export function looksLikeJsx(src: string): boolean {
  return /<[A-Za-z][\w.:-]*(\s[^<>]*)?\/?>/.test(src) || /<>[\s\S]*<\//.test(src);
}

/**
 * Confere o balanceamento de tags JSX. Erro comum de patch em React:
 * deletar ou trocar uma tag de fechamento, o que nao afeta
 * chaves/parenteses e por isso escaparia da checagem de balance.
 */
function checkJsxTags(src: string): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  if (!looksLikeJsx(src)) return issues;

  const label = (name: string): string => (name === FRAGMENT ? '>' : name);
  const stack: Array<{ name: string; line: number }> = [];

  for (const tag of scanJsx(src).tags) {
    if (VOID_JSX.has(tag.name.toLowerCase())) continue;
    if (tag.closing) {
      const opened = stack.pop();
      if (!opened) {
        issues.push({ severity: 'error', message: `</${label(tag.name)}> sem abertura correspondente`, line: tag.line, rule: 'jsx-tag' });
      } else if (opened.name !== tag.name) {
        issues.push({
          severity: 'error',
          message: `Esperado </${label(opened.name)}> (aberto na linha ${opened.line}), encontrou </${label(tag.name)}>`,
          line: tag.line,
          rule: 'jsx-tag',
        });
      }
    } else if (!tag.selfClosing) {
      stack.push({ name: tag.name, line: tag.line });
    }
  }

  for (const opened of stack) {
    issues.push({
      severity: 'error',
      message: `<${label(opened.name)}> aberto na linha ${opened.line} nunca fechado`,
      line: opened.line,
      rule: 'jsx-tag',
    });
  }

  return issues;
}

function checkTypeScriptLike(src: string, kind: VerifyResult['kind']): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const code = stripStringsAndComments(src, kind);

  for (const [bad, label] of [
    [/\bvar\s+\w+\s*=\s*[^;\n]*\bvar\s/, 'redeclaracao com var'],
    [/\)\s*\)\s*\{/, 'parenteses duplicados'],
    [/\bfunction\s*\([^)]*\)\s*\{[^}]*$/, 'chave de abertura sem fechamento'],
  ] as const) {
    if (bad.test(code)) {
      issues.push({ severity: 'warning', message: `Possivel problema: ${label}`, line: null, rule: 'heuristic' });
    }
  }

  const opens = (code.match(/\{/g) ?? []).length;
  const closes = (code.match(/\}/g) ?? []).length;
  if (Math.abs(opens - closes) > 0) {
    issues.push({
      severity: 'error',
      message: `Chaves desbalanceadas: ${opens} abre / ${closes} fecha`,
      line: null,
      rule: 'brace-count',
    });
  }

  issues.push(...checkBalance(src, kind));

  return issues;
}

function checkHtml(src: string): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const stack: string[] = [];
  const void_ = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const re = /<\/?([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const tag = (m[1] ?? '').toLowerCase();
    const closing = m[0].startsWith('</');
    const selfClose = m[3] === '/';
    if (void_.has(tag) || selfClose) continue;
    if (closing) {
      const top = stack.pop();
      if (top !== tag) {
        issues.push({ severity: 'error', message: `Tag </${tag}> nao fecha <${top ?? 'nada'}>`, line: null, rule: 'html' });
      }
    } else {
      stack.push(tag);
    }
  }
  for (const tag of stack) {
    issues.push({ severity: 'error', message: `Tag <${tag}> nunca fechada`, line: null, rule: 'html' });
  }
  return issues;
}

function checkPython(src: string): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/\t/.test(line)) {
      issues.push({ severity: 'warning', message: 'Tab em Python (use 4 espacos)', line: i + 1, rule: 'python' });
    }
  });
  return issues;
}

function checkCss(src: string): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) {
    issues.push({ severity: 'error', message: `Chaves CSS desbalanceadas (saldo ${depth})`, line: null, rule: 'css' });
  }
  return issues;
}

function checkYaml(src: string): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/^[ ]*\t/.test(line)) {
      issues.push({ severity: 'error', message: 'YAML nao aceita tab na indentacao', line: i + 1, rule: 'yaml' });
    }
    const quotes = (line.match(/"/g) ?? []).length;
    const singles = (line.match(/'/g) ?? []).length;
    if (quotes % 2 === 1) {
      issues.push({ severity: 'error', message: 'Aspas duplas desbalanceadas', line: i + 1, rule: 'yaml' });
    }
    if (singles % 2 === 1) {
      issues.push({ severity: 'error', message: 'Aspas simples desbalanceadas', line: i + 1, rule: 'yaml' });
    }
  });
  return issues;
}

function checkShell(src: string): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(fi|done|esac|else|elif)\b/.test(line) && !/\b(if|for|while|case)\b.*\bthen\b/.test(line)) {
      if (/^\s*(fi|done|esac)\b/.test(line)) {
        issues.push({ severity: 'warning', message: `Verifique se "${line.trim()}" fecha um bloco aberto`, line: i + 1, rule: 'shell' });
      }
    }
  });
  return issues;
}

export function verifySource(path: string, source: string, kind: VerifyResult['kind']): VerifyResult {
  const issues: VerifyIssue[] = [];

  switch (kind) {
    case 'json':
      issues.push(...checkJson(source));
      break;
    case 'typescript':
    case 'javascript':
    case 'jsx':
    case 'tsx':
      issues.push(...checkTypeScriptLike(source, kind));
      if (kind === 'jsx' || kind === 'tsx') issues.push(...checkJsxTags(source));
      break;
    case 'html':
      issues.push(...checkHtml(source));
      break;
    case 'python':
      issues.push(...checkPython(source), ...checkBalance(source, 'python'));
      break;
    case 'shell':
      issues.push(...checkShell(source), ...checkBalance(source, 'shell'));
      break;
    case 'yaml':
      issues.push(...checkYaml(source));
      break;
    case 'css':
      issues.push(...checkCss(source));
      break;
    case 'text':
    case 'markdown':
    case 'binary':
      break;
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    ok: errors.length === 0,
    issues,
    balanced: errors.length === 0,
    kind,
  };
}
