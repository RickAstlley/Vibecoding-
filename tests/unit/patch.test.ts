import { describe, expect, it } from 'vitest';
import { applyLinePatch, replaceSingleLine, splitLines, LinePatchError } from '@/core/patch/line-edit';
import { extractAnchors, reanchor, applyAnchorOp, AnchorError } from '@/core/patch/anchors';
import { applySurgicalPatch, assertSingleFile, PatchRejection, type SurgicalContext } from '@/core/patch/surgical';
import { verifySource } from '@/core/patch/verify';
import { sha256Hex } from '@/lib/hash';

describe('applyLinePatch - edicao de uma unica linha', () => {
  const src = ['function a() {', '  const x = 1;', '  return x;', '}', '', 'function b() {', '  return 2;', '}'].join('\n');

  it('substitui exatamente uma linha preservando as demais', () => {
    const out = applyLinePatch(src, [{ kind: 'replace', line: 2, text: '  const x = 42;' }]);
    const before = splitLines(src);
    const after = splitLines(out.after);
    expect(after[1]).toBe('  const x = 42;');
    expect(out.changedLines).toEqual([2]);
    for (let i = 0; i < before.length; i++) {
      if (i === 1) continue;
      expect(after[i]).toBe(before[i]);
    }
  });

  it('replaceSingleLine e equivalente', () => {
    expect(replaceSingleLine(src, 6, 'function b() { return 3; }')).toContain('return 3;');
  });

  it('rejeita linha fora do intervalo', () => {
    expect(() => applyLinePatch(src, [{ kind: 'replace', line: 99, text: 'x' }])).toThrow(LinePatchError);
    expect(() => applyLinePatch(src, [{ kind: 'replace', line: 0, text: 'x' }])).toThrow(LinePatchError);
  });

  it('insert e delete deslocam apenas o necessario', () => {
    const ins = applyLinePatch(src, [{ kind: 'insert-before', line: 3, text: '  // nota' }]);
    expect(splitLines(ins.after)[2]).toBe('  // nota');
    expect(splitLines(ins.after)[3]).toBe('  return x;');
    expect(ins.totalAfter).toBe(ins.totalBefore + 1);

    const del = applyLinePatch(src, [{ kind: 'delete', line: 2 }]);
    expect(splitLines(del.after)).not.toContain('  const x = 1;');
    expect(del.totalAfter).toBe(ins.totalBefore - 1);
  });

  it('replace-range cobre intervalo', () => {
    const out = applyLinePatch(src, [{ kind: 'replace-range', from: 2, to: 3, text: '  const y = 2;\n  return y;' }]);
    expect(splitLines(out.after)[1]).toBe('  const y = 2;');
    expect(splitLines(out.after)[2]).toBe('  return y;');
  });

  it('preserva CRLF', () => {
    const crlf = src.replace(/\n/g, '\r\n');
    const out = applyLinePatch(crlf, [{ kind: 'replace', line: 1, text: 'function a() {' }]);
    expect(out.after).toContain('\r\n');
  });
});

describe('ancoras', () => {
  const src = [
    "import React from 'react';",
    "import { useState, useEffect } from 'react';",
    '',
    'export function Header({ title }: Props) {',
    '  return <h1>{title}</h1>;',
    '}',
    '',
    'export const CONFIG = { retries: 3 };',
  ].join('\n');

  it('extrai ancoras de declaracoes', () => {
    const anchors = extractAnchors('src/App.tsx', src);
    const names = anchors.map((a) => a.id);
    expect(names).toContain('React');
    expect(names).toContain('useState');
    expect(names).toContain('Header');
    expect(names).toContain('CONFIG');
  });

  it('reancora apos edicoes acima', () => {
    const anchors = extractAnchors('src/App.tsx', src);
    const header = anchors.find((a) => a.text === 'Header');
    expect(header).toBeDefined();
    const shifted = ['// nova linha 1', '// nova linha 2', src].join('\n');
    expect(reanchor(header!, shifted)).toBe(6);
  });

  it('substitui bloco ancorado', () => {
    const anchors = extractAnchors('src/App.tsx', src);
    const out = applyAnchorOp(src, anchors, {
      kind: 'replace-anchor',
      anchor: 'Header',
      text: 'export function Header({ title }: Props) {\n  return <h2>{title}</h2>;\n}',
    });
    expect(out.after).toContain('<h2>');
    expect(out.appliedAt).toBe(4);
  });

  it('insere antes da ancora com indentacao', () => {
    const anchors = extractAnchors('src/App.tsx', src);
    const out = applyAnchorOp(src, anchors, { kind: 'insert-before-anchor', anchor: 'Header', text: '// antes' });
    expect(out.after.split('\n')[3]).toBe('// antes');
  });

  it('erra em ancora inexistente', () => {
    const anchors = extractAnchors('src/App.tsx', src);
    expect(() => applyAnchorOp(src, anchors, { kind: 'replace-anchor', anchor: 'naoExiste', text: 'x' })).toThrow(AnchorError);
  });
});

describe('verifySource', () => {
  it('aprova codigo valido', () => {
    expect(verifySource('a.ts', 'const a = { b: 1 };\nfunction f() { return a.b; }', 'typescript').ok).toBe(true);
  });

  it('reprova chave nao fechada', () => {
    const r = verifySource('a.ts', 'function f() {\n  return 1;\n', 'typescript');
    expect(r.ok).toBe(false);
  });

  it('reprova JSON invalido', () => {
    const r = verifySource('a.json', '{ "a": 1, }', 'json');
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.rule).toBe('json');
  });

  it('reprova HTML nao fechado', () => {
    expect(verifySource('a.html', '<div><span>oi</div>', 'html').ok).toBe(false);
  });

  it('ignora chaves dentro de strings e comentarios', () => {
    const src = 'const a = "{ unbalanced }"; // } {\nconst b = 2;';
    expect(verifySource('a.ts', src, 'typescript').ok).toBe(true);
  });
});

function memCtx(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const ctx: SurgicalContext = {
    read: async (p) => store.get(p) ?? null,
    hash: async (p) => {
      const c = store.get(p);
      return c === undefined ? null : sha256Hex(c);
    },
    exists: async (p) => store.has(p),
    write: async (p, c) => {
      store.set(p, c);
    },
  };
  return { ctx, store };
}

describe('assertSingleFile', () => {
  it('permite 1 arquivo', () => {
    expect(() => assertSingleFile(['src/a.ts'])).not.toThrow();
  });

  it('rejeita 2+ arquivos', () => {
    expect(() => assertSingleFile(['src/a.ts', 'src/b.ts'])).toThrow(PatchRejection);
  });
});

describe('applySurgicalPatch', () => {
  it('edita 1 linha sem tocar nos demais arquivos', async () => {
    const { ctx, store } = memCtx({ 'a.ts': 'const a = 1;\nconst b = 2;\n', 'b.ts': 'const c = 3;' });
    const bBefore = store.get('b.ts');
    const applied = await applySurgicalPatch({ level: 'line', path: 'a.ts', ops: [{ kind: 'replace', line: 2, text: 'const b = 99;' }] }, ctx);
    expect(applied.verified).toBe(true);
    expect(store.get('a.ts')).toBe('const a = 1;\nconst b = 99;\n');
    expect(store.get('b.ts')).toBe(bBefore);
    expect(applied.changedLines).toEqual([2]);
  });

  it('reescreve 1 arquivo mantendo os outros intocados', async () => {
    const { ctx, store } = memCtx({ 'a.ts': 'const a = 1;', 'b.ts': 'keep me' });
    await applySurgicalPatch({ level: 'file', path: 'a.ts', content: 'const a = 2;\nconst z = 3;' }, ctx);
    expect(store.get('a.ts')).toBe('const a = 2;\nconst z = 3;');
    expect(store.get('b.ts')).toBe('keep me');
  });

  it('reverte automaticamente patch que quebra sintaxe', async () => {
    const original = 'function f() {\n  return 1;\n}';
    const { ctx, store } = memCtx({ 'a.ts': original });
    await expect(
      applySurgicalPatch({ level: 'file', path: 'a.ts', content: 'function f() {\n  return 1;' }, ctx),
    ).rejects.toBeInstanceOf(PatchRejection);
    expect(store.get('a.ts')).toBe(original);
  });

  it('cria arquivo novo via level file', async () => {
    const { ctx, store } = memCtx({});
    await applySurgicalPatch({ level: 'file', path: 'novo.ts', content: 'export const ok = true;' }, ctx);
    expect(store.get('novo.ts')).toBe('export const ok = true;');
  });

  it('rejeita patch que nao altera nada', async () => {
    const { ctx } = memCtx({ 'a.ts': 'const a = 1;' });
    await expect(applySurgicalPatch({ level: 'file', path: 'a.ts', content: 'const a = 1;' }, ctx)).rejects.toThrow(/nao altera nada/);
  });
});
