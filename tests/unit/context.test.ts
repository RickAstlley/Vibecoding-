import { describe, expect, it } from 'vitest';
import { buildContext, DEFAULT_BUDGET } from '@/core/context/builder';
import { buildImportGraph, isEntryPoint, rankFiles, tokenize, type RankableFile } from '@/core/context/ranker';

const files: RankableFile[] = [
  { path: 'src/main.tsx', content: "import { App } from './App';\nimport { helper } from './utils';\nrender(App);", size: 100, isEntry: true },
  { path: 'src/App.tsx', content: 'export function App() {\n  return helper();\n}', size: 100 },
  { path: 'src/utils.ts', content: 'export function helper() {\n  return 42;\n}', size: 100 },
  { path: 'README.md', content: '# Documentacao do projeto', size: 20 },
  { path: 'styles.min.css', content: '.a{color:red}', size: 10 },
];

describe('tokenize', () => {
  it('remove stopwords e palavras curtas', () => {
    expect(tokenize('a de criar um botao de login')).toEqual(['criar', 'botao', 'login']);
  });
});

describe('rankFiles', () => {
  it('prioriza arquivo citado pelo nome', () => {
    const ranked = rankFiles(files, 'arrume o App.tsx');
    expect(ranked[0]?.path).toBe('src/App.tsx');
    expect(ranked[0]?.reasons).toContain('nome do arquivo citado');
  });

  it('prioriza entry point', () => {
    const ranked = rankFiles(files.map((f) => ({ ...f, isEntry: false })), 'render');
    expect(ranked.some((r) => r.path === 'src/main.tsx')).toBe(true);
  });

  it('penaliza arquivos de dados irrelevantes', () => {
    const ranked = rankFiles(files, 'criar botao');
    const readme = ranked.find((r) => r.path === 'README.md');
    const css = ranked.find((r) => r.path === 'styles.min.css');
    expect(readme?.score ?? 0).toBeLessThan(0);
    expect(css?.score ?? 0).toBeLessThan(0);
  });

  it('considera quem importa o arquivo', () => {
    const graph = buildImportGraph(files);
    expect(graph.get('src/main.tsx')).toEqual(expect.arrayContaining(['src/App.tsx']));
    const ranked = rankFiles(files, 'App', graph);
    const app = ranked.find((r) => r.path === 'src/App.tsx');
    expect(app?.reasons.some((r) => r.includes('importado por'))).toBe(true);
  });
});

describe('buildImportGraph', () => {
  it('resolve caminhos relativos com ..', () => {
    const list: RankableFile[] = [
      { path: 'src/a/b.ts', content: "import { c } from '../c';", size: 10 },
      { path: 'src/c.ts', content: 'export const c = 1;', size: 10 },
    ];
    expect(buildImportGraph(list).get('src/a/b.ts')).toEqual(['src/c.ts']);
  });

  it('ignora pacotes externos', () => {
    const list: RankableFile[] = [{ path: 'src/a.ts', content: "import React from 'react';", size: 10 }];
    expect(buildImportGraph(list).size).toBe(0);
  });
});

describe('isEntryPoint', () => {
  it('detecta entrypoints conhecidos', () => {
    expect(isEntryPoint('src/main.tsx')).toBe(true);
    expect(isEntryPoint('index.html')).toBe(true);
    expect(isEntryPoint('src/app/dashboard/page.tsx')).toBe(true);
    expect(isEntryPoint('src/components/Button.tsx')).toBe(false);
  });
});

describe('buildContext', () => {
  it('inclui arquivos relevantes e reporta tokens', () => {
    const result = buildContext({
      question: 'corrija o App.tsx',
      files,
      systemPrompt: 'sistema',
      history: [],
    });
    expect(result.includedPaths).toContain('src/App.tsx');
    expect(result.reports.find((r) => r.path === 'src/App.tsx')?.tokensSent).toBeGreaterThan(0);
    expect(result.tokensTotal).toBeGreaterThan(0);
  });

  it('respeita forcePaths mesmo com orcamento apertado', () => {
    const big: RankableFile = { path: 'src/huge.ts', content: 'const x = 1;\n'.repeat(5000), size: 50000 };
    const result = buildContext({
      question: 'qualquer coisa',
      files: [...files, big],
      systemPrompt: 'sistema',
      history: [],
      budget: { contextWindow: 2000 },
      forcePaths: ['src/huge.ts'],
    });
    expect(result.includedPaths).toContain('src/huge.ts');
  });

  it('omite arquivos quando o orcamento e pequeno', () => {
    const many: RankableFile[] = Array.from({ length: 40 }, (_, i) => ({
      path: `src/f${i}.ts`,
      content: `export function f${i}() {\n  const a = ${i};\n  const b = a * 2;\n  return b + ${i};\n}`,
      size: 200,
    }));
    const result = buildContext({
      question: 'crie uma funcao nova',
      files: many,
      systemPrompt: 'sistema',
      history: [],
      budget: { contextWindow: 1000 },
    });
    expect(result.omittedPaths.length).toBeGreaterThan(0);
    expect(result.tokensTotal).toBeLessThan(1000);
  });

  it('mantem o total dentro da janela de contexto', () => {
    const result = buildContext({
      question: 'App',
      files,
      systemPrompt: 'sistema'.repeat(500),
      history: [],
      budget: { contextWindow: 20000 },
    });
    expect(result.tokensTotal).toBeLessThan(20000);
    expect(result.budgetTotal).toBe(20000);
  });

  it('comprime quando o arquivo excede o orcamento', () => {
    const long: RankableFile = {
      path: 'src/long.ts',
      content: Array.from({ length: 400 }, (_, i) => `export function f${i}() { return ${i}; }`).join('\n'),
      size: 20000,
    };
    const withCompression = buildContext({
      question: 'modifique f350',
      files: [long],
      systemPrompt: 's',
      history: [],
      budget: { contextWindow: 3000 },
      enableCompression: true,
      compress: { enabled: ['strip', 'sketch'] },
    });
    expect(withCompression.savedPercent).toBeGreaterThan(0);
  });

  it('nao comprime quando desativado', () => {
    const long: RankableFile = { path: 'src/long.ts', content: 'const a = 1;\n'.repeat(2000), size: 30000 };
    const result = buildContext({
      question: 'modifique',
      files: [long],
      systemPrompt: 's',
      history: [],
      budget: { contextWindow: 2000 },
      enableCompression: false,
    });
    expect(result.omittedPaths).toContain('src/long.ts');
  });

  it('trunca historico antigo', () => {
    const history = Array.from({ length: 50 }, (_, i) => ({ role: 'user', content: `mensagem ${i} `.repeat(100) }));
    const result = buildContext({
      question: 'x',
      files: [],
      systemPrompt: 's',
      history,
      budget: { contextWindow: 10000, historyShare: 0.1 },
    });
    expect(result.tokensHistory).toBeLessThan(1000);
  });
});

describe('DEFAULT_BUDGET', () => {
  it('soma 100% com reserva de saida', () => {
    const sum = DEFAULT_BUDGET.systemShare + DEFAULT_BUDGET.userShare + DEFAULT_BUDGET.codeShare + DEFAULT_BUDGET.historyShare;
    expect(sum + DEFAULT_BUDGET.outputReserve).toBeCloseTo(1, 5);
  });
});