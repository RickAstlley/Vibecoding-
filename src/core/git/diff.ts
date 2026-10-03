const MAX_LCS_CELLS = 4_000_000;

/**
 * Contagem de linhas alteradas, no mesmo criterio do git.
 *
 * Usa LCS para respeitar ordem: reordenar linhas conta como mudanca
 * (como o git faz), enquanto trocar uma linha conta como -1/+1 no padrao
 * de contagem de diff. Multiconjunto seria mais barato, mas esconderia
 * reordenacao - exatamente o que o usuario precisa ver.
 */
export function countChangedLines(before: string | null, after: string | null): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 };

  const a = before === null ? [] : before.split('\n');
  const b = after === null ? [] : after.split('\n');

  // Arquivo grande demais para LCS: cai para contagem por multiconjunto.
  if (a.length * b.length > MAX_LCS_CELLS) {
    return multisetDiff(a, b);
  }

  let prev = new Uint32Array(b.length + 1);
  let curr = new Uint32Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = 0;
    const rowA = a[i - 1] as string;
    for (let j = 1; j <= b.length; j++) {
      if (rowA === b[j - 1]) {
        curr[j] = (prev[j - 1] ?? 0) + 1;
      } else {
        const left = prev[j] ?? 0;
        const up = curr[j - 1] ?? 0;
        curr[j] = left >= up ? left : up;
      }
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  const common = prev[b.length] ?? 0;
  return { added: b.length - common, removed: a.length - common };
}

function multisetDiff(a: string[], b: string[]): { added: number; removed: number } {
  const pool = new Map<string, number>();
  for (const line of b) pool.set(line, (pool.get(line) ?? 0) + 1);
  let matched = 0;
  for (const line of a) {
    const count = pool.get(line) ?? 0;
    if (count > 0) {
      pool.set(line, count - 1);
      matched++;
    }
  }
  return { added: b.length - matched, removed: a.length - matched };
}

/** Resumo curto de um conjunto de mudancas. */
export function summarize(changes: Array<{ added: number; removed: number }>): string {
  const added = changes.reduce((acc, c) => acc + c.added, 0);
  const removed = changes.reduce((acc, c) => acc + c.removed, 0);
  if (added === 0 && removed === 0) return 'sem mudancas de conteudo';
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`-${removed}`);
  return parts.join(' / ');
}