import { describe, expect, it } from 'vitest';
import type { CascadePlan } from '@/core/agents/cascade';
import {
  activateNext,
  approvePlan,
  completeStep,
  conflictingSteps,
  parsePlan,
  planProgress,
  rejectPlan,
  skipStep,
} from '@/core/agents/cascade';

const plannerOutput = [
  '## Objetivo',
  'Criar um formulario de login',
  '',
  '## Passos',
  '1. [ ] criar `src/Login.tsx` com os campos',
  '2. [ ] estilizar em `src/login.css`',
  '3. [ ] adicionar validacao em `src/Login.tsx`',
  '',
  '## Perguntas',
  '- Deve redirecionar para /dashboard apos login?',
  '',
  '## Riscos',
  '- Nao ha rota /dashboard ainda',
].join('\n');

describe('parsePlan', () => {
  it('extrai passos, perguntas e riscos', () => {
    const plan = parsePlan(plannerOutput, 'run1');
    expect(plan.steps).toHaveLength(3);
    expect(plan.questions).toHaveLength(1);
    expect(plan.risks).toHaveLength(1);
    expect(plan.status).toBe('draft');
  });

  it('numera os passos sequencialmente', () => {
    const plan = parsePlan(plannerOutput, 'run1');
    expect(plan.steps.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('associa o caminho de cada passo', () => {
    const plan = parsePlan(plannerOutput, 'run1');
    expect(plan.steps[0]?.targetPath).toBe('src/Login.tsx');
    expect(plan.steps[1]?.targetPath).toBe('src/login.css');
  });

  it('devolve plano vazio sem checklist', () => {
    expect(parsePlan('apenas um texto', 'run1').steps).toHaveLength(0);
  });

  it('respeita secao de perguntas ausente', () => {
    const plan = parsePlan('- [ ] fazer algo', 'run1');
    expect(plan.questions).toHaveLength(0);
    expect(plan.risks).toHaveLength(0);
  });

  it('para a secao na proxima heading', () => {
    const text = ['## Riscos', '- risco A', '## Outro', '- nao e risco'].join('\n');
    expect(parsePlan(text, 'run1').risks).toEqual(['risco A']);
  });
});

describe('progresso', () => {
  it('conta concluidos e pulados', () => {
    const plan = parsePlan(plannerOutput, 'run1');
    let p = completeStep(plan, plan.steps[0]!.id);
    p = skipStep(p, plan.steps[1]!.id);
    expect(planProgress(p.steps)).toEqual({ done: 2, total: 3, percent: 67 });
  });

  it('zero quando vazio', () => {
    expect(planProgress([]).percent).toBe(0);
  });
});

describe('ativacao sequencial', () => {
  it('ativa o primeiro passo pendente', () => {
    const plan = parsePlan(plannerOutput, 'run1');
    const next = activateNext(plan);
    expect(next.steps[0]?.status).toBe('active');
    expect(next.steps[1]?.status).toBe('pending');
  });

  it('avanca apos concluir', () => {
    const plan = parsePlan(plannerOutput, 'run1');
    let p = activateNext(plan);
    p = completeStep(p, plan.steps[0]!.id);
    p = activateNext(p);
    expect(p.steps[1]?.status).toBe('active');
  });

  it('nao faz nada quando tudo concluido', () => {
    const plan = parsePlan(plannerOutput, 'run1');
    let p = plan;
    for (const s of plan.steps) p = completeStep(p, s.id);
    const after = activateNext(p);
    expect(after.steps.every((s) => s.status !== 'active')).toBe(true);
  });
});

describe('conclusao de passo', () => {
  it('registra arquivo tocado e tokens', () => {
    const plan = parsePlan(plannerOutput, 'run1');
    const done = completeStep(plan, plan.steps[0]!.id, { touchedPath: 'src/Login.tsx', text: 'criado', tokens: 120 });
    const step = done.steps[0];
    expect(step?.status).toBe('done');
    expect(step?.touchedPath).toBe('src/Login.tsx');
    expect(step?.outcome).toBe('criado');
    expect(step?.tokens).toBe(120);
  });

  it('marca plano como done quando tudo conclui', () => {
    const plan = parsePlan(plannerOutput, 'run1');
    let p: CascadePlan = { ...plan, status: 'executing' };
    for (const s of plan.steps) p = completeStep(p, s.id);
    expect(p.status).toBe('done');
  });
});

describe('aprovacao', () => {
  it('aprova e rejeita', () => {
    const plan = parsePlan(plannerOutput, 'run1');
    expect(approvePlan(plan).status).toBe('approved');
    const rejected = rejectPlan(plan, 'usuario cancelou');
    expect(rejected.status).toBe('rejected');
    expect(rejected.risks).toContain('usuario cancelou');
  });
});

describe('conflitos e paralelismo', () => {
  it('detecta passos que tocam o mesmo arquivo', () => {
    const conflicts = conflictingSteps(parsePlan(plannerOutput, 'run1'));
    // passos 1 e 3 tocam src/Login.tsx
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toHaveLength(2);
  });

  it('nao detecta conflito quando caminhos diferem', () => {
    const text = '- [ ] editar `a.ts`\n- [ ] editar `b.ts`';
    expect(conflictingSteps(parsePlan(text, 'run1'))).toHaveLength(0);
  });

  it('ignora passo sem caminho', () => {
    expect(conflictingSteps(parsePlan('- [ ] pensar bem', 'run1'))).toHaveLength(0);
  });
});