import { describe, expect, it } from 'vitest';
import { ProjectIndex, chunkFile, renderContext, snippetOf, tokenize } from '@/core/rag';

const projeto: Array<{ path: string; content: string }> = [
  {
    path: 'src/auth/login.ts',
    content: [
      'export function authenticateUser(email: string, password: string) {',
      '  const user = findUser(email);',
      '  if (!user) return null;',
      '  return checkPassword(user, password);',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/ui/Button.tsx',
    content: [
      'export function Button({ label }: Props) {',
      '  return <button>{label}</button>;',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/auth/session.ts',
    content: ['export const SESSION_TTL = 3600;', 'export function createSession(userId: string) {}'].join('\n'),
  },
];

describe('tokenize', () => {
  it('quebra camelCase e snake_case', () => {
    const tokens = tokenize('useAuthToken create_session');
    expect(tokens).toContain('use');
    expect(tokens).toContain('auth');
    expect(tokens).toContain('token');
    expect(tokens).toContain('create');
    expect(tokens).toContain('session');
  });

  it('remove stopwords', () => {
    expect(tokenize('const function return')).not.toContain('const');
    expect(tokenize('the of and')).not.toContain('the');
  });
});

describe('chunkFile', () => {
  it('fatia por simbolo', () => {
    const chunks = chunkFile('a.ts', projeto[0]!.content);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.name === 'authenticateUser')).toBe(true);
  });

  it('registra caminho e linhas', () => {
    const chunks = chunkFile('src/auth/login.ts', projeto[0]!.content);
    expect(chunks[0]?.path).toBe('src/auth/login.ts');
    expect(chunks[0]?.startLine).toBe(1);
  });

  it('quebra simbolos grandes em varios chunks', () => {
    const big = Array.from({ length: 120 }, (_, i) => `  const x${i} = ${i};`).join('\n');
    const chunks = chunkFile('big.ts', big, 20);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('devolve vazio para arquivo vazio', () => {
    expect(chunkFile('vazio.ts', '')).toEqual([]);
  });
});

describe('ProjectIndex', () => {
  const index = new ProjectIndex();
  index.build(projeto);

  it('indexa todos os arquivos', () => {
    const stats = index.stats();
    expect(stats.files).toBe(3);
    expect(stats.chunks).toBeGreaterThan(0);
    expect(stats.terms).toBeGreaterThan(0);
  });

  it('acha simbolo pelo nome', () => {
    const hits = index.search('authenticateUser');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.chunk.path).toBe('src/auth/login.ts');
  });

  it('acha por termo em ingles mesmo escrevendo em portugues', () => {
    const hits = index.search('password');
    expect(hits.some((h) => h.chunk.path.includes('login'))).toBe(true);
  });

  it('acha por descricao funcional', () => {
    const hits = index.search('validar login do usuario');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('ordena por relevancia', () => {
    const hits = index.search('session');
    expect(hits.length).toBeGreaterThan(0);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    }
  });

  it('filtra por caminho', () => {
    const hits = index.search('export', 10, 'src/ui');
    expect(hits.every((h) => h.chunk.path.startsWith('src/ui'))).toBe(true);
  });

  it('nao quebra com consulta sem resultado', () => {
    expect(index.search('xyzabc123inexistente')).toHaveLength(0);
  });

  it('nao quebra com index vazio', () => {
    const empty = new ProjectIndex();
    empty.build([]);
    expect(empty.search('qualquer')).toHaveLength(0);
    expect(empty.stats().chunks).toBe(0);
  });

  it('respeita o limite de resultados', () => {
    expect(index.search('export', 2).length).toBeLessThanOrEqual(2);
  });

  it('lista simbolos para autocomplete', () => {
    const symbols = index.symbols('session');
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.some((s) => s.name.toLowerCase().includes('session'))).toBe(true);
  });

  it('destaca o trecho relevante', () => {
    const hit = index.search('authenticateUser')[0];
    expect(hit?.snippet).toContain('authenticateUser');
  });
});

describe('snippetOf', () => {
  it('centraliza no termo', () => {
    const text = 'a'.repeat(500) + 'ALVO' + 'b'.repeat(500);
    const out = snippetOf(text, ['alvo']);
    expect(out).toContain('ALVO');
    expect(out.length).toBeLessThan(300);
  });

  it('devolve o inicio quando o termo nao existe', () => {
    expect(snippetOf('texto curto', ['inexistente'])).toBe('texto curto');
  });
});

describe('renderContext', () => {
  it('formata hits com caminho e linhas', () => {
    const index = new ProjectIndex();
    index.build(projeto);
    const out = renderContext(index.search('authenticateUser'));
    expect(out).toContain('src/auth/login.ts:');
    expect(out).toContain('authenticateUser');
  });

  it('respeita o limite de caracteres', () => {
    const index = new ProjectIndex();
    index.build(projeto);
    const out = renderContext(index.search('export'), 500);
    expect(out.length).toBeLessThanOrEqual(500);
  });
});