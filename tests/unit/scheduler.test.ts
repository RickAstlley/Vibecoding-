import { describe, expect, it } from 'vitest';
import { buildBatches, canStart, conflicts, deadlocks, initialState, DEFAULT_SCHEDULER } from '@/core/agents/scheduler';
import type { AgentJob } from '@/core/agents/scheduler';

function job(id: string, files: string[]): AgentJob {
  return { id, goal: `fazer ${id}`, files, mode: 'coder', providerId: 'p', model: 'm', apiKey: 'k' };
}

describe('conflitos entre jobs', () => {
  it('detecta arquivo compartilhado', () => {
    expect(conflicts(job('a', ['src/x.ts']), job('b', ['src/x.ts']))).toBe(true);
  });

  it('nao conflita com arquivos distintos', () => {
    expect(conflicts(job('a', ['src/x.ts']), job('b', ['src/y.ts']))).toBe(false);
  });

  it('job sem restricao nunca conflita', () => {
    expect(conflicts(job('a', []), job('b', ['src/x.ts']))).toBe(false);
  });

  it('job sem restricao nunca pode ser agendado com lock', () => {
    expect(canStart(job('a', []), new Map())).toBe(false);
  });
});

describe('locks de arquivo', () => {
  it('bloqueia quando o arquivo esta travado', () => {
    const locks = new Map([['src/x.ts', 'outro-job']]);
    expect(canStart(job('a', ['src/x.ts']), locks)).toBe(false);
  });

  it('libera quando nenhum arquivo esta travado', () => {
    const locks = new Map([['src/z.ts', 'outro-job']]);
    expect(canStart(job('a', ['src/x.ts', 'src/y.ts']), locks)).toBe(true);
  });
});

describe('buildBatches', () => {
  it('agrupa jobs independentes no mesmo lote', () => {
    const batches = buildBatches([job('a', ['a.ts']), job('b', ['b.ts'])], 3);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('separa jobs que disputam o mesmo arquivo', () => {
    const batches = buildBatches([job('a', ['x.ts']), job('b', ['x.ts']), job('c', ['c.ts'])], 3);
    expect(batches.length).toBeGreaterThan(1);
  });

  it('respeita o limite de concorrencia', () => {
    const jobs = ['a', 'b', 'c', 'd', 'e'].map((id) => job(id, [`${id}.ts`]));
    const batches = buildBatches(jobs, 2);
    expect(batches.every((b) => b.length <= 2)).toBe(true);
  });

  it('inclui todo mundo em algum lote', () => {
    const jobs = ['a', 'b', 'c'].map((id) => job(id, [`${id}.ts`]));
    const seen = buildBatches(jobs, 2).flatMap((b) => b.map((j) => j.id));
    expect(new Set(seen).size).toBe(3);
  });

  it('nao duplica job', () => {
    const jobs = [job('a', ['a.ts']), job('b', ['b.ts'])];
    const seen = buildBatches(jobs, 3).flatMap((b) => b.map((j) => j.id));
    expect(seen.length).toBe(new Set(seen).size);
  });
});

describe('deadlocks', () => {
  it('detecta jobs com o mesmo arquivo', () => {
    expect(deadlocks([job('a', ['x.ts']), job('b', ['x.ts'])])).toHaveLength(1);
  });

  it('nao reporta quando tudo e distinto', () => {
    expect(deadlocks([job('a', ['x.ts']), job('b', ['y.ts'])])).toHaveLength(0);
  });
});

describe('estado inicial', () => {
  it('comeca na fila', () => {
    const s = initialState(job('a', ['x.ts']));
    expect(s.status).toBe('queued');
    expect(s.runId).toBeNull();
    expect(s.step).toBe(0);
    expect(s.tokensUsed).toBe(0);
  });
});

describe('DEFAULT_SCHEDULER', () => {
  it('limita a 3 jobs simultaneos', () => {
    expect(DEFAULT_SCHEDULER.maxConcurrent).toBe(3);
  });

  it('usa lock exclusivo por padrao', () => {
    expect(DEFAULT_SCHEDULER.exclusiveFileLocks).toBe(true);
  });
});