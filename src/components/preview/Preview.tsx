'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Monitor, RotateCw, Smartphone, Tablet, Trash2, AlertTriangle } from 'lucide-react';
import { vfs } from '@/core/vfs/vfs';

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  text: string;
  ts: number;
}

type Viewport = 'mobile' | 'tablet' | 'desktop';

const WIDTHS: Record<Viewport, number> = { mobile: 390, tablet: 768, desktop: 0 };

export interface PreviewProps {
  refreshToken: number;
  onConsoleChange?(entries: ConsoleEntry[]): void;
}

export function Preview({ refreshToken, onConsoleChange }: PreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [entry, setEntry] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [fatal, setFatal] = useState<string | null>(
    typeof navigator !== 'undefined' && !('serviceWorker' in navigator) ? 'Service Worker indisponivel neste navegador' : null,
  );

  const push = useCallback(
    (level: ConsoleEntry['level'], text: string) => {
      const item: ConsoleEntry = { level, text: text.slice(0, 500), ts: Date.now() };
      setEntries((prev) => {
        const next = [...prev, item].slice(-200);
        onConsoleChange?.(next);
        return next;
      });
    },
    [onConsoleChange],
  );

  const syncVfs = useCallback(async () => {
    const files = await vfs().listFiles();
    if (files.length === 0) {
      setEntry(null);
      return;
    }
    const payload: Array<{ path: string; content: string }> = [];
    for (const f of files) {
      if (f.content === null) continue;
      if (f.size > 2 * 1024 * 1024) continue;
      payload.push({ path: f.path, content: f.content });
    }
    setEntry(payload.find((p) => p.path === 'index.html')?.path ?? null);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setFatal(`Falha ao registrar Service Worker: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      await syncVfs();
      const files = await vfs().listFiles();
      if (cancelled) return;
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({
        type: 'vfs:reset',
      });
      const text: Array<{ path: string; content: string }> = [];
      for (const f of files) {
        if (f.content === null) continue;
        if (f.size > 2 * 1024 * 1024) continue;
        text.push({ path: f.path, content: f.content });
      }
      reg.active?.postMessage({ type: 'vfs:put-many', files: text });
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, refreshToken, syncVfs]);

  useEffect(() => {
    const handler = (e: MessageEvent): void => {
      const data = e.data as { type?: string; level?: ConsoleEntry['level']; text?: string };
      if (data?.type === 'console') push(data.level ?? 'log', data.text ?? '');
      if (data?.type === 'ready') setFatal(null);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [push]);

  const reloadKey = useRef(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = (): void => {
    setEntries([]);
    reloadKey.current += 1;
    setReloadNonce(reloadKey.current);
  };

  const openExternal = (): void => {
    if (!frame.current?.contentWindow) return;
    const url = frame.current.src;
    window.open(url, '_blank', 'noopener');
  };

  const width = WIDTHS[viewport];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-1 border-b border-border bg-card/40 px-2 py-1">
        <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
          {(['mobile', 'tablet', 'desktop'] as Viewport[]).map((v) => {
            const Icon = v === 'mobile' ? Smartphone : v === 'tablet' ? Tablet : Monitor;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setViewport(v)}
                title={v}
                className={`rounded p-1 transition-colors ${viewport === v ? 'bg-arc/25 text-arc-fg' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
        <div className="ml-2 min-w-0 flex-1 truncate rounded bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          /__preview__/{entry ?? 'index.html'}
        </div>
        <button
          type="button"
          onClick={() => setConsoleOpen((v) => !v)}
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
            consoleOpen ? 'bg-arc/20 text-arc-fg' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          console
          {entries.length > 0 && (
            <span className="rounded bg-muted px-1 text-[10px]">{entries.filter((e) => e.level === 'error').length || entries.length}</span>
          )}
        </button>
        <button type="button" onClick={reload} title="Recarregar preview" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={openExternal} title="Abrir em nova aba" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid-lines relative flex-1 overflow-auto bg-muted/10 p-3">
        <iframe
          ref={frame}
          title="Preview do site"
          data-testid="preview-frame"
          src={`/__preview__/index.html?r=${reloadNonce}`}
          sandbox="allow-scripts allow-modals allow-forms allow-popups"
          className="mx-auto h-full rounded-md border border-border bg-white shadow-lg"
          style={{ width: width ? `${width}px` : '100%', maxWidth: '100%' }}
        />
        {fatal && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-center">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-destructive" />
              <p className="text-sm text-destructive">{fatal}</p>
            </div>
          </div>
        )}
      </div>

      {consoleOpen && (
        <div className="h-48 shrink-0 overflow-auto border-t border-border bg-card/50 font-mono text-[11px]">
          {entries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Nenhuma mensagem no console do preview
            </div>
          ) : (
            entries.map((e, i) => (
              <div
                key={i}
                className={`flex gap-2 border-b border-border/40 px-2 py-1 ${
                  e.level === 'error' ? 'bg-red-500/10 text-red-400' : e.level === 'warn' ? 'bg-yellow-500/10 text-yellow-400' : 'text-muted-foreground'
                }`}
              >
                <span className="shrink-0 uppercase opacity-60">{e.level}</span>
                <span className="break-all">{e.text}</span>
              </div>
            ))
          )}
        </div>
      )}

      {!entry && !fatal && (
        <div className="flex items-center justify-center gap-2 border-t border-border bg-card/30 px-3 py-1.5 text-[11px] text-muted-foreground">
          <Trash2 className="h-3 w-3" />
          Crie um <code className="font-mono text-arc">index.html</code> na raiz para ver o preview
        </div>
      )}
    </div>
  );
}