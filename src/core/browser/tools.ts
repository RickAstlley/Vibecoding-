import type { ToolDef } from '../ia/client';
import { browserBridge, renderSnapshot, type BrowserResult, type ElementInfo, type Snapshot } from './bridge-client';

export interface BrowserToolsConfig {
  /** Habilita as ferramentas de browser no agente. */
  enabled: boolean;
  /** Timeout por comando, em ms. */
  timeoutMs: number;
}

export const BROWSER_TOOLS: ToolDef[] = [
  {
    name: 'browser_snapshot',
    description:
      'Le a pagina do preview: titulo, headings, botoes, campos e texto visivel. Use antes de clicar ou digitar. Este e o unico jeito de VER o resultado do seu codigo.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_query',
    description: 'Busca elementos na pagina por seletor CSS. Retorna seletor, texto, se esta visivel e indice.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS, ex.: "button", "#login", "form input"' },
        all: { type: 'boolean', description: 'Inclui elementos invisiveis (padrao: false)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_read',
    description: 'Le o conteudo/HTML de um elemento especifico do preview.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS ou indice retornado por browser_snapshot' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_click',
    description: 'Clica em um elemento do preview. Aceita seletor CSS ou indice do snapshot.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS ou indice (numero) do snapshot' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_type',
    description: 'Digita texto em um campo do preview, disparando input/change.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS ou indice do snapshot' },
        text: { type: 'string', description: 'Texto a digitar' },
        submit: { type: 'boolean', description: 'Enviar o formulario apos digitar' },
      },
      required: ['selector', 'text'],
    },
  },
];

export interface BrowserToolOutcome {
  ok: boolean;
  summary: string;
  /** Texto de volta para o modelo. */
  context: string;
}

function err(r: BrowserResult<unknown>): BrowserToolOutcome {
  return { ok: false, summary: r.error ?? 'falha desconhecida', context: `ERRO: ${r.error}` };
}

/**
 * Normaliza o seletor vindo do modelo: aceita "3" como indice.
 */
export function coerceSelector(value: unknown): string | number {
  if (typeof value === 'number') return value;
  const raw = String(value ?? '').trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export async function runBrowserTool(
  name: string,
  args: Record<string, unknown>,
  config: BrowserToolsConfig,
): Promise<BrowserToolOutcome> {
  const bridge = browserBridge();
  const timeout = config.timeoutMs;
  const selector = coerceSelector(args.selector);

  switch (name) {
    case 'browser_snapshot': {
      const r = await bridge.snapshot();
      if (!r.ok || !r.result) return err(r);
      const text = renderSnapshot(r.result);
      return {
        ok: true,
        summary: `${r.result.interactive} elemento(s) interativo(s), ${r.result.buttons.length} botao(s)`,
        context: text,
      };
    }

    case 'browser_query': {
      const r = await bridge.send<{ matches: ElementInfo[] }>('query', { selector, all: Boolean(args.all) }, timeout);
      if (!r.ok || !r.result) return err(r);
      const matches = r.result.matches;
      if (matches.length === 0) {
        return { ok: true, summary: 'nenhum elemento', context: `Nenhum elemento para "${String(selector)}".` };
      }
      const text = matches
        .map((m) => `[${m.index}] ${m.selector} texto="${m.text}" visivel=${m.visible} ${m.disabled ? 'desabilitado' : ''}`)
        .join('\n');
      return { ok: true, summary: `${matches.length} elemento(s)`, context: text };
    }

    case 'browser_read': {
      const r = await bridge.send<ElementInfo & { found?: boolean; html?: string; message?: string }>('read', { selector }, timeout);
      if (!r.ok || !r.result) return err(r);
      if (!r.result.found) {
        return { ok: false, summary: 'nao encontrado', context: r.result.message ?? 'Elemento nao encontrado.' };
      }
      const text = [
        `seletor: ${r.result.selector}`,
        `texto: ${r.result.text}`,
        `html: ${(r.result.html ?? '').slice(0, 800)}`,
      ].join('\n');
      return { ok: true, summary: r.result.selector, context: text };
    }

    case 'browser_click': {
      const r = await bridge.send<{ ok: boolean; message?: string; selector?: string }>('click', { selector }, timeout);
      if (!r.ok || !r.result) return err(r);
      if (!r.result.ok) {
        return { ok: false, summary: 'clique falhou', context: `ERRO: ${r.result.message}` };
      }
      return {
        ok: true,
        summary: `clicou em ${r.result.selector}`,
        context: `Clique em "${r.result.selector}". Releia com browser_snapshot para ver o resultado.`,
      };
    }

    case 'browser_type': {
      const r = await bridge.send<{ ok: boolean; message?: string; selector?: string; value?: string }>(
        'type',
        { selector, text: String(args.text ?? ''), submit: Boolean(args.submit) },
        timeout,
      );
      if (!r.ok || !r.result) return err(r);
      if (!r.result.ok) {
        return { ok: false, summary: 'digitacao falhou', context: `ERRO: ${r.result.message}` };
      }
      return {
        ok: true,
        summary: `digitou em ${r.result.selector}`,
        context: `Valor agora: "${r.result.value ?? ''}". Releia com browser_snapshot.`,
      };
    }

    default:
      return { ok: false, summary: 'ferramenta desconhecida', context: `ERRO: ferramenta ${name} nao existe.` };
  }
}

export const BROWSER_INSTRUCTIONS = `
Voce tem acesso ao preview em execucao pelas ferramentas browser_*.
Ciclo recomendado depois de cada patch:
1. browser_click / browser_type para interagir
2. browser_snapshot para VER o resultado
3. Se aparecer erro no console, corrija e repita

Se browser_* responder "Preview ainda nao terminou de carregar", peca ao
usuario para recarregar o preview antes de continuar.
`.trim();

export type { Snapshot, ElementInfo };