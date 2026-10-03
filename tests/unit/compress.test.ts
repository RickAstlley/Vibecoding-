import { describe, expect, it } from 'vitest';
import {
  compressPrompt,
  extractLineRefs,
  findBoilerplate,
  layerDedupe,
  layerSketch,
  layerStrip,
  layerStructure,
  layerWindow,
} from '@/core/compress/pipeline';
import { estimateTokens } from '@/lib/tokens';

const bigFile = [
  "import { a } from './a';",
  "import { b } from './b';",
  '',
  'export function alpha() {',
  '  return 1;',
  '}',
  '',
  'export function beta() {',
  '  return 2;',
  '}',
  '',
  'export function gamma() {',
  '  return 3;',
  '}',
  '',
  'export function delta() {',
  '  return 4;',
  '}',
  '',
  'export function epsilon() {',
  '  return 5;',
  '}',
].join('\n');

describe('layerStrip', () => {
  it('remove comentarios de bloco', () => {
    const src = 'const a = 1;\n/* isto e um comentario\n   de varias linhas */\nconst b = 2;';
    const out = layerStrip(src, 'typescript');
    expect(out.text).not.toContain('isto e um comentario');
    expect(out.text).toContain('const a = 1;');
    expect(out.removed).toBeGreaterThan(0);
  });

  it('remove espaco final e linhas em branco consecutivas', () => {
    const src = 'const a = 1;   \n\n\n\nconst b = 2;';
    const out = layerStrip(src, 'typescript');
    expect(out.text).toBe('const a = 1;\n\nconst b = 2;');
  });

  it('nao remove comentario de linha em typescript', () => {
    const src = '// comentario importante\nconst a = 1;';
    expect(layerStrip(src, 'typescript').text).toContain('// comentario importante');
  });

  it('remove comentario de linha em python', () => {
    expect(layerStrip('# comentario\nx = 1', 'python').text).not.toContain('# comentario');
  });

  it('ignora delimitadores dentro de strings', () => {
    const src = 'const s = "/* nao e comentario */";\nconst t = 1;';
    expect(layerStrip(src, 'typescript').text).toContain('/* nao e comentario */');
  });
});

describe('layerDedupe', () => {
  it('remove imports duplicados', () => {
    const src = "import { a } from './a';\nimport { a } from './a';\nconst x = 1;";
    const out = layerDedupe(src, 'typescript');
    expect(out.text.match(/from '\.\/a'/g)?.length).toBe(1);
    expect(out.removed).toBe(1);
  });

  it('mantem linhas curtas e distintas', () => {
    const src = 'const a = 1;\nconst b = 2;';
    expect(layerDedupe(src, 'typescript').removed).toBe(0);
  });
});

describe('layerStructure / findBoilerplate', () => {
  const boiler = ['  if (!input) {', '    throw new Error("invalid");', '  }', '  return sanitize(input);', '}'].join(
    '\n',
  );
  const src = Array.from({ length: 4 }, () => boiler).join('\n\n');

  it('encontra blocos repetidos', () => {
    const found = findBoilerplate(src, 5, 3);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.occurrences).toBeGreaterThanOrEqual(3);
  });

  it('substitui repeticoes por marcador com legenda', () => {
    const out = layerStructure(src);
    expect(out.legend).toContain('bp0');
    expect(out.removed).toBeGreaterThan(0);
  });
});

describe('layerWindow', () => {
  const lines = Array.from({ length: 300 }, (_, i) => `linha ${i + 1}`);

  it('recorta para a janela em torno da linha citada', () => {
    const out = layerWindow(lines.join('\n'), [150], 5);
    expect(out.covered).toBe(true);
    expect(out.text).toContain('linha 150');
    expect(out.removed).toBeGreaterThan(200);
  });

  it('nao recorta sem linhas citadas', () => {
    const src = lines.join('\n');
    expect(layerWindow(src, [], 5).covered).toBe(false);
    expect(layerWindow(src, [], 5).text).toBe(src);
  });

  it('ignora numeros de linha invalidos', () => {
    const src = lines.join('\n');
    expect(layerWindow(src, [0, -5], 5).covered).toBe(false);
  });
});

describe('layerSketch', () => {
  it('mantem assinaturas e omite corpos', () => {
    const out = layerSketch(bigFile, 'typescript', 20);
    expect(out.text).toContain('export function alpha');
    expect(out.text).toContain('/* ... */');
    expect(out.removed).toBeGreaterThan(0);
  });

  it('nao altera arquivo ja compacto', () => {
    const small = 'export const a = 1;';
    expect(layerSketch(small, 'typescript', 60).removed).toBe(0);
  });
});

describe('extractLineRefs', () => {
  it('extrai referencias em portugues e ingles', () => {
    expect(extractLineRefs('corrija a linha 42 do arquivo')).toContain(42);
    expect(extractLineRefs('fix line 10 please')).toContain(10);
    expect(extractLineRefs('veja L99')).toContain(99);
  });

  it('nao extrai de texto sem referencias', () => {
    expect(extractLineRefs('crie um botao de login')).toEqual([]);
  });
});

describe('compressPrompt', () => {
  it('reduz tokens sem perder assinaturas', () => {
    const huge = Array.from({ length: 30 }, (_, i) =>
      [
        `export function handler${i}() {`,
        '  const value = compute();',
        '  if (!value) {',
        '    throw new Error("invalid");',
        '  }',
        '  return value.map((x) => x * 2);',
        '}',
        '',
      ].join('\n'),
    ).join('\n');

    const result = compressPrompt(huge, 'typescript', {}, estimateTokens);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    expect(result.savedPercent).toBeGreaterThan(0);
    expect(result.text).toContain('handler0');
  });

  it('reporta cada camada aplicada', () => {
    const src = `/* comentario */\nconst a = 1;\n${'const repetida = 2;\n'.repeat(4)}`;
    const result = compressPrompt(src, 'typescript', {}, estimateTokens);
    expect(result.layers).toHaveLength(5);
    expect(result.layers.find((l) => l.id === 'strip')?.applied).toBe(true);
  });

  it('respeita camadas desativadas', () => {
    const src = '/* keep me */\nconst a = 1;';
    const result = compressPrompt(src, 'typescript', { enabled: [] }, estimateTokens);
    expect(result.text).toBe(src);
    expect(result.savedPercent).toBe(0);
  });

  it('nunca aumenta o tamanho', () => {
    for (const src of [bigFile, 'const a = 1;', '', 'x'.repeat(500)]) {
      const r = compressPrompt(src, 'typescript', {}, estimateTokens);
      expect(r.tokensAfter).toBeLessThanOrEqual(r.tokensBefore);
    }
  });
});

describe('estimateTokens', () => {
  it('conta aproximadamente 3.6 chars por token em ASCII', () => {
    expect(estimateTokens('a'.repeat(360))).toBe(100);
  });

  it('conta mais tokens para multibyte', () => {
    expect(estimateTokens('çãoçãoçãoção')).toBeGreaterThan(estimateTokens('abcd'));
  });

  it('zero para string vazia', () => {
    expect(estimateTokens('')).toBe(0);
  });
});