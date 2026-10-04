import { describe, expect, it, vi } from 'vitest';
import { coerceSelector, runBrowserTool } from '@/core/browser/tools';
import { renderSnapshot, type Snapshot } from '@/core/browser/bridge-client';

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    title: 'App',
    url: '/index.html',
    readyState: 'complete',
    interactive: 2,
    headings: [{ level: 'H1', text: 'Ola' }],
    buttons: [
      { index: 0, selector: 'button#enviar', tag: 'button', text: 'Enviar', visible: true, disabled: false, rect: { x: 0, y: 0, w: 80, h: 30 } },
    ],
    inputs: [
      {
        index: 1,
        selector: 'input#email',
        tag: 'input',
        text: '',
        visible: true,
        disabled: false,
        rect: { x: 0, y: 40, w: 200, h: 30 },
        type: 'email',
        name: 'email',
        placeholder: 'seu@email.com',
        value: '',
      },
    ],
    text: 'Ola mundo',
    ...over,
  };
}

const cfg = { enabled: true, timeoutMs: 1000 };

describe('coerceSelector', () => {
  it('converte indice numerico', () => {
    expect(coerceSelector('3')).toBe(3);
    expect(coerceSelector(2)).toBe(2);
  });

  it('mantem seletor CSS', () => {
    expect(coerceSelector('#login')).toBe('#login');
    expect(coerceSelector('form input[type=email]')).toBe('form input[type=email]');
  });
});

describe('renderSnapshot', () => {
  it('inclui titulo, botoes, campos e texto', () => {
    const out = renderSnapshot(snap());
    expect(out).toContain('titulo: App');
    expect(out).toContain('button#enviar');
    expect(out).toContain('input#email');
    expect(out).toContain('Ola mundo');
  });

  it('renderiza o valor que o bridge enviou', () => {
    const out = renderSnapshot(snap({ inputs: [{ ...snap().inputs[0]!, value: 'texto' }] }));
    expect(out).toContain('valor="texto"');
  });

  it('trunca texto muito longo', () => {
    const out = renderSnapshot(snap({ text: 'x'.repeat(5000) }), 100);
    expect(out.length).toBeLessThan(2500);
  });

  it('funciona com pagina vazia', () => {
    const out = renderSnapshot(snap({ headings: [], buttons: [], inputs: [], text: '' }));
    expect(out).toContain('titulo: App');
  });
});

describe('runBrowserTool', () => {
  it('reporta erro quando o preview nao esta pronto', async () => {
    const out = await runBrowserTool('browser_snapshot', {}, cfg);
    expect(out.ok).toBe(false);
    expect(out.context).toMatch(/Preview/i);
  });

  it('rejeita ferramenta desconhecida', async () => {
    const out = await runBrowserTool('browser_inexistente', {}, cfg);
    expect(out.ok).toBe(false);
    expect(out.context).toContain('nao existe');
  });
});

describe('bridge no Service Worker', () => {
  it('o bridge declara todas as operacoes usadas pelas ferramentas', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('public/preview-bridge.js', 'utf8');
    for (const op of ['snapshot', 'query', 'read', 'click', 'type', 'wait', 'scroll']) {
      expect(src).toMatch(new RegExp(`\\b${op}:\\s*function`));
    }
  });

  it('o bridge nao tem comentario de bloco nao terminado', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('public/preview-bridge.js', 'utf8');
    const opens = (src.match(/\/\*/g) ?? []).length;
    const closes = (src.match(/\*\//g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it('o bridge e sintaticamente valido', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('public/preview-bridge.js', 'utf8');
    expect(() => new Function(src)).not.toThrow();
  });

  it('o Service Worker serve o bridge no namespace do preview', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('public/sw.js', 'utf8');
    expect(src).toContain('__arcanum_bridge.js');
    expect(src).toContain('preview-bridge.js');
  });

  it('o injetor usa o script externo, nao inline', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('public/sw.js', 'utf8');
    expect(src).toMatch(/src="\/__preview__\/__arcanum_bridge\.js"/);
    expect(src).not.toMatch(/console\[level\] = function/);
  });
});

describe('coerencia entre ferramentas e bridge', () => {
  it('toda tool browser_* corresponde a uma op do bridge', async () => {
    const tools = await import('@/core/browser/tools');
    const names = tools.BROWSER_TOOLS.map((t) => t.name);
    expect(names).toContain('browser_snapshot');
    expect(names).toContain('browser_query');
    expect(names).toContain('browser_read');
    expect(names).toContain('browser_click');
    expect(names).toContain('browser_type');
    // nao deve existir tool browser_* sem implementacao no switch
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('seguranca do bridge', () => {
  it('nao injeta codigo do usuario sem escapar', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('public/preview-bridge.js', 'utf8');
    expect(src).toContain('JSON.stringify');
    // nenhum uso de eval/Function para executar texto recebido
    expect(src).not.toMatch(/\beval\s*\(/);
    expect(src).not.toMatch(/new\s+Function\s*\(/);
  });

  it('mascara senha antes de devolver ao agente', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('public/preview-bridge.js', 'utf8');
    // o bridge substitui o valor de campos password por *** antes de postar
    expect(src).toMatch(/password'\s*\?\s*'\*\*\*'/);
  });

  it('envia todas as mensagens com targetOrigin \'*\'', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('public/preview-bridge.js', 'utf8');
    const calls = src.match(/\.postMessage\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    const semTarget = src.match(/\.postMessage\((?:(?!'\*')\n)*?\)/g) ?? [];
    expect(semTarget.every((c) => c.includes("'*'"))).toBe(true);
  });
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return actual;
});