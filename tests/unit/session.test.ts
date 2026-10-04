import { describe, expect, it } from 'vitest';
import { DEFAULT_FAST_APPLY, createCheckpoint, decideApply, diffAgainstCheckpoint } from '@/core/agents/fast-apply';
import { mergeTasks, parseTasks, progressOf, renderTasks, tasksToToolArgs } from '@/core/agents/tasks';
import { loadRules, renderRules } from '@/core/agents/rules';

describe('decideApply - fast apply', () => {
  const base = { level: 'line' as const, linesChanged: 2, linesAdded: 1, linesRemoved: 1, createsFile: false, deletesContent: false };

  it('aplica direto patch pequeno de linha', () => {
    expect(decideApply(base).apply).toBe('fast');
  });

  it('pede revisao quando patch e grande', () => {
    const d = decideApply({ ...base, linesChanged: 40, linesAdded: 20, linesRemoved: 20 });
    expect(d.apply).toBe('review');
    expect(d.reason).toContain('limite');
  });

  it('pede revisao ao criar arquivo', () => {
    expect(decideApply({ ...base, createsFile: true }).apply).toBe('review');
  });

  it('pede revisao ao remover muitas linhas', () => {
    expect(decideApply({ ...base, deletesContent: true, linesRemoved: 5, linesChanged: 6 }).apply).toBe('review');
  });

  it('permite remocao de 1-2 linhas sem revisao', () => {
    expect(decideApply({ ...base, deletesContent: true, linesRemoved: 1, linesChanged: 1 }).apply).toBe('fast');
  });

  it('reescrita de arquivo sempre pede revisao', () => {
    expect(decideApply({ ...base, level: 'file' }).apply).toBe('review');
  });

  it('patch ancorado pequeno pode ir direto', () => {
    expect(decideApply({ ...base, level: 'anchor' }).apply).toBe('fast');
  });

  it('respeita fast apply desativado', () => {
    expect(decideApply({ ...base, config: { ...DEFAULT_FAST_APPLY, enabled: false } }).apply).toBe('review');
  });

  it('respeita limite customizado', () => {
    const cfg = { ...DEFAULT_FAST_APPLY, maxLines: 3 };
    expect(decideApply({ ...base, linesChanged: 4, linesAdded: 4, linesRemoved: 0, config: cfg }).apply).toBe('review');
    expect(decideApply({ ...base, linesChanged: 3, linesAdded: 3, linesRemoved: 0, config: cfg }).apply).toBe('fast');
  });
});

describe('checkpoints', () => {
  const files = [
    { path: 'a.ts', content: 'const a = 1;', hash: 'h1' },
    { path: 'b.ts', content: 'const b = 2;', hash: 'h2' },
  ];

  it('cria checkpoint com snapshot dos arquivos', async () => {
    const cp = await createCheckpoint('run1', 1, 'antes do passo', 100, async () => files);
    expect(cp.files).toHaveLength(2);
    expect(cp.runId).toBe('run1');
    expect(cp.seq).toBe(1);
    expect(cp.tokensAtCheckpoint).toBe(100);
  });

  it('detecta arquivos alterados, adicionados e removidos', async () => {
    const cp = await createCheckpoint('run1', 1, 'x', 0, async () => files);
    const current = [
      { path: 'a.ts', content: 'const a = 999;', hash: 'h9' },
      { path: 'c.ts', content: 'const c = 3;', hash: 'h3' },
    ];
    const d = diffAgainstCheckpoint(cp, current);
    expect(d.changed).toEqual(['a.ts']);
    expect(d.added).toEqual(['c.ts']);
    expect(d.removed).toEqual(['b.ts']);
  });

  it('reporta nada quando o estado nao mudou', async () => {
    const cp = await createCheckpoint('run1', 1, 'x', 0, async () => files);
    const d = diffAgainstCheckpoint(cp, [...files]);
    expect(d.changed).toHaveLength(0);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
  });
});

describe('tasks', () => {
  it('extrai checklist de markdown', () => {
    const text = ['## Passos', '- [ ] criar botao em `src/Button.tsx`', '- [x] instalar dependencias', '- [~] ajustar estilo do card', '- [-] cancelar item legado'].join('\n');
    const tasks = parseTasks(text, 'run1');
    expect(tasks).toHaveLength(4);
    expect(tasks[0]?.status).toBe('pending');
    expect(tasks[0]?.targetPath).toBe('src/Button.tsx');
    expect(tasks[1]?.status).toBe('done');
    expect(tasks[2]?.status).toBe('in_progress');
    expect(tasks[3]?.status).toBe('cancelled');
    expect(tasks[0]?.text).toContain('criar botao');
  });

  it('extrai sem marcador de lista tambem', () => {
    const tasks = parseTasks('1. [ ] criar o componente\n2. [ ] escrever o teste', 'run1');
    expect(tasks).toHaveLength(2);
  });

  it('ignora linhas que nao sao tarefas', () => {
    expect(parseTasks('Isso e texto normal.\nSem status.', 'run1')).toHaveLength(0);
  });

  it('faz merge sem duplicar e nao reabre concluida', () => {
    const first = parseTasks('- [ ] criar botao\n- [ ] ajustar css', 'run1');
    const second = parseTasks('- [x] criar botao\n- [ ] ajustar css', 'run1');
    const merged = mergeTasks(first, second);
    expect(merged).toHaveLength(2);
    expect(merged.find((t) => t.text === 'criar botao')?.status).toBe('done');
  });

  it('faz merge preservando ordem original', () => {
    const first = parseTasks('- [ ] passo um\n- [ ] passo dois\n- [ ] passo tres', 'run1');
    const second = parseTasks('- [x] passo tres', 'run1');
    expect(mergeTasks(first, second).map((t) => t.text)).toEqual(['passo um', 'passo dois', 'passo tres']);
  });

  it('ignora diferencas de caixa e espacos no merge', () => {
    const first = parseTasks('- [ ] Corrija  o   Bug do login', 'run1');
    const second = parseTasks('- [x] corrija o bug do login', 'run1');
    expect(mergeTasks(first, second)[0]?.status).toBe('done');
  });

  it('renderiza de volta para markdown', () => {
    const tasks = parseTasks('- [ ] criar botao\n- [x] ajustar css', 'run1');
    const out = renderTasks(tasks);
    expect(out).toContain('- [ ] criar botao');
    expect(out).toContain('- [x] ajustar css');
  });

  it('calcula progresso', () => {
    expect(progressOf(parseTasks('- [ ] passo um\n- [x] passo dois\n- [~] passo tres', 'run1'))).toEqual({ done: 1, total: 3, percent: 33 });
    expect(progressOf([]).percent).toBe(0);
  });

  it('converte para argumentos de tool', () => {
    const tasks = parseTasks('- [ ] criar botao\n- [x] ajustar css', 'run1');
    const args = tasksToToolArgs(tasks);
    expect(args.tasks as unknown[]).toHaveLength(2);
  });
});

describe('rules files', () => {
  it('carrega AGENTS.md da raiz', async () => {
    const docs = await loadRules(async (p) => (p === 'AGENTS.md' ? '# Regras\nUse TypeScript.' : null), '');
    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toContain('Use TypeScript.');
  });

  it('carrega rules dentro de subpasta', async () => {
    const docs = await loadRules(async (p) => (p === 'app/AGENTS.md' ? 'regra do app' : null), 'app');
    expect(docs[0]?.path).toBe('app/AGENTS.md');
  });

  it('ignora arquivos vazios', async () => {
    const docs = await loadRules(async (p) => (p === 'AGENTS.md' ? '   ' : null), '');
    expect(docs).toHaveLength(0);
  });

  it('trunca conteudo muito grande', async () => {
    const big = 'x'.repeat(50000);
    const docs = await loadRules(async () => big, '');
    expect(docs[0]?.bytes).toBe(50000);
    expect(docs[0]?.content.length).toBeLessThanOrEqual(12000);
  });

  it('renderiza com tag de origem', async () => {
    const docs = await loadRules(async () => 'regra', '');
    const out = renderRules(docs);
    expect(out).toContain('<project-rules source="AGENTS.md">');
    expect(out).toContain('regra');
  });

  it('render vazio quando nao ha rules', () => {
    expect(renderRules([])).toBe('');
  });
});