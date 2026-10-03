export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export interface CostRate {
  inputPerMTok: number;
  outputPerMTok: number;
}

const RATES: Record<string, CostRate> = {
  'nvidia-nim': { inputPerMTok: 0.2, outputPerMTok: 0.6 },
  openai: { inputPerMTok: 2.5, outputPerMTok: 10 },
  anthropic: { inputPerMTok: 3, outputPerMTok: 15 },
  google: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  openrouter: { inputPerMTok: 3, outputPerMTok: 12 },
  groq: { inputPerMTok: 0.59, outputPerMTok: 0.79 },
  ollama: { inputPerMTok: 0, outputPerMTok: 0 },
  lmstudio: { inputPerMTok: 0, outputPerMTok: 0 },
  custom: { inputPerMTok: 0, outputPerMTok: 0 },
};

export function costOf(providerId: string, usage: TokenUsage): number {
  const rate = RATES[providerId] ?? { inputPerMTok: 0, outputPerMTok: 0 };
  return (usage.promptTokens / 1e6) * rate.inputPerMTok + (usage.completionTokens / 1e6) * rate.outputPerMTok;
}

export function formatCost(value: number): string {
  if (value === 0) return 'US$ 0,00';
  if (value < 0.01) return `US$ ${value.toFixed(4)}`;
  return `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const AVG_CHARS_PER_TOKEN = 3.6;

/**
 * Estimativa de tokens. Multi-byte (acentos, emoji, CJK) consome
 * mais tokens que a media ASCII, por isso o ajuste.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  let multibyte = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0x7f) multibyte++;
  }
  const asciiChars = text.length - multibyte;
  return Math.ceil(asciiChars / AVG_CHARS_PER_TOKEN + multibyte / 1.5);
}

export function estimateMessagesTokens(messages: Array<{ content: string }>, overheadPerMessage = 4): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content) + overheadPerMessage;
  }
  return total;
}

export function savingsPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - after / before) * 100)));
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
