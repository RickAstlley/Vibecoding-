'use client';

import { useCallback, useState } from 'react';
import { Plug, RefreshCw, Wrench } from 'lucide-react';
import { MCP_CONFIG_TEMPLATE, McpClient, parseMcpConfig, type McpServer } from '@/core/mcp/client';

export function McpPanel() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [configJson, setConfigJson] = useState(MCP_CONFIG_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectAll = useCallback(async () => {
    setBusy(true);
    setError(null);

    let parsed;
    try {
      parsed = parseMcpConfig(configJson);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }

    const next: McpServer[] = [];

    for (const [id, entry] of Object.entries(parsed.mcpServers)) {
      const client = new McpClient(entry.url, entry.headers ? { headers: entry.headers } : {});

      const server: McpServer = {
        id,
        label: entry.label ?? id,
        url: entry.url,
        enabled: true,
        tools: [],
        resources: [],
        status: 'connecting',
        error: null,
        lastSync: null,
      };

      try {
        await client.initialize();
        const tools = await client.listTools();
        const resources = await client.listResources();
        next.push({
          ...server,
          tools,
          resources,
          status: 'ready',
          lastSync: Date.now(),
        });
      } catch (e) {
        next.push({ ...server, status: 'error', error: e instanceof Error ? e.message : String(e) });
      } finally {
        client.close();
      }
    }

    setServers(next);
    setBusy(false);

    const ready = next.filter((s) => s.status === 'ready');
    const failed = next.length - ready.length;
    if (failed > 0) setError(`${failed} servidor(es) falharam ao conectar`);
  }, [configJson]);

  const totalTools = servers.reduce((acc, s) => acc + s.tools.length, 0);

  return (
    <div className="scrollbar-thin h-full overflow-auto p-3">
      <div className="mb-3">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <Plug className="h-4 w-4 text-arc" />
          Servidores MCP
        </h3>
        <p className="text-[11px] text-muted-foreground">
          tools externas via Model Context Protocol. As ferramentas descubtas entram no agente
          com o prefixo <code className="font-mono">mcp__servidor__</code>.
        </p>
      </div>

      <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
        mcp.json
      </label>
      <textarea
        value={configJson}
        onChange={(e) => setConfigJson(e.target.value)}
        rows={7}
        spellCheck={false}
        className="w-full resize-none rounded border border-border bg-card/50 p-2 font-mono text-[10px] outline-none focus:border-arc/60"
      />

      <button
        type="button"
        onClick={() => void connectAll()}
        disabled={busy}
        className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded bg-arc px-2 py-1.5 text-[11px] text-white disabled:opacity-40"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        {busy ? 'conectando...' : 'conectar servidores'}
      </button>

      {error && <p className="mt-2 rounded bg-destructive/10 p-2 text-[10px] text-destructive">{error}</p>}

      {servers.length > 0 && (
        <>
          <div className="mt-3 mb-1.5 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Conectados
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {totalTools} ferramenta(s)
            </span>
          </div>

          <ul className="space-y-1.5">
            {servers.map((server) => (
              <li key={server.id} className="rounded-lg border border-border bg-card/40 p-2.5">
                <div className="mb-1 flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      server.status === 'ready' ? 'bg-emerald-400' : server.status === 'error' ? 'bg-destructive' : 'bg-muted-foreground'
                    }`}
                  />
                  <span className="text-[11px] font-medium">{server.label}</span>
                  <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                    {server.tools.length} tools · {server.resources.length} resources
                  </span>
                </div>

                <p className="truncate font-mono text-[9px] text-muted-foreground/70">{server.url}</p>

                {server.error && <p className="mt-1 text-[10px] text-destructive">{server.error}</p>}

                {server.tools.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                      ferramentas
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {server.tools.map((tool) => (
                        <li key={tool.name} className="flex items-start gap-1 text-[10px]">
                          <Wrench className="mt-0.5 h-2.5 w-2.5 shrink-0 text-arc" />
                          <span className="min-w-0">
                            <span className="font-mono text-foreground">{tool.name}</span>
                            {tool.description && (
                              <span className="block truncate text-muted-foreground">{tool.description}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground">
        O protocolo usado é o Streamable HTTP (JSON-RPC 2.0). Servidores que só falam stdio nao
        funcionam direto no browser - precisam de uma ponte HTTP na frente.
      </p>
    </div>
  );
}