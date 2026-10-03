'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Terminal as TerminalIcon, Trash2, Cpu, Wifi, WifiOff, Loader2 } from 'lucide-react';
import type { ExecChunk, ExecResult, RuntimeKind, RuntimeStatus } from '@/core/runtime/adapter';
import { DEFAULT_RUNTIME_CONFIG, createRuntime, type RuntimeConfig } from '@/core/runtime';

const MAX_LINES = 800;

export interface TerminalPanelProps {
  config: RuntimeConfig;
  onConfigChange?(config: RuntimeConfig): void;
  /** Arquivos do projeto, sincronizados antes de rodar. */
  files: Array<{ path: string; content: string }>;
  onStatusChange?(status: RuntimeStatus): void;
}

export function TerminalPanel({ config, files, onStatusChange }: TerminalPanelProps) {
  const [lines, setLines] = useState<ExecChunk[]>([]);
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState('npm test');
  const [status, setStatus] = useState<RuntimeStatus>(() => createRuntime(config).status());
  const scroller = useRef<HTMLDivElement>(null);
  const synced = useRef(false);
  const runtimeKey = `${config.kind}|${config.remote.baseUrl}|${config.local.imageUrl}`;
  // a config so muda quando runtimeKey muda; recrea o adapternesse caso
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const adapter = useMemo(() => createRuntime(config), [runtimeKey]);

  useEffect(() => {
    synced.current = false;
  }, [adapter]);

  useEffect(() => () => void adapter.destroy(), [adapter]);

  const append = useCallback((chunk: ExecChunk) => {
    setLines((prev) => [...prev, chunk].slice(-MAX_LINES));
  }, []);

  useEffect(() => {
    const off = adapter.onChunk(append);
    return () => {
      off();
    };
  }, [adapter, append]);

  useEffect(() => {
    let alive = true;
    const boot = async (): Promise<void> => {
      const s = await adapter.boot();
      if (!alive) return;
      setStatus(s);
      onStatusChange?.(s);
    };
    void boot();
    return () => {
      alive = false;
    };
  }, [adapter, onStatusChange]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines]);

  const run = useCallback(async () => {
    if (busy || !command.trim()) return;
    setBusy(true);
    setLines([]);
    try {
      if (!synced.current) {
        await adapter.sync(files);
        synced.current = true;
      }
      const result = await adapter.exec({ command, language: 'auto' });
      if (result.error && result.chunks.length === 0) {
        setLines([{ kind: 'system', text: result.error, ts: Date.now() }]);
      }
    } catch (e) {
      setLines([{ kind: 'stderr', text: e instanceof Error ? e.message : String(e), ts: Date.now() }]);
    } finally {
      setBusy(false);
    }
  }, [adapter, busy, command, files]);

  const kindLabel: Record<RuntimeKind, string> = {
    none: 'desativado',
    local: 'WebContainer (local)',
    remote: 'endpoint remoto',
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card/40 px-2 py-1.5">
        {status.booting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-arc" />
        ) : status.ready ? (
          <Wifi className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-[11px] font-medium">Terminal</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{kindLabel[config.kind]}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <IconBtn title="Limpar" onClick={() => setLines([])}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </span>
      </div>

      {status.unavailableReason && (
        <div className="border-b border-border bg-yellow-500/10 px-2 py-1.5 text-[10px] text-yellow-400">
          {status.unavailableReason}
          {status.detail && <span className="block text-muted-foreground">{status.detail}</span>}
        </div>
      )}

      <div className="flex shrink-0 gap-1 border-b border-border p-1.5">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && status.ready && !busy) void run();
          }}
          placeholder="npm test"
          className="min-w-0 flex-1 rounded border border-border bg-card/50 px-2 py-1 font-mono text-[11px] outline-none focus:border-arc/60"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={!status.ready || busy || !command.trim()}
          title="Executar"
          className="rounded bg-arc px-2 text-white disabled:opacity-40"
        >
          {busy ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </button>
      </div>

      <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <TerminalIcon className="h-6 w-6 opacity-40" />
            <span className="text-[11px]">Saida do comando aparece aqui</span>
          </div>
        ) : (
          lines.map((c, i) => (
            <div
              key={i}
              className={
                c.kind === 'stderr'
                  ? 'whitespace-pre-wrap text-red-400'
                  : c.kind === 'system'
                    ? 'whitespace-pre-wrap text-yellow-400'
                    : 'whitespace-pre-wrap text-foreground'
              }
            >
              {c.text}
            </div>
          ))
        )}
      </div>

      {busy && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          executando
        </div>
      )}
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

export { DEFAULT_RUNTIME_CONFIG, Cpu };
export type { ExecResult };