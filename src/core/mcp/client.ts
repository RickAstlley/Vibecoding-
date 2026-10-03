/**
 * Cliente MCP (Model Context Protocol) sobre JSON-RPC 2.0 via Streamable HTTP.
 *
 * Descobre ferramentas de servidores MCP e as converte para o formato que o
 * agente ja entende, sem que o modelo precise saber que MCP existe.
 */

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpServer {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
  /** Ferramentas descobertas no ultimo handshake. */
  tools: McpToolDef[];
  resources: McpResource[];
  status: 'disconnected' | 'connecting' | 'ready' | 'error';
  error: string | null;
  lastSync: number | null;
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = '2025-06-18';

export class McpError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
    this.name = 'McpError';
  }
}

export interface McpClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Cabecalhos extras (autenticacao). */
  headers?: Record<string, string>;
}

export class McpClient {
  private idCounter = 0;
  private sessionId: string | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly url: string, private readonly options: McpClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...(this.options.headers ?? {}),
    };
  }

  private async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.idCounter += 1;
    const body = JSON.stringify({ jsonrpc: '2.0', id: this.idCounter, method, params });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: this.headers(),
        body,
        signal: controller.signal,
      });

      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new McpError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
      }

      const text = await res.text();
      const json = parseMaybeSse(text);

      if (!json) throw new McpError('Resposta nao é JSON nem SSE valido', -1);
      const typed = json as JsonRpcResponse<T>;

      if (typed.error) {
        throw new McpError(typed.error.message, typed.error.code);
      }
      if (typed.result === undefined) {
        throw new McpError('Resposta sem campo result', -1);
      }
      return typed.result;
    } catch (e) {
      if (e instanceof McpError) throw e;
      if (e instanceof Error && e.name === 'AbortError') {
        throw new McpError(`Timeout de ${Math.round(this.timeoutMs / 1000)}s chamando ${method}`, -2);
      }
      throw new McpError(e instanceof Error ? e.message : String(e), -3);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Handshake: anuncia o cliente e inicializa a sessao. */
  async initialize(clientName = 'arcanum-weaver'): Promise<{ protocolVersion: string; serverInfo?: { name: string; version: string } }> {
    const result = await this.rpc<{
      protocolVersion: string;
      serverInfo?: { name: string; version: string };
      capabilities?: Record<string, unknown>;
    }>('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      clientInfo: { name: clientName, version: '0.1.0' },
    });

    await this.notify('notifications/initialized', {});
    return { protocolVersion: result.protocolVersion, ...(result.serverInfo ? { serverInfo: result.serverInfo } : {}) };
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await this.fetchImpl(this.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
        signal: controller.signal,
      });
    } catch {
      /* notificacao e best-effort */
    } finally {
      clearTimeout(timer);
    }
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = await this.rpc<{ tools?: McpToolDef[] }>('tools/list');
    return (result.tools ?? []).map(normalizeTool).filter((t): t is McpToolDef => t !== null);
  }

  async listResources(): Promise<McpResource[]> {
    try {
      const result = await this.rpc<{ resources?: McpResource[] }>('resources/list');
      return result.resources ?? [];
    } catch {
      return [];
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.rpc<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }>(
      'tools/call',
      { name, arguments: args },
    );

    if (result.isError) {
      const text = (result.content ?? []).map((c) => c.text ?? '').join('\n');
      throw new McpError(text || 'ferramenta retornou erro', 0);
    }

    return (result.content ?? [])
      .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
      .join('\n');
  }

  close(): void {
    this.sessionId = null;
  }
}

/** Respostas MCP podem vir como JSON puro ou como um frame SSE. */
export function parseMaybeSse(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      return JSON.parse(payload);
    } catch {
      /* tenta o proximo frame */
    }
  }
  return null;
}

function normalizeTool(tool: McpToolDef): McpToolDef | null {
  if (!tool || typeof tool.name !== 'string' || tool.name.length === 0) return null;
  return {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
  };
}

/** Nomes de ferramenta MCP precisam ser unicos entre servidores. */
export function qualifyTool(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName}`;
}

export function unqualifyTool(qualified: string): { serverId: string; tool: string } | null {
  const m = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(qualified);
  if (!m) return null;
  return { serverId: m[1] as string, tool: m[2] as string };
}

/** Configuracao persistida dos servidores MCP. */
export interface McpConfigFile {
  mcpServers: Record<string, { url: string; label?: string; headers?: Record<string, string> }>;
}

export function parseMcpConfig(json: string): McpConfigFile {
  const parsed = JSON.parse(json) as Partial<McpConfigFile>;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.mcpServers !== 'object' || parsed.mcpServers === null) {
    throw new McpError('JSON invalido: esperado { "mcpServers": { nome: { url } } }', -1);
  }
  const out: McpConfigFile = { mcpServers: {} };
  for (const [id, value] of Object.entries(parsed.mcpServers)) {
    const entry = value as { url?: string; label?: string; headers?: Record<string, string> };
    if (!entry || typeof entry.url !== 'string') continue;
    out.mcpServers[id] = {
      url: entry.url,
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.headers ? { headers: entry.headers } : {}),
    };
  }
  return out;
}

export const MCP_CONFIG_TEMPLATE = `{
  "mcpServers": {
    "filesystem": {
      "url": "https://mcp.exemplo.com/mcp"
    },
    "github": {
      "url": "https://api.exemplo.com/mcp",
      "headers": { "Authorization": "Bearer SEU_TOKEN" }
    }
  }
}`;