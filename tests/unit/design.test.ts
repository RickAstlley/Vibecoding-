import { describe, expect, it } from 'vitest';
import { buildSkeleton, DEFAULT_SKELETON, designPrompt, escapeHtml, toDocument } from '@/core/design/skeleton';

/** Nosso substituto de um elemento do DOM. */
function el(
  tag: string,
  opts: { cls?: string; text?: string; style?: Record<string, string>; children?: ReturnType<typeof el>[]; attrs?: Record<string, string>; area?: number } = {},
): any {
  const children = opts.children ?? [];
  return {
    tagName: tag.toUpperCase(),
    className: opts.cls ?? '',
    textContent: opts.text ?? '',
    children,
    style: opts.style ?? {},
    getAttribute: (name: string) => opts.attrs?.[name] ?? null,
    getBoundingClientRect: () => ({ width: 200, height: 40, ...(opts.area ? { height: opts.area / 200 } : {}) }),
  };
}

describe('buildSkeleton', () => {
  it('extrai html da arvore', () => {
    const root = el('body', { children: [el('h1', { text: 'Titulo' }), el('p', { text: 'Paragrafo' })] });
    const out = buildSkeleton(root);
    expect(out.html).toContain('<h1');
    expect(out.html).toContain('Titulo');
    expect(out.html).toContain('<p');
  });

  it('gera classes estaveis por no', () => {
    const root = el('body', { children: [el('h1', { text: 'A' }), el('p', { text: 'B' })] });
    const out = buildSkeleton(root);
    expect(out.html).toContain('class="w1"');
    expect(out.html).toContain('class="w2"');
    expect(out.html).not.toContain('class=".w1"');
  });

  it('captura estilos relevantes em CSS separado', () => {
    const root = el('div', { style: { display: 'flex', gap: '16px' }, children: [el('span', { text: 'x' })] });
    const out = buildSkeleton(root);
    expect(out.css).toContain('display: flex');
    expect(out.css).toContain('gap: 16px');
  });

  it('converte camelCase em kebab-case no CSS', () => {
    const root = el('div', { style: { backgroundColor: '#fff', borderRadius: '8px' }, children: [el('span', { text: 'x' })] });
    const out = buildSkeleton(root);
    expect(out.css).toContain('background-color: #fff');
    expect(out.css).toContain('border-radius: 8px');
  });

  it('ignora estilos irrelevantes', () => {
    const root = el('div', { style: { display: 'none', color: 'rgb(0, 0, 0)' }, children: [el('span', { text: 'x' })] });
    const out = buildSkeleton(root);
    expect(out.css).not.toContain('display');
  });

  it('ignora script e style', () => {
    const root = el('body', { children: [el('script', { text: 'var a = 1;' }), el('p', { text: 'ok' })] });
    const out = buildSkeleton(root);
    expect(out.html).not.toContain('script');
    expect(out.html).toContain('ok');
  });

  it('descarta elemento pequeno demais', () => {
    const root = el('body', { children: [el('span', { text: 'x', area: 2 }), el('p', { text: 'ok' })] });
    const out = buildSkeleton(root);
    expect(out.html).not.toContain('<span');
  });

  it('respeita profundidade maxima', () => {
    let deep = el('span', { text: 'fundo' });
    for (let i = 0; i < 30; i++) deep = el('div', { children: [deep] });
    const out = buildSkeleton(root(deep));
    expect(out.nodes).toBeGreaterThan(0);
  });

  it('preserva aria-label', () => {
    const root = el('body', { children: [el('button', { text: 'Enviar', attrs: { 'aria-label': 'Enviar formulario' } })] });
    const out = buildSkeleton(root);
    expect(out.html).toContain('aria-label="Enviar formulario"');
  });

  it('escapa html no texto', () => {
    const root = el('p', { text: '<script>alert(1)</script>' });
    const out = buildSkeleton(root);
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).not.toContain('<script>alert');
  });

  it('trunca texto muito longo', () => {
    const root = el('p', { text: 'x'.repeat(1000) });
    const out = buildSkeleton(root);
    expect(out.html.length).toBeLessThan(DEFAULT_SKELETON.maxText + 60);
  });

  it('navega em elementos aninhados', () => {
    const root = el('div', { children: [el('ul', { children: [el('li', { text: '1' }), el('li', { text: '2' })] })] });
    const out = buildSkeleton(root);
    expect(out.html).toContain('<ul');
    expect(out.html).toContain('<li');
    expect(out.html).toContain('>1<');
  });
});

function root(node: any): any {
  return { tagName: 'BODY', className: '', textContent: '', children: [node], style: {}, getAttribute: () => null, getBoundingClientRect: () => ({ width: 800, height: 600 }) };
}

describe('toDocument', () => {
  it('gera documento completo', () => {
    const out = toDocument({ html: '<div class="w1">oi</div>', css: '.w1 { display: flex }' }, 'Meu Design');
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<title>Meu Design</title>');
    expect(out).toContain('display: flex');
    expect(out).toContain('oi');
  });
});

describe('designPrompt', () => {
  it('inclui esboco, css e objetivo', () => {
    const prompt = designPrompt({ html: '<div class="w1">x</div>', css: '.w1{}' }, 'criar card de produto');
    expect(prompt).toContain('criar card de produto');
    expect(prompt).toContain('<div class="w1">x</div>');
    expect(prompt).toContain('.w1{}');
  });

  it('exige um arquivo por patch', () => {
    const prompt = designPrompt({ html: '', css: '' }, 'x');
    expect(prompt).toContain('UM arquivo por patch');
  });
});

describe('escapeHtml', () => {
  it('escapa os tres caracteres perigosos', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
  });
});