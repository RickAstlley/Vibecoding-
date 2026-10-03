/**
 * Design mode: transforma a pagina renderizada em um esboco de codigo
 * (HTML + CSS inline) que o agente pode editar.
 *
 * A captura usa o DOM real do preview - nao adivinhamos estrutura. O que
 * sai daqui e codigo valido, sem depender de embedding de imagem.
 */

export interface DesignNode {
  tag: string;
  classes: string[];
  text: string;
  children: DesignNode[];
  /** Estilos inline relevantes. */
  styles: Record<string, string>;
}

export interface SkeletonOptions {
  /** Altura maxima de texto renderizado. */
  maxText: number;
  /** Remove elementos com menos de N px de area. */
  minArea: number;
  /** Mantem elementos com role/aria. */
  keepA11y: boolean;
  /** Profundida maxima. */
  maxDepth: number;
}

export const DEFAULT_SKELETON: SkeletonOptions = {
  maxText: 120,
  minArea: 24,
  keepA11y: true,
  maxDepth: 12,
};

const STYLE_KEYS = [
  'display',
  'flexDirection',
  'gap',
  'padding',
  'margin',
  'backgroundColor',
  'color',
  'fontSize',
  'fontWeight',
  'borderRadius',
  'border',
  'width',
  'height',
  'textAlign',
] as const;

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'meta', 'link', 'head']);

/**
 * Extrai um esboco do DOM. Espera um elemento raiz ja extraido do preview.
 * Retorna HTML otimizado e CSS inline.
 */
export function buildSkeleton(root: {
  tagName: string;
  className: string;
  textContent: string | null;
  children: unknown[];
  getAttribute(name: string): string | null;
  style: Record<string, string>;
  getBoundingClientRect(): { width: number; height: number };
}, options: SkeletonOptions = DEFAULT_SKELETON): { html: string; css: string; nodes: number } {
  let counter = 0;
  const rules: string[] = [];

  const inlineStyles = (style: Record<string, string>): string => {
    const parts: string[] = [];
    for (const key of STYLE_KEYS) {
      const value = style[key];
      if (value && value !== 'none' && value !== 'normal' && value !== '0px' && value !== 'rgba(0, 0, 0, 0)') {
        parts.push(`${kebab(key)}: ${value}`);
      }
    }
    return parts.join('; ');
  };

  const kebab = (key: string): string => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

  const walk = (el: NodeLike, depth: number): string => {
    if (depth > options.maxDepth) return '';

    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return '';

    const area = (() => {
      const rect = el.getBoundingClientRect?.();
      return rect ? rect.width * rect.height : 0;
    })();
    if (area > 0 && area < options.minArea) return '';

    const original = (el.className || '').split(/\s+/).filter(Boolean).slice(0, 4);
    const id = counter++;
    // o atributo class fica sem ponto; o seletor de CSS e que leva
    const classAttr = `w${id}${original.length > 0 ? ` ${original.join(' ')}` : ''}`;
    const selector = `.${classAttr.replace(/\s+/g, '.')}`;

    const styles = { ...(el.style ?? {}) };
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const childNodes = (el.children ?? []) as NodeLike[];

    const childHtml = childNodes.map((c) => walk(c, depth + 1)).join('');
    const ownText = childNodes.length === 0 && text ? escapeHtml(text.slice(0, options.maxText)) : '';
    const aria = el.getAttribute?.('aria-label');
    const a11y = options.keepA11y && aria ? ` aria-label="${escapeAttr(aria)}"` : '';

    const decl = inlineStyles(styles);
    if (decl) rules.push(`${selector} { ${decl} }`);

    if (!childHtml && !ownText) return '';

    if (!childHtml) {
      return `<${tag}${a11y} class="${classAttr}">${ownText}</${tag}>`;
    }
    return `<${tag}${a11y} class="${classAttr}">${childHtml}</${tag}>`;
  };

  const html = walk(root as NodeLike, 0);
  return { html, css: rules.join('\n'), nodes: counter };
}

interface NodeLike {
  tagName: string;
  className?: string;
  textContent?: string | null;
  children?: unknown[];
  getAttribute?(name: string): string | null;
  style?: Record<string, string>;
  getBoundingClientRect?(): { width: number; height: number };
}

/** Documento completo pronto para salvar como arquivo. */
export function toDocument(skeleton: { html: string; css: string }, title = 'Design'): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
${skeleton.css}
    </style>
  </head>
  <body>
${indent(skeleton.html, 4)}
  </body>
</html>
`;
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Prompt que manda o modelo reconstruir a partir do esboco.
 * Inclui as regras de seguranca que valem para qualquer edicao.
 */
export function designPrompt(skeleton: { html: string; css: string }, goal: string): string {
  return [
    `Reconstrua este esboco como codigo real do projeto.`,
    ``,
    `Objetivo do usuario: ${goal}`,
    ``,
    `## Esboco extraido do preview`,
    '```html',
    skeleton.html,
    '```',
    ``,
    '## Estilos capturados',
    '```css',
    skeleton.css,
    '```',
    ``,
    `Regras:`,
    `- Substitua as classes w0/w1/... por classes com nome real`,
    `- Mova os estilos inline para um arquivo .css quando houver repeticao`,
    `- Mantenha a estrutura semantica; nao layout por posicao absolute`,
    `- Respeite as convencoes que voce leu em AGENTS.md`,
    `- Edite UM arquivo por patch`,
  ].join('\n');
}

export interface ScreenshotRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Recorta um retangulo da imagem do preview, para inspecionar um trecho. */
export function cropRegion(dataUrl: string, region: ScreenshotRegion): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(region.width));
      canvas.height = Math.max(1, Math.round(region.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2d indisponivel'));
        return;
      }
      ctx.drawImage(
        img,
        Math.round(region.x),
        Math.round(region.y),
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Falha ao carregar a imagem'));
    img.src = dataUrl;
  });
}