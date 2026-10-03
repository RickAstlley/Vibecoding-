export type LineOp =
  | { kind: 'replace'; line: number; text: string }
  | { kind: 'insert-before'; line: number; text: string }
  | { kind: 'insert-after'; line: number; text: string }
  | { kind: 'delete'; line: number }
  | { kind: 'replace-range'; from: number; to: number; text: string };

export interface LinePatch {
  path: string;
  ops: LineOp[];
  note?: string;
}

export interface LinePatchResult {
  path: string;
  before: string;
  after: string;
  changedLines: number[];
  totalBefore: number;
  totalAfter: number;
}

export class LinePatchError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'LinePatchError';
  }
}

export function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function hasTrailingNewline(text: string): boolean {
  return /\r?\n$/.test(text);
}

export function joinLines(lines: string[], eol: string = '\n'): string {
  return lines.join(eol);
}

export function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Aplica operacoes de linha. Cada op toca apenas as linhas indicadas;
 * o restante do arquivo e preservado byte a byte (exceto normalizacao de EOL).
 */
export function applyLinePatch(text: string, ops: LineOp[]): LinePatchResult {
  const eol = detectEol(text);
  const trailing = hasTrailingNewline(text);
  const lines = splitLines(text);
  const totalBefore = lines.length;
  const touched = new Set<number>();

  const validate = (n: number): number => {
    if (!Number.isInteger(n)) throw new LinePatchError(`Numero de linha invalido: ${n}`, 'bad-line');
    if (n < 1) throw new LinePatchError(`Linha deve ser >= 1 (1-indexada): ${n}`, 'bad-line');
    if (n > lines.length) {
      throw new LinePatchError(`Linha ${n} fora do arquivo (${lines.length} linhas)`, 'out-of-range');
    }
    return n;
  };

  for (const op of ops) {
    switch (op.kind) {
      case 'replace': {
        const n = validate(op.line);
        lines[n - 1] = op.text;
        touched.add(n);
        break;
      }
      case 'insert-before': {
        const n = validate(op.line);
        const payload = op.text === '' ? [] : op.text.split('\n');
        lines.splice(n - 1, 0, ...payload);
        touched.add(n);
        break;
      }
      case 'insert-after': {
        const n = validate(op.line);
        const payload = op.text === '' ? [] : op.text.split('\n');
        lines.splice(n, 0, ...payload);
        touched.add(n);
        break;
      }
      case 'delete': {
        const n = validate(op.line);
        lines.splice(n - 1, 1);
        touched.add(n);
        break;
      }
      case 'replace-range': {
        const from = validate(Math.min(op.from, op.to));
        const to = validate(Math.max(op.from, op.to));
        const payload = op.text === '' ? [] : op.text.split('\n');
        for (let i = from; i <= to; i++) touched.add(i);
        lines.splice(from - 1, to - from + 1, ...payload);
        break;
      }
      default: {
        const exhaustive: never = op;
        throw new LinePatchError(`Operacao desconhecida: ${JSON.stringify(exhaustive)}`, 'unknown-op');
      }
    }
  }

  const after = joinLines(lines, eol) + (trailing ? eol : '');
  return {
    path: '',
    before: text,
    after,
    changedLines: [...touched].sort((a, b) => a - b),
    totalBefore,
    totalAfter: lines.length,
  };
}

export function applyLinePatchTo(text: string, path: string, ops: LineOp[]): LinePatchResult {
  return { ...applyLinePatch(text, ops), path };
}

/**
 * Troca exatamente uma linha. Atalho seguro para o requisito
 * "mexer em uma unica linha sem mexer nas outras".
 */
export function replaceSingleLine(text: string, line: number, newText: string): string {
  return applyLinePatch(text, [{ kind: 'replace', line, text: newText }]).after;
}
