export type VerifySeverity = 'error' | 'warning' | 'info';

export interface VerifyIssue {
  severity: VerifySeverity;
  message: string;
  line: number | null;
  rule: string;
}

export interface VerifyResult {
  ok: boolean;
  issues: VerifyIssue[];
  balanced: boolean;
  kind: 'typescript' | 'javascript' | 'json' | 'css' | 'html' | 'python' | 'markdown' | 'text' | 'binary';
}

const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function stripStringsAndComments(src: string, kind: VerifyResult['kind']): string {
  let out = '';
  let i = 0;
  const n = src.length;
  const lineComment = kind === 'python' ? '#' : '//';
  const blockOpen = kind === 'python' ? '"""' : '/*';
  const blockClose = kind === 'python' ? '"""' : '*/';

  while (i < n) {
    const ch = src[i] as string;
    const next2 = src.slice(i, i + 2);

    if (next2 === blockOpen) {
      const end = src.indexOf(blockClose, i + blockOpen.length);
      i = end === -1 ? n : end + blockClose.length;
      continue;
    }
    if (ch === lineComment) {
      const end = src.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        if (quote !== '`' && src[i] === '\n') break;
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
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

export function verifySource(path: string, source: string, kind: VerifyResult['kind']): VerifyResult {
  const issues: VerifyIssue[] = [];

  switch (kind) {
    case 'json':
      issues.push(...checkJson(source));
      break;
    case 'typescript':
    case 'javascript':
      issues.push(...checkTypeScriptLike(source, kind));
      break;
    case 'html':
      issues.push(...checkHtml(source));
      break;
    case 'python':
      issues.push(...checkPython(source), ...checkBalance(source, 'python'));
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
