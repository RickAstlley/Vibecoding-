import { describe, expect, it } from 'vitest';
import { applyRuntimeEnv, audit, looksSecret, mask, parseEnv, redact, serializeEnv } from '@/core/secrets/env';

describe('looksSecret', () => {
  it('detecta chaves Tipicas de segredo', () => {
    for (const key of ['API_KEY', 'AUTH_TOKEN', 'DB_PASSWORD', 'SESSION_SECRET', 'JWT_SIGNATURE']) {
      expect(looksSecret(key)).toBe(true);
    }
  });

  it('nao marca variaveis publicas', () => {
    for (const key of ['NODE_ENV', 'VITE_API_URL', 'NEXT_PUBLIC_FLAG', 'PORT']) {
      expect(looksSecret(key)).toBe(false);
    }
  });

  it('trata prefixo PUBLIC_ como publico', () => {
    expect(looksSecret('PUBLIC_SENTRY_DSN')).toBe(false);
    expect(looksSecret('SECRET_SENTRY_DSN')).toBe(true);
  });
});

describe('mask', () => {
  it('esconde o meio e mantem as pontas', () => {
    expect(mask('sk-1234567890abcdef')).toMatch(/^sk-1.*cdef$/);
  });

  it('mascara tudo quando curto', () => {
    expect(mask('abc')).toBe('***');
    expect(mask('')).toBe('');
  });

  it('nunca devolve o valor inteiro', () => {
    const secret = 'super-secreto-de-32-caracteres';
    expect(mask(secret)).not.toContain('secreto-de-32');
  });
});

describe('parseEnv', () => {
  it('parseia pares simples', () => {
    const r = parseEnv('API_KEY=abc123\nNODE_ENV=production');
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toEqual({ key: 'API_KEY', value: 'abc123', kind: 'secret' });
    expect(r.entries[1]?.kind).toBe('public');
  });

  it('aceita export e espacos', () => {
    const r = parseEnv('export FOO = bar');
    expect(r.entries[0]).toEqual({ key: 'FOO', value: 'bar', kind: 'public' });
  });

  it('remove aspas', () => {
    expect(parseEnv('A="com espaco"').entries[0]?.value).toBe('com espaco');
    expect(parseEnv("B='simples'").entries[0]?.value).toBe('simples');
  });

  it('remove comentario inline', () => {
    expect(parseEnv('A=valor # nota').entries[0]?.value).toBe('valor');
  });

  it('ignora linhas vazias e comentarios', () => {
    expect(parseEnv('\n# nota\n\nA=1').entries).toHaveLength(1);
  });

  it('reporta variavel sem valor', () => {
    const r = parseEnv('SO_UM_NOME');
    expect(r.errors[0]).toContain('linha 1');
    expect(r.entries).toHaveLength(0);
  });

  it('reporta linha nao interpretavel', () => {
    expect(parseEnv('isto nao e env').skipped).toHaveLength(1);
  });

  it('mantem valor com sinal de igual', () => {
    expect(parseEnv('QUERY=a=b&c=d').entries[0]?.value).toBe('a=b&c=d');
  });
});

describe('serializeEnv', () => {
  it('faz round-trip', () => {
    const original = 'A=1\nB=dois';
    const parsed = parseEnv(original);
    expect(serializeEnv(parsed.entries)).toBe(original);
  });

  it('aspas valores com espaco ou hashtag', () => {
    const out = serializeEnv([{ key: 'A', value: 'com espaco', kind: 'public' }]);
    expect(parseEnv(out).entries[0]?.value).toBe('com espaco');
  });

  it('mantem vazio como vazio', () => {
    expect(serializeEnv([{ key: 'A', value: '', kind: 'secret' }])).toBe('A=');
  });
});

describe('redact', () => {
  it('mascara o valor de um segredo', () => {
    const out = redact('API_KEY=sk-1234567890abcdefgh', ['API_KEY']);
    expect(out).not.toContain('1234567890abcdefgh');
    expect(out).toContain('API_KEY=');
  });

  it('nao mascara variavel publica', () => {
    const out = redact('VITE_API_URL=https://api.exemplo.com', ['VITE_API_URL']);
    expect(out).toContain('https://api.exemplo.com');
  });

  it('redige varios segredos', () => {
    const out = redact('A_TOKEN=aaaaaaaabbbbbbbb\nB_KEY=ccccccccdddddddd', ['A_TOKEN', 'B_KEY']);
    expect(out).not.toContain('aaaaaaaa');
    expect(out).not.toContain('cccccccc');
  });
});

describe('audit', () => {
  it('separa segredos de publicas', () => {
    const r = audit(parseEnv('API_KEY=sk-abcdefghijklmnop\nNODE_ENV=prod').entries);
    expect(r.total).toBe(2);
    expect(r.secret).toBe(1);
    expect(r.public).toBe(1);
  });

  it('sinaliza segredo vazio', () => {
    const r = audit(parseEnv('API_KEY=').entries);
    expect(r.suspicious[0]?.reason).toBe('vazio');
  });

  it('sinaliza segredo curto', () => {
    const r = audit(parseEnv('API_TOKEN=abc').entries);
    expect(r.suspicious[0]?.reason).toContain('curto');
  });

  it('sinaliza placeholder', () => {
    const r = audit(parseEnv('API_TOKEN=your-token-here-1234').entries);
    expect(r.suspicious.some((s) => s.reason.includes('placeholder'))).toBe(true);
  });

  it('nao sinaliza segredo robusto', () => {
    const r = audit(parseEnv('API_TOKEN=xK9$mQp2#vL7@wR4!tY6').entries);
    expect(r.suspicious).toHaveLength(0);
  });
});

describe('applyRuntimeEnv', () => {
  it('sobrescreve valor existente', () => {
    const out = applyRuntimeEnv('API_KEY=antigo', '.env', { API_KEY: 'novo' });
    expect(parseEnv(out).entries[0]?.value).toBe('novo');
  });

  it('adiciona variavel que nao existia', () => {
    const out = applyRuntimeEnv('A=1', '.env', { NOVA: 'valor' });
    expect(parseEnv(out).entries.map((e) => e.key)).toEqual(['A', 'NOVA']);
  });

  it('nao mexe em arquivo que nao e env', () => {
    expect(applyRuntimeEnv('qualquer coisa', 'src/app.ts', { A: '1' })).toBe('qualquer coisa');
  });

  it('aceita .env.local', () => {
    const out = applyRuntimeEnv('A=1', 'app/.env.local', { B: '2' });
    expect(parseEnv(out).entries).toHaveLength(2);
  });
});