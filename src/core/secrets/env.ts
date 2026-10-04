import { sha256Hex } from '@/lib/hash';

export type SecretKind = 'public' | 'secret';

export interface SecretEntry {
  key: string;
  value: string;
  kind: SecretKind;
}

export interface ParsedEnv {
  entries: SecretEntry[];
  /** Linhas que nao entraram no parse (comentarios soltos, texto). */
  skipped: string[];
  errors: string[];
}

const SECRET_HINTS = [
  'KEY',
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'PASSWD',
  'PASS',
  'CREDENTIAL',
  'PRIVATE',
  'AUTH',
  'SESSION',
  'SALT',
  'SIGNATURE',
  'CERT',
  'DSN',
  'URI',
  'URL',
];

const PUBLIC_ALLOW = new Set(['NODE_ENV', 'BROWSER', 'DEBUG', 'PORT', 'HOST', 'BASE_URL', 'PUBLIC_URL', 'MODE']);

export function looksSecret(key: string): boolean {
  const upper = key.toUpperCase();
  if (PUBLIC_ALLOW.has(upper)) return false;
  if (upper.startsWith('VITE_') || upper.startsWith('NEXT_PUBLIC_') || upper.startsWith('PUBLIC_')) return false;
  return SECRET_HINTS.some((hint) => upper.includes(hint));
}

export function mask(value: string): string {
  if (value.length === 0) return '';
  if (value.length <= 4) return '*'.repeat(value.length);
  if (value.length <= 10) return `${value.slice(0, 2)}${'*'.repeat(value.length - 4)}${value.slice(-2)}`;
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(12, value.length - 8))}${value.slice(-4)}`;
}

/** Parse de .env tolerante: aceita `=`, `:`, espacos e aspas. */
export function parseEnv(text: string): ParsedEnv {
  const entries: SecretEntry[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) return;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$/.exec(trimmed);
    if (!match) {
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*$/.test(trimmed)) {
        errors.push(`linha ${index + 1}: variavel sem valor (${trimmed})`);
      } else {
        skipped.push(trimmed);
      }
      return;
    }

    const key = match[1] as string;
    let value = (match[2] ?? '').trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      const hashIndex = value.indexOf(' #');
      if (hashIndex > 0) value = value.slice(0, hashIndex).trim();
    }

    entries.push({ key, value, kind: looksSecret(key) ? 'secret' : 'public' });
  });

  return { entries, skipped, errors };
}

export function serializeEnv(entries: SecretEntry[]): string {
  return entries
    .map((e) => (e.value === '' ? `${e.key}=` : `${e.key}=${/[\s#"'=]/.test(e.value) ? JSON.stringify(e.value) : e.value}`))
    .join('\n');
}

export function redact(text: string, keys: string[]): string {
  let out = text;
  for (const key of keys) {
    if (!looksSecret(key)) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(key)}\\b\\s*=\\s*("[^"]*"|'[^']*'|\\S*)`, 'g'), (match, value: string) => {
      const cleaned = value.replace(/^["']|["']$/g, '');
      return `${match.slice(0, match.indexOf(value))}${mask(cleaned)}`;
    });
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface SecretAudit {
  total: number;
  secret: number;
  public: number;
  /** Chaves cujo valor parece placeholder. */
  suspicious: Array<{ key: string; reason: string }>;
}

const PLACEHOLDERS = ['changeme', 'your-', 'xxx', 'todo', 'placeholder', 'example', 'test', 'fake', 'sk-xxx'];

export function audit(entries: SecretEntry[]): SecretAudit {
  const suspicious: SecretAudit['suspicious'] = [];

  for (const entry of entries) {
    if (entry.kind !== 'secret') continue;
    const lower = entry.value.toLowerCase();
    if (entry.value.length === 0) {
      suspicious.push({ key: entry.key, reason: 'vazio' });
      continue;
    }
    if (entry.value.length < 12) {
      suspicious.push({ key: entry.key, reason: 'curto demais para um segredo' });
      continue;
    }
    if (PLACEHOLDERS.some((p) => lower.includes(p))) {
      suspicious.push({ key: entry.key, reason: 'parece placeholder' });
    }
  }

  return {
    total: entries.length,
    secret: entries.filter((e) => e.kind === 'secret').length,
    public: entries.filter((e) => e.kind === 'public').length,
    suspicious,
  };
}

/**
 * Substitui segredos por valores do ambiente de execucao, sem persistir.
 * Usado antes de enviar o projeto para o endpoint remoto.
 */
export function applyRuntimeEnv(
  content: string,
  path: string,
  runtimeEnv: Record<string, string>,
): string {
  const name = path.split('/').pop() ?? '';
  if (!/^\.env/.test(name)) return content;

  const parsed = parseEnv(content);
  const merged = parsed.entries.map((entry) => {
    const override = runtimeEnv[entry.key];
    return override === undefined ? entry : { ...entry, value: override };
  });

  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (!merged.some((e) => e.key === key)) merged.push({ key, value, kind: looksSecret(key) ? 'secret' : 'public' });
  }

  return serializeEnv(merged);
}

/** Chave de identificacao anonima de um segredo, para detectaar reuso. */
export async function fingerprint(value: string): Promise<string> {
  return (await sha256Hex(value)).slice(0, 12);
}

export const ENV_TEMPLATE = `# Variaveis de ambiente
# Chaves com KEY/TOKEN/SECRET/PASSWORD sao mascaradas automaticamente na interface.

VITE_API_URL=https://api.exemplo.com
DATABASE_URL=postgresql://usuario:senha@localhost:5432/app
API_TOKEN=
`;