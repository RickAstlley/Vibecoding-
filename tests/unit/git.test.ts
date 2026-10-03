import { describe, expect, it } from 'vitest';
import { checkoutPath, initialsOf, isClean } from '@/core/git/repo';
import { countChangedLines } from '@/core/git/diff';

describe('countChangedLines', () => {
  it('conta linha modificada como +1/-1, como o git', () => {
    expect(countChangedLines('a\nb\nc', 'a\nB\nc')).toEqual({ added: 1, removed: 1 });
  });

  it('conta linhas novas e removidas', () => {
    expect(countChangedLines('a', 'a\nb\nc')).toEqual({ added: 2, removed: 0 });
    expect(countChangedLines('a\nb\nc', 'a')).toEqual({ added: 0, removed: 2 });
  });

  it('devolve zero quando identico', () => {
    expect(countChangedLines('a\nb', 'a\nb')).toEqual({ added: 0, removed: 0 });
  });

  it('detecta reordenacao como alteracao', () => {
    // multiconjunto diria "sem mudanca"; o git diz que mudou
    expect(countChangedLines('a\nb', 'b\na')).toEqual({ added: 1, removed: 1 });
  });

  it('trata arquivo novo e removido', () => {
    expect(countChangedLines(null, 'a\nb')).toEqual({ added: 2, removed: 0 });
    expect(countChangedLines('a\nb', null)).toEqual({ added: 0, removed: 2 });
  });
});

describe('checkoutPath', () => {
  const file = (path: string, hash: string) => ({ path, content: null, hash });

  it('lista arquivos que diferem entre dois commits', () => {
    const from = { files: [file('a.ts', '1'), file('b.ts', '1')] };
    const to = { files: [file('a.ts', '2'), file('b.ts', '1')] };
    expect(checkoutPath(from as never, to as never)).toEqual(['a.ts']);
  });

  it('inclui arquivo criado', () => {
    const from = { files: [file('a.ts', '1')] };
    const to = { files: [file('a.ts', '1'), file('c.ts', '1')] };
    expect(checkoutPath(from as never, to as never)).toEqual(['c.ts']);
  });

  it('inclui arquivo removido', () => {
    const from = { files: [file('a.ts', '1'), file('b.ts', '1')] };
    const to = { files: [file('a.ts', '1')] };
    expect(checkoutPath(from as never, to as never)).toEqual(['b.ts']);
  });

  it('devolve vazio quando nao ha commits', () => {
    expect(checkoutPath(null, null)).toEqual([]);
    expect(checkoutPath(null, { files: [] } as never)).toEqual([]);
  });
});

describe('isClean', () => {
  it('true quando nao ha mudancas', () => {
    expect(isClean([])).toBe(true);
  });

  it('false quando ha mudancas', () => {
    expect(isClean([{ path: 'a.ts', kind: 'modify', before: null, after: null, added: 1, removed: 1 }])).toBe(false);
  });
});

describe('initialsOf', () => {
  it('duas iniciais de nome completo', () => {
    expect(initialsOf('Ana Souza')).toBe('AS');
  });

  it('duas letras de nome unico', () => {
    expect(initialsOf('arcanum')).toBe('AR');
  });

  it('trata autor vazio', () => {
    expect(initialsOf('  ')).toBe('?');
  });
});