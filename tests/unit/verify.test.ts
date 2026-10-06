/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { verifySource, verifySourceAsync } from '@/core/patch/verify';

describe('verifySource - TSX (o caso React/Next)', () => {
  const valid = [
    "import { useState } from 'react';",
    '',
    'export function Card({ title }: { title: string }) {',
    '  const [open, setOpen] = useState(false);',
    '  return (',
    '    <div className="card" onClick={() => setOpen(!open)}>',
    '      <h2>{title}</h2>',
    "      {open && <p>Don't panic</p>}",
    '      <span>{open ? `aberto (${title.length})` : "fechado"}</span>',
    '    </div>',
    '  );',
    '}',
  ].join('\n');

  it('aprova TSX valido', () => {
    const r = verifySource('src/Card.tsx', valid, 'tsx');
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('nao trata apostrofo de texto JSX como abertura de string', () => {
    // "Don't panic" em texto JSX e legal; um parser ingenuo abriria string
    const src = 'export const A = () => <p>It\'s fine, don\'t worry</p>;';
    expect(verifySource('a.tsx', src, 'tsx').ok).toBe(true);
  });

  it('reprova tag de fechamento ausente em JSX', () => {
    const broken = [
      'export function A() {',
      '  return (',
      '    <div>',
      '      <p>oi</p>',
      '  );',
      '}',
    ].join('\n');
    const r = verifySource('a.tsx', broken, 'tsx');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.rule === 'jsx-tag')).toBe(true);
  });

  it('reprova chave nao fechada junto de JSX valido', () => {
    const broken = ['export function A() {', '  return <div>{open ? <b>1</b> : <i>2</i></div>;', '}'].join('\n');
    expect(verifySource('a.tsx', broken, 'tsx').ok).toBe(false);
  });

  it('reprova chave faltando dentro de expressao JSX', () => {
    const broken = 'export const A = () => <div>{cond ? <b>1</b> : <i>2</i></div>;';
    expect(verifySource('a.tsx', broken, 'tsx').ok).toBe(false);
  });

  it('reprova parenteses nao fechado', () => {
    const broken = 'export const A = () => (\n  <div>oi</div>\n;';
    expect(verifySource('a.tsx', broken, 'tsx').ok).toBe(false);
  });

  it('reprova colchete nao fechado em map', () => {
    const valid = 'const A = () => <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;';
    expect(verifySource('a.tsx', valid, 'tsx').ok).toBe(true);
    const realBroken = 'const A = () => <ul>{items.map((i) => <li key={i}>{i}</li>}</ul>;';
    expect(verifySource('a.tsx', realBroken, 'tsx').ok).toBe(false);
  });

  it('ignora chaves em strings e template literals', () => {
    const src = 'export const A = () => <p>{`{ unbalanced }`}</p>;';
    expect(verifySource('a.tsx', src, 'tsx').ok).toBe(true);
  });

  it('ignora chaves em comentarios', () => {
    const src = [
      '// abre {',
      'export const A = () => <div>/* tambem { */}oi</div>;',
    ].join('\n');
    expect(verifySource('a.tsx', src, 'tsx').ok).toBe(true);
  });

  it('aprova JSX valido', () => {
    const src = "export const A = () => <div className='x'>don't</div>;";
    expect(verifySource('a.jsx', src, 'jsx').ok).toBe(true);
  });

  it('detecta fragmento JSX nunca fechado', () => {
    const broken = 'export const A = () => <><p>a</p><p>b</p>;';
    const r = verifySource('a.jsx', broken, 'jsx');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.rule === 'jsx-tag')).toBe(true);
  });

  it('aprova fragmento JSX fechado', () => {
    expect(verifySource('a.jsx', 'export const A = () => <><p>a</p><p>b</p></>;', 'jsx').ok).toBe(true);
  });

  it('reprova tag de fechamento deletada', () => {
    const broken = 'export const A = () => <div><p>oi</div>;';
    expect(verifySource('a.tsx', broken, 'tsx').ok).toBe(false);
  });

  it('reprova tag de fechamento trocada', () => {
    const broken = 'export const A = () => <div><span>oi</div></span>;';
    expect(verifySource('a.tsx', broken, 'tsx').ok).toBe(false);
  });

  it('acepta tags self-closing e void', () => {
    const src = 'export const A = () => <div><br /><img src="x.png" /><Foo /></div>;';
    expect(verifySource('a.tsx', src, 'tsx').ok).toBe(true);
  });

  it('acepta componente com ponto e dois-pontos no nome', () => {
    const src = 'export const A = () => <Form.Input><Form.Label>x</Form.Label></Form.Input>;';
    expect(verifySource('a.tsx', src, 'tsx').ok).toBe(true);
  });

  it('nao confunde tag dentro de string', () => {
    const src = 'export const A = () => <p>{"<div>nao e tag"}</p>;';
    expect(verifySource('a.tsx', src, 'tsx').ok).toBe(true);
  });

  it('aguenta operador de comparacao dentro de expressao', () => {
    const src = 'export const A = () => <p>{a < b ? <b>menor</b> : <i>maior</i>}</p>;';
    expect(verifySource('a.tsx', src, 'tsx').ok).toBe(true);
  });

  it('aguenta arrow function com corpo em bloco dentro de prop', () => {
    const src = 'export const A = () => <button onClick={() => { doSomething(); }}>ok</button>;';
    expect(verifySource('a.tsx', src, 'tsx').ok).toBe(true);
  });

  it('aguenta operador greater-than em expressao (nao confundindo com tag)', () => {
    const src = 'export const A = () => <p>{count > 3 ? "muitos" : "poucos"}</p>;';
    expect(verifySource('a.tsx', src, 'tsx').ok).toBe(true);
  });
});

describe('verifySource - YAML', () => {
  it('aprova YAML valido', () => {
    const src = 'name: projeto\nversion: 1.0\nitems:\n  - a\n  - b\n';
    expect(verifySource('a.yml', src, 'yaml').ok).toBe(true);
  });

  it('reprova tab na indentacao', () => {
    const src = 'items:\n\t- a\n';
    const r = verifySource('a.yml', src, 'yaml');
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.rule).toBe('yaml');
  });

  it('reprova aspas desbalanceadas', () => {
    expect(verifySource('a.yml', 'name: "projeto\n', 'yaml').ok).toBe(false);
  });
});

describe('verifySource - shell', () => {
  it('aprova script valido', () => {
    const src = '#!/bin/bash\nset -e\nfor f in *.txt; do\n  echo "$f"\ndone\n';
    expect(verifySource('a.sh', src, 'shell').ok).toBe(true);
  });

  it('reprova parentese nao fechado', () => {
    expect(verifySource('a.sh', 'echo $(date\n', 'shell').ok).toBe(false);
  });

  it('ignora parentese em comentario', () => {
    expect(verifySource('a.sh', '# comentario com ( \necho ok\n', 'shell').ok).toBe(true);
  });
});

describe('verifySource - regressao TS/JS', () => {
  it('continua aprovando TS valido', () => {
    expect(verifySource('a.ts', 'const a = { b: 1 };\nfunction f() { return a.b; }', 'typescript').ok).toBe(true);
  });

  it('continua reprovando TS quebrado', () => {
    expect(verifySource('a.ts', 'function f() {\n  return 1;\n', 'typescript').ok).toBe(false);
  });

  it('nao conta chave em string TS', () => {
    expect(verifySource('a.ts', 'const s = "{ }";\nconst t = 1;', 'typescript').ok).toBe(true);
  });
});

describe('verifySourceAsync - verificacao real com esbuild', () => {
  it('aprova TSX valido com generics e template strings aninhadas', async () => {
    const src = [
      'interface Props<T> { items: T[] }',
      '',
      'export function List<T>({ items }: Props<T>) {',
      '  return <ul>{items.map(i => <li key={i}>{`item-${i}`}</li>)}</ul>;',
      '}',
    ].join('\n');
    const r = await verifySourceAsync('a.tsx', src, 'tsx');
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('reprova erro de sintaxe que o contador de chaves nao pega: const x = ;', async () => {
    const broken = 'const x = ;';
    const r = await verifySourceAsync('a.ts', broken, 'typescript');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.rule === 'esbuild-syntax')).toBe(true);
  });

  it('reprova erro de sintaxe que o contador de chaves nao pega: chave aberta em expressao JSX', async () => {
    const broken = 'export const A = () => <div>{cond ? <b>1</b> : <i>2</i></div>;';
    const r = await verifySourceAsync('a.tsx', broken, 'tsx');
    expect(r.ok).toBe(false);
  });

  it('reprova funcao com parametro desestruturado sem fechamento de paren', async () => {
    const broken = 'function f({ a, b) { return a + b; }';
    const r = await verifySourceAsync('a.js', broken, 'javascript');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.rule === 'esbuild-syntax')).toBe(true);
  });

  it('reprova JSX com tag de fechamento deletada (erro real do parser)', async () => {
    const broken = 'export const A = () => <div><span>oi</div>;';
    const r = await verifySourceAsync('a.tsx', broken, 'tsx');
    expect(r.ok).toBe(false);
  });

  it('continua usando heuristica para YAML quando esbuild falha', async () => {
    const r = await verifySourceAsync('a.yml', 'items:\n\t- a\n', 'yaml');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.rule === 'yaml')).toBe(true);
  });

  it('detecta variavel declarada sem nome como erro', async () => {
    const broken = 'const = 1;';
    const r = await verifySourceAsync('a.ts', broken, 'typescript');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.rule === 'esbuild-syntax')).toBe(true);
  });

  it('aprova codigo valido complexo', async () => {
    const src = 'const fn = async <T,>(arr: T[]): Promise<T[]> => arr.map(x => x);';
    const r = await verifySourceAsync('a.tsx', src, 'tsx');
    expect(r.ok).toBe(true);
  });
});