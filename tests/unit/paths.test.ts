import { describe, expect, it } from 'vitest';
import { PathError, basename, commonAncestor, dirname, extname, isAncestor, joinPath, normalizePath } from '@/core/vfs/paths';

describe('normalizePath', () => {
  it('normaliza barras e pontinhos', () => {
    expect(normalizePath('a//b/./c.ts')).toBe('a/b/c.ts');
    expect(normalizePath('./src/../src/index.ts')).toBe('src/index.ts');
    expect(normalizePath('a\\b\\c.ts')).toBe('a/b/c.ts');
  });

  it('rejeita path traversal', () => {
    expect(() => normalizePath('../etc/passwd')).toThrow(PathError);
    expect(() => normalizePath('a/../../x')).toThrow(PathError);
    expect(() => normalizePath('a/b/../../../x')).toThrow(PathError);
  });

  it('rejeita caminhos absolutos e drive letter', () => {
    expect(() => normalizePath('/etc/passwd')).toThrow(PathError);
    expect(() => normalizePath('C:/Windows')).toThrow(PathError);
  });

  it('rejeita segmentos nulos ou invalidos', () => {
    expect(() => normalizePath('a/\0b')).toThrow(PathError);
    expect(() => normalizePath('a/b|c')).toThrow(PathError);
  });

  it('rejeita entrada vazia ou que resolve para a raiz', () => {
    expect(() => normalizePath('')).toThrow(PathError);
    expect(() => normalizePath('.')).toThrow(PathError);
    expect(() => normalizePath('a/..')).toThrow(PathError);
  });
});

describe('helpers de caminho', () => {
  it('dirname e basename', () => {
    expect(dirname('a/b/c.ts')).toBe('a/b');
    expect(dirname('c.ts')).toBe('');
    expect(basename('a/b/c.ts')).toBe('c.ts');
  });

  it('extname em caixa baixa', () => {
    expect(extname('src/App.TSX')).toBe('.tsx');
    expect(extname('Dockerfile')).toBe('');
    expect(extname('.gitignore')).toBe('');
  });

  it('isAncestor', () => {
    expect(isAncestor('src', 'src/a/b.ts')).toBe(true);
    expect(isAncestor('src', 'src')).toBe(false);
    expect(isAncestor('src', 'srcx/a.ts')).toBe(false);
  });

  it('joinPath normaliza', () => {
    expect(joinPath('a', 'b', 'c.ts')).toBe('a/b/c.ts');
    expect(joinPath('a/', '/b')).toBe('a/b');
  });

  it('commonAncestor', () => {
    expect(commonAncestor(['a/b/c.ts', 'a/b/d.ts'])).toBe('a/b');
    expect(commonAncestor(['a/x.ts', 'b/y.ts'])).toBe('');
    expect(commonAncestor([])).toBe('');
  });
});
