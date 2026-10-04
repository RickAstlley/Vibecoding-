import { describe, expect, it } from 'vitest';
import { DEPLOY_PLANS, formatBytes } from '@/core/deploy/artifact';

describe('DEPLOY_PLANS', () => {
  it('cobre os quatro destinos', () => {
    expect(DEPLOY_PLANS.map((p) => p.target)).toEqual(['zip', 'hostinger', 'netlify-drop', 'github-pages']);
  });

  it('todo plano tem instrucoes', () => {
    for (const plan of DEPLOY_PLANS) {
      expect(plan.instructions.length).toBeGreaterThan(0);
      expect(plan.label.length).toBeGreaterThan(0);
    }
  });

  it('zip e o unico totalmente automatico', () => {
    const automatic = DEPLOY_PLANS.filter((p) => !p.manual);
    expect(automatic).toHaveLength(1);
    expect(automatic[0]?.target).toBe('zip');
  });

  it('cada alvo tem destino distinto', () => {
    expect(new Set(DEPLOY_PLANS.map((p) => p.target)).size).toBe(DEPLOY_PLANS.length);
  });
});

describe('formatBytes', () => {
  it('formata em unidades legiveis', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
  });
});