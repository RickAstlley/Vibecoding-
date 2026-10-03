import { describe, expect, it } from 'vitest';
import {
  isBareSpecifier,
  isExternalUrl,
  packageEntry,
  resolveExports,
  resolveRelativePath,
  splitPackage,
} from '@/core/build/resolver';
import { ensureJsxRuntime, rewriteImports, stripNonNull, stripTypes, transform, transformJsx } from '@/core/build/transform';
import { buildPreviewHtml, collectSpecifiers } from '@/core/build/bundler';

describe('resolver - caminhos', () => {
  it('resolve relativo', () => {
    expect(resolveRelativePath('src/main.tsx', './App')).toBe('src/App');
    expect(resolveRelativePath('src/ui/Button.tsx', '../utils')).toBe('src/utils');
    expect(resolveRelativePath('src/main.tsx', './lib/deep/x')).toBe('src/lib/deep/x');
  });

  it('identifica bare specifier', () => {
    expect(isBareSpecifier('react')).toBe(true);
    expect(isBareSpecifier('@scope/pkg/sub')).toBe(true);
    expect(isBareSpecifier('./local')).toBe(false);
    expect(isBareSpecifier('/abs')).toBe(false);
    expect(isBareSpecifier('https://cdn/x.js')).toBe(false);
  });

  it('identifica URL externa', () => {
    expect(isExternalUrl('https://cdn/x.js')).toBe(true);
    expect(isExternalUrl('./x')).toBe(false);
  });

  it('separa pacote e subpath', () => {
    expect(splitPackage('react')).toEqual({ name: 'react', subpath: '' });
    expect(splitPackage('react-dom/client')).toEqual({ name: 'react-dom', subpath: 'client' });
    expect(splitPackage('@scope/pkg/deep/path')).toEqual({ name: '@scope/pkg', subpath: 'deep/path' });
  });
});

describe('resolver - campo exports', () => {
  it('respeita condicoes na ordem browser > module > import', () => {
    const ex = { '.': { types: './t.d.ts', browser: './b.js', module: './m.js', default: './d.js' } };
    expect(resolveExports(ex, '')).toBe('./b.js');
  });

  it('usa subpath map', () => {
    const ex = { './client': './client.js', '.': './index.js' };
    expect(resolveExports(ex, 'client')).toBe('./client.js');
    expect(resolveExports(ex, '')).toBe('./index.js');
  });

  it('respeita wildcard', () => {
    expect(resolveExports({ './*': './lib/*.js' }, 'a/b')).toBe('./lib/a/b.js');
  });

  it('usa o primeiro alvo valido de um array', () => {
    // o resolver e puro e nao checa o disco: quem decide se o arquivo existe
    // e a etapa seguinte, que ainda pode cair no proximo candidato.
    expect(resolveExports(['./missing.js', './fallback.js'], '')).toBe('./missing.js');
    expect(resolveExports(['./a.js'], '')).toBe('./a.js');
  });

  it('retorna null para formato desconhecido', () => {
    expect(resolveExports(null, '')).toBeNull();
    expect(resolveExports(undefined, '')).toBeNull();
  });

  it('resolve entry de package.json real', () => {
    const pkg = {
      name: 'react-dom',
      version: '19.0.0',
      exports: {
        '.': { 'react-server': './react-dom.react-server.js', default: './index.js' },
        './client': { default: './client.js' },
      },
    };
    expect(packageEntry(pkg, '')).toBe('./index.js');
    expect(packageEntry(pkg, 'client')).toBe('./client.js');
  });

  it('usa browser como string antes de main', () => {
    expect(packageEntry({ browser: './web.js', main: './node.js' }, '')).toBe('./web.js');
  });

  it('cai em module/main quando nao ha exports', () => {
    expect(packageEntry({ module: './m.js', main: './n.js' }, '')).toBe('./m.js');
    expect(packageEntry({ main: './n.js' }, '')).toBe('./n.js');
    expect(packageEntry({}, '')).toBe('./index.js');
  });
});

describe('transform - remocao de tipos', () => {
  it('remove interface', () => {
    const src = ['interface Props {', '  title: string;', '}', 'export const a = 1;'].join('\n');
    const out = stripTypes(src, '.ts');
    expect(out).not.toContain('interface Props');
    expect(out).toContain('export const a = 1;');
  });

  it('remove type alias', () => {
    const src = 'type Id = string;\nexport const b = 2;';
    expect(stripTypes(src, '.ts')).not.toContain('type Id');
  });

  it('remove import type', () => {
    const src = "import type { Foo } from './foo';\nconst x = 1;";
    expect(stripTypes(src, '.ts')).not.toContain('import type');
  });

  it('remove anotacao de variavel', () => {
    expect(stripTypes('const a: string = "x";', '.ts')).toBe('const a = "x";');
    expect(stripTypes('let n: number = 1;', '.ts')).toBe('let n = 1;');
  });

  it('remove anotacao de retorno', () => {
    expect(stripTypes('function f(): string { return "x"; }', '.ts')).toContain('function f() {');
  });

  it('remove tipo de parametro', () => {
    const out = stripTypes('function f(a: string, b: number) { return a; }', '.ts');
    expect(out).toContain('function f(a, b)');
  });

  it('nao quebra anotacao de objeto literal', () => {
    const out = stripTypes('const o = { a: 1, b: "x" };', '.ts');
    expect(out).toContain('a: 1');
    expect(out).toContain('b: "x"');
  });

  it('nao quebra ternario', () => {
    const out = stripTypes('const x = cond ? 1 : 2;', '.ts');
    expect(out).toBe('const x = cond ? 1 : 2;');
  });

  it('nao quebra string com dois pontos', () => {
    const out = stripTypes('const u = "http://exemplo.com:8080";', '.ts');
    expect(out).toContain('http://exemplo.com:8080');
  });

  it('remove satisfies', () => {
    expect(stripTypes('const c = { a: 1 } satisfies Config;', '.ts')).toBe('const c = { a: 1 };');
  });

  it('remove parametro opcional em metodo', () => {
    expect(stripTypes('function f(a?) {}', '.ts')).toContain('function f(a) {}');
  });

  it('remove generic de chamada em .ts', () => {
    const out = stripTypes('const v = useState<string>(null);', '.ts');
    expect(out).not.toContain('<string>');
  });

  it('em .tsx remove generic de chamada mas preserva JSX', () => {
    expect(stripTypes('const v = useState<string>(null);', '.tsx')).toBe('const v = useState(null);');
    expect(stripTypes('const a = <Card<string> />;', '.tsx')).toContain('<Card<string> />');
    expect(stripTypes('const a = cond ? <b>x</b> : <i>y</i>;', '.tsx')).toContain('<b>x</b>');
  });
});

describe('transform - non-null assertion', () => {
  it('remove ! de non-null', () => {
    expect(stripNonNull('const a = b!.c;')).toBe('const a = b.c;');
    expect(stripNonNull('const a = obj!.prop!.deep;')).toBe('const a = obj.prop.deep;');
  });

  it('preserva negacao logica', () => {
    expect(stripNonNull('if (!x) return;')).toBe('if (!x) return;');
    expect(stripNonNull('const a = !b;')).toBe('const a = !b;');
    expect(stripNonNull('const a = b !== c;')).toBe('const a = b !== c;');
  });
});

describe('transform - JSX', () => {
  it('converte elemento simples', () => {
    const out = transformJsx('const a = <div>oi</div>;', { extension: '.tsx' });
    expect(out).toContain('React.createElement("div", null, "oi")');
  });

  it('converte elemento com atributo string', () => {
    const out = transformJsx('const a = <div className="x">oi</div>;', { extension: '.tsx' });
    expect(out).toContain('"className": "x"');
  });

  it('converte expressao em filho', () => {
    const out = transformJsx('const a = <p>{valor}</p>;', { extension: '.tsx' });
    expect(out).toContain('React.createElement("p", null, valor)');
  });

  it('converte varios filhos', () => {
    const out = transformJsx('const a = <div><p>1</p><p>2</p></div>;', { extension: '.tsx' });
    expect(out).toContain('React.createElement("p", null, "1")');
    expect(out).toContain('React.createElement("p", null, "2")');
  });

  it('converte componente com nome maiusculo', () => {
    const out = transformJsx('const a = <Card title="x" />;', { extension: '.tsx' });
    expect(out).toContain('React.createElement(Card, null, { "title": "x" })');
  });

  it('trata elemento HTML como string e componente como identificador', () => {
    const out = transformJsx('const a = <Button><span>ok</span></Button>;', { extension: '.tsx' });
    expect(out).toContain('React.createElement(Button, null,');
    expect(out).toContain('React.createElement("span", null, "ok")');
  });

  it('converte fragmento', () => {
    const out = transformJsx('const a = <><p>1</p><p>2</p></>;', { extension: '.tsx' });
    expect(out).toContain('React.createElement(_Fragment, null,');
  });

  it('converte elemento self-closing', () => {
    const out = transformJsx('const a = <br />;', { extension: '.tsx' });
    expect(out).toContain('React.createElement("br", null)');
  });

  it('suporta spread de props', () => {
    const out = transformJsx('const a = <div {...rest} id="x" />;', { extension: '.tsx' });
    expect(out).toContain('...rest');
    expect(out).toContain('"id": "x"');
  });

  it('suporta handler como expressao', () => {
    const out = transformJsx('const a = <button onClick={() => f()}>ok</button>;', { extension: '.tsx' });
    expect(out).toContain('"onClick": () => f()');
  });

  it('suporta comparacao dentro de JSX', () => {
    const out = transformJsx('const a = <p>{n > 3 ? "muitos" : "poucos"}</p>;', { extension: '.tsx' });
    expect(out).toContain('n > 3 ? "muitos" : "poucos"');
  });

  it('nao quebra menor em expressao numerica', () => {
    const out = transformJsx('const a = <p>{a < b ? 1 : 2}</p>;', { extension: '.tsx' });
    expect(out).toContain('a < b ? 1 : 2');
  });

  it('nao toca em string com JSX dentro', () => {
    const out = transformJsx('const s = "<div>";', { extension: '.tsx' });
    expect(out).toContain('"<div>"');
  });

  it('nao toca em comentario com JSX', () => {
    const out = transformJsx('// ver <div>\nconst a = 1;', { extension: '.tsx' });
    expect(out).toContain('// ver <div>');
  });

  it('converte elemento aninhado profundo', () => {
    const src = 'const a = <ul><li><a href="/x">link</a></li></ul>;';
    const out = transformJsx(src, { extension: '.tsx' });
    expect(out).toContain('React.createElement("ul", null,');
    expect(out).toContain('React.createElement("a", null, { "href": "/x" }, "link")');
  });
});

describe('transform - pipeline', () => {
  it('transforma arquivo tsx completo', () => {
    const src = [
      "import { useState } from 'react';",
      '',
      'interface Props { title: string }',
      '',
      'export function Card({ title }: Props) {',
      '  const [n, setN] = useState<number>(0);',
      '  return <div className="card">{title}</div>;',
      '}',
    ].join('\n');

    const out = transform(src, { extension: '.tsx', filename: 'Card.tsx' });
    expect(out).not.toContain('interface Props');
    expect(out).not.toContain('useState<number>');
    expect(out).toContain('React.createElement("div"');
  });

  it('transforma arquivo ts', () => {
    const src = 'export function add(a: number, b: number): number {\n  return a + b;\n}';
    const out = transform(src, { extension: '.ts' });
    expect(out).toContain('export function add(a, b) {');
    expect(out).not.toContain(': number');
  });
});

describe('transform - jsx runtime', () => {
  it('injeta import do jsx-runtime no modo automatico', () => {
    const out = ensureJsxRuntime('const a = 1;', { extension: '.tsx' });
    expect(out).toContain('react/jsx-runtime');
  });

  it('injeta React no modo classico', () => {
    const out = ensureJsxRuntime('const a = 1;', { extension: '.tsx', jsxAutomatic: false });
    expect(out).toContain("import React from 'react'");
  });

  it('nao duplica se ja importa React', () => {
    const src = "import React from 'react';\nconst a = 1;";
    const out = ensureJsxRuntime(src, { extension: '.tsx', jsxAutomatic: false });
    expect(out.match(/import React/g)).toHaveLength(1);
  });

  it('nao mexe em .ts', () => {
    expect(ensureJsxRuntime('const a = 1;', { extension: '.ts' })).toBe('const a = 1;');
  });
});

describe('collectSpecifiers', () => {
  it('extrai de todas as formas de import', () => {
    const src = [
      "import a from './a';",
      "import { b } from './b';",
      "const c = await import('./c');",
      "const d = require('./d');",
    ].join('\n');
    const specs = collectSpecifiers(src);
    expect(specs).toEqual(expect.arrayContaining(['./a', './b', './c', './d']));
  });

  it('ignora string que nao e import', () => {
    expect(collectSpecifiers('const s = "nao e import";')).toHaveLength(0);
  });
});

describe('rewriteImports', () => {
  const map = { react: '/__preview__/x.js', './local': '/__preview__/y.js' };

  it('reescreve from', () => {
    expect(rewriteImports("import a from 'react';", map)).toContain('/__preview__/x.js');
  });

  it('reescreve import dinamico', () => {
    expect(rewriteImports("const m = await import('react');", map)).toContain('/__preview__/x.js');
  });

  it('reescreve side-effect import', () => {
    expect(rewriteImports("import './local';", map)).toContain('/__preview__/y.js');
  });

  it('deixa intacto o que nao esta no mapa', () => {
    expect(rewriteImports("import a from './nao-mapeado';", map)).toContain("'./nao-mapeado'");
  });

  it('reescreve aspas duplas tambem', () => {
    expect(rewriteImports('import a from "react";', map)).toContain('/__preview__/x.js');
  });
});

describe('buildPreviewHtml', () => {
  it('injeta import map e module script', () => {
    const html = '<html><head><title>t</title></head><body><div id="root"></div></body></html>';
    const out = buildPreviewHtml(html, {
      ok: true,
      entryUrl: '/__preview__/src/main.tsx',
      files: [],
      importMap: '{"imports":{"react":"/x.js"}}',
      unresolved: [],
      errors: [],
      fromCdn: [],
      stats: { modules: 1, bytes: 1, projectModules: 1, cdnModules: 0 },
    });
    expect(out).toContain('type="importmap"');
    expect(out).toContain('src="/__preview__/src/main.tsx"');
  });

  it('substitui script module existente em vez de duplicar', () => {
    const html = '<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>';
    const out = buildPreviewHtml(html, {
      ok: true,
      entryUrl: '/__preview__/bundle.js',
      files: [],
      importMap: '{"imports":{}}',
      unresolved: [],
      errors: [],
      fromCdn: [],
      stats: { modules: 1, bytes: 1, projectModules: 1, cdnModules: 0 },
    });
    expect((out.match(/type="module"/g) ?? []).length).toBe(1);
    expect(out).toContain('src="/__preview__/bundle.js"');
  });

  it('escapa < no import map para nao fechar o script', () => {
    const html = '<html><head></head><body></body></html>';
    const out = buildPreviewHtml(html, {
      ok: true,
      entryUrl: '/x.js',
      files: [],
      importMap: '{"imports":{"a":"<b>"}}',
      unresolved: [],
      errors: [],
      fromCdn: [],
      stats: { modules: 1, bytes: 1, projectModules: 1, cdnModules: 0 },
    });
    expect(out).not.toContain('"a":"<b>"');
    expect(out).toContain('\\u003c');
  });
});