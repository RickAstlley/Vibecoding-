import type { ToolDef } from '../ia/client';
import type { AgentMode } from './modes';

export interface ToolResultPayload {
  ok: boolean;
  summary: string;
  data?: unknown;
  patchPath?: string;
}

const READ_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Caminho do arquivo relativo a raiz do projeto' },
  },
  required: ['path'],
} as const;

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Termo a buscar' },
    path: { type: 'string', description: 'Pasta onde buscar (opcional)' },
    regex: { type: 'boolean', description: 'Tratar como expressao regular' },
  },
  required: ['query'],
} as const;

const EDIT_LINE_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Arquivo alvo (exatamente 1)' },
    line: { type: 'number', description: 'Numero da linha, 1-indexado' },
    text: { type: 'string', description: 'Novo conteudo da linha' },
  },
  required: ['path', 'line', 'text'],
} as const;

const EDIT_ANCHOR_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Arquivo alvo (exatamente 1)' },
    anchor: { type: 'string', description: 'Nome do simbolo a substituir (funcao, classe, const, metodo)' },
    text: { type: 'string', description: 'Novo conteudo do bloco, incluindo a assinatura' },
  },
  required: ['path', 'anchor', 'text'],
} as const;

const WRITE_FILE_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Arquivo alvo (exatamente 1)' },
    content: { type: 'string', description: 'Conteudo completo do arquivo' },
  },
  required: ['path', 'content'],
} as const;

const FINISH_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Resumo do que foi feito' },
    done: { type: 'boolean', description: 'true quando a tarefa terminou' },
  },
  required: ['summary', 'done'],
} as const;

export function toolsFor(mode: AgentMode, toolset: Array<'read' | 'edit' | 'search' | 'run' | 'finish'>): ToolDef[] {
  const tools: ToolDef[] = [];
  const allow = (t: 'read' | 'edit' | 'search' | 'run' | 'finish'): boolean => toolset.includes(t);

  if (allow('read')) {
    tools.push({
      name: 'read_file',
      description: 'Le o conteudo de um arquivo do projeto. Use antes de qualquer edicao.',
      parameters: READ_SCHEMA as unknown as Record<string, unknown>,
    });
  }

  if (allow('search')) {
    tools.push({
      name: 'search_code',
      description: 'Busca um termo em todos os arquivos do projeto. Retorna arquivo:linha:texto.',
      parameters: SEARCH_SCHEMA as unknown as Record<string, unknown>,
    });
  }

  if (allow('edit')) {
    tools.push({
      name: 'edit_line',
      description: 'Substitui exatamente UMA linha de UM arquivo. Use para ajustes pontuais. Nada mais no arquivo e alterado.',
      parameters: EDIT_LINE_SCHEMA as unknown as Record<string, unknown>,
    });
    tools.push({
      name: 'edit_anchor',
      description: 'Substitui um bloco de UM arquivo, identificado pelo nome do simbolo (funcao, classe, const, metodo).',
      parameters: EDIT_ANCHOR_SCHEMA as unknown as Record<string, unknown>,
    });
    tools.push({
      name: 'write_file',
      description: 'Reescreve UM arquivo inteiro. Use apenas para arquivo pequeno ou mudanca estrutural.',
      parameters: WRITE_FILE_SCHEMA as unknown as Record<string, unknown>,
    });
  }

  if (allow('finish')) {
    tools.push({
      name: 'finish',
      description: 'Encerra a execucao com um resumo do que foi feito.',
      parameters: FINISH_SCHEMA as unknown as Record<string, unknown>,
    });
  }

  return tools;
}

export function buildToolsForMode(mode: AgentMode): ToolDef[] {
  return toolsFor(mode, []);
}

export interface ToolExecutionContext {
  read(path: string): Promise<string | null>;
  listFiles(): Promise<string[]>;
  search(query: string, scope?: string, regex?: boolean): Promise<Array<{ path: string; line: number; text: string }>>;
  applyEdit(tool: string, args: Record<string, unknown>): Promise<ToolResultPayload>;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResultPayload> {
  switch (name) {
    case 'read_file': {
      const path = String(args.path ?? '');
      const content = await ctx.read(path);
      if (content === null) return { ok: false, summary: `Arquivo nao encontrado: ${path}` };
      const lines = content.split('\n').length;
      return { ok: true, summary: `${path} (${lines} linhas)\n${content}`, data: { path, lines } };
    }
    case 'search_code': {
      const query = String(args.query ?? '');
      const scope = args.path ? String(args.path) : undefined;
      const regex = Boolean(args.regex);
      const hits = await ctx.search(query, scope, regex);
      if (hits.length === 0) return { ok: true, summary: `Nenhum resultado para "${query}"`, data: { hits } };
      const text = hits.slice(0, 60).map((h) => `${h.path}:${h.line}: ${h.text.trim()}`).join('\n');
      return {
        ok: true,
        summary: `${hits.length} resultado(s) para "${query}"\n${text}`,
        data: { hits: hits.slice(0, 60) },
      };
    }
    case 'edit_line':
    case 'edit_anchor':
    case 'write_file': {
      return ctx.applyEdit(name, args);
    }
    case 'finish': {
      return { ok: true, summary: String(args.summary ?? ''), data: { done: Boolean(args.done) } };
    }
    default:
      return { ok: false, summary: `Ferramenta desconhecida: ${name}` };
  }
}