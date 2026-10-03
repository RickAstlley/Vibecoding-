import { describe, expect, it, vi } from 'vitest';
import {
  McpClient,
  McpError,
  MCP_CONFIG_TEMPLATE,
  parseMaybeSse,
  parseMcpConfig,
  qualifyTool,
  unqualifyTool,
} from '@/core/mcp/client';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function rpcResult(result: unknown, id = 1): Response {
  return jsonResponse({ jsonrpc: '2.0', id, result });
}

function sseResponse(payload: unknown): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('parseMaybeSse', () => {
  it('parseia JSON puro', () => {
    expect(parseMaybeSse('{"a":1}')).toEqual({ a: 1 });
  });

  it('parseia frame SSE', () => {
    expect(parseMaybeSse('event: message\ndata: {"b":2}\n\n')).toEqual({ b: 2 });
  });

  it('devolve null para lixo', () => {
    expect(parseMaybeSse('nao é json')).toBeNull();
    expect(parseMaybeSse('')).toBeNull();
  });

  it('pula frame que nao parseia e tenta o proximo', () => {
    expect(parseMaybeSse('data: quebrado\ndata: {"ok":1}')).toEqual({ ok: 1 });
  });
});

describe('qualificacao de nomes', () => {
  it('qualifica com o servidor', () => {
    expect(qualifyTool('github', 'create_issue')).toBe('mcp__github__create_issue');
  });

  it('desfaz a qualificacao', () => {
    expect(unqualifyTool('mcp__github__create_issue')).toEqual({ serverId: 'github', tool: 'create_issue' });
  });

  it('sobrevive a serverId com underscore', () => {
    expect(unqualifyTool('mcp__meu_server__fazer_coisa')).toEqual({ serverId: 'meu_server', tool: 'fazer_coisa' });
  });

  it('devolve null para nome sem prefixo', () => {
    expect(unqualifyTool('read_file')).toBeNull();
  });
});

describe('parseMcpConfig', () => {
  it('le o formato padrao', () => {
    const cfg = parseMcpConfig('{"mcpServers":{"a":{"url":"https://a.dev/mcp"}}}');
    expect(Object.keys(cfg.mcpServers)).toEqual(['a']);
    expect(cfg.mcpServers.a?.url).toBe('https://a.dev/mcp');
  });

  it('aceita label e headers', () => {
    const cfg = parseMcpConfig('{"mcpServers":{"a":{"url":"u","label":"A","headers":{"X":"1"}}}}');
    expect(cfg.mcpServers.a?.label).toBe('A');
    expect(cfg.mcpServers.a?.headers?.X).toBe('1');
  });

  it('descarta entrada sem url', () => {
    const cfg = parseMcpConfig('{"mcpServers":{"a":{"label":"sem url"}}}');
    expect(Object.keys(cfg.mcpServers)).toHaveLength(0);
  });

  it('rejeita JSON sem mcpServers', () => {
    expect(() => parseMcpConfig('{"outro":1}')).toThrow(McpError);
  });

  it('o template e um JSON valido', () => {
    expect(() => parseMcpConfig(MCP_CONFIG_TEMPLATE)).not.toThrow();
  });
});

describe('McpClient', () => {
  it('faz initialize e guarda o session id', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === 'initialize') {
        return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'srv', version: '1' } } }, 200, { 'mcp-session-id': 'sess-123' });
      }
      if (body.method === 'tools/list') return rpcResult({ tools: [{ name: 'ferramenta' }] });
      return new Response('', { status: 202 });
    });

    const client = new McpClient('https://mcp.dev', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const info = await client.initialize();

    expect(info.protocolVersion).toBe('2025-06-18');
    expect(info.serverInfo?.name).toBe('srv');

    await client.listTools();
    const lastCall = fetchImpl.mock.calls.at(-1)?.[1] as RequestInit;
    expect((lastCall.headers as Record<string, string>)['mcp-session-id']).toBe('sess-123');
  });

  it('lista ferramentas', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === 'tools/list') {
        return rpcResult({
          tools: [
            { name: 'buscar', description: 'busca arquivos', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
            { name: '', description: 'invalida' },
          ],
        });
      }
      return new Response('', { status: 202 });
    });

    const client = new McpClient('https://mcp.dev', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const tools = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('buscar');
  });

  it('normaliza ferramenta sem inputSchema', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === 'tools/list') return rpcResult({ tools: [{ name: 'x' }] });
      return new Response('', { status: 202 });
    });
    const client = new McpClient('https://mcp.dev', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const tools = await client.listTools();
    expect(tools[0]?.inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('chama ferramenta e junta o conteudo', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === 'tools/call') {
        return rpcResult({ content: [{ type: 'text', text: 'linha 1' }, { type: 'text', text: 'linha 2' }] });
      }
      return new Response('', { status: 202 });
    });
    const client = new McpClient('https://mcp.dev', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.callTool('buscar', { q: 'x' })).toBe('linha 1\nlinha 2');
  });

  it('levanta erro quando a ferramenta retorna isError', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === 'tools/call') return rpcResult({ content: [{ type: 'text', text: 'deu ruim' }], isError: true });
      return new Response('', { status: 202 });
    });
    const client = new McpClient('https://mcp.dev', { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.callTool('x', {})).rejects.toThrow('deu ruim');
  });

  it('aceita resposta SSE', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === 'tools/list') {
        return sseResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'via_sse' }] } });
      }
      return new Response('', { status: 202 });
    });
    const client = new McpClient('https://mcp.dev', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const tools = await client.listTools();
    expect(tools[0]?.name).toBe('via_sse');
  });

  it('reporta erro HTTP com detalhe', async () => {
    const fetchImpl = vi.fn(async () => new Response('sem autorizacao', { status: 401 }));
    const client = new McpClient('https://mcp.dev', { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.initialize()).rejects.toThrow(/401/);
  });

  it('reporta erro JSON-RPC', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'metodo nao encontrado' } }),
    );
    const client = new McpClient('https://mcp.dev', { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.initialize()).rejects.toThrow('metodo nao encontrado');
  });

  it('resources/list que falha devolve lista vazia', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === 'resources/list') return jsonResponse({ jsonrpc: '2.0', id: body.id, error: { code: -1, message: 'nao suporta' } });
      return new Response('', { status: 202 });
    });
    const client = new McpClient('https://mcp.dev', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.listResources()).toEqual([]);
  });
});