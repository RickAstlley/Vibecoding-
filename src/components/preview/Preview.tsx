'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Monitor, RotateCw, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { vfs } from '@/core/vfs/vfs';
import { browserBridge } from '@/core/browser/bridge-client';
import { buildBundle, buildPreviewHtml, type BundleResult } from '@/core/build/bundler';

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  text: string;
  ts: number;
}

type Viewport = 'mobile' | 'tablet' | 'desktop';

const WIDTHS: Record<Viewport, number> = { mobile: 390, tablet: 768, desktop: 0 };

const SCRIPT_ENTRY = /\.(tsx?|jsx?|mjs)$/i;
const MAX_INLINE_BYTES = 2 * 1024 * 1024;

const AUTO_RELOAD_DEBOUNCE_MS = 700;
const SMOKE_TIMEOUT_MS = 6000;

export interface SmokeState {
  state: 'running' | 'ok' | 'failed';
  message: string;
}

export interface PreviewProps {
  refreshToken: number;
  onConsoleChange?(entries: ConsoleEntry[]): void;
  /** Liga/desliga o recarregamento automatico apos mudanca de arquivo. */
  autoReload?: boolean;
  onToggleAutoReload?(): void;
  /** Smoke test: rodar verificacao de erro fatal a cada reload. */
  smokeTest?: boolean;
  onToggleSmoke?(): void;
  onSmokeChange?(state: SmokeState | null): void;
  /** Compila TSX/JSX localmente antes de servir. */
  bundlerEnabled?: boolean;
  /** Permite buscar pacotes na CDN quando nao ha node_modules. */
  cdnFallback?: boolean;
}

function ToggleBtn({
  active,
  onClick,
  title,
  label,
}: {
  active: boolean;
  onClick(): void;
  title: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
        active ? 'bg-arc/20 text-arc-fg' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

export function Preview({
  refreshToken,
  onConsoleChange,
  autoReload = true,
  onToggleAutoReload,
  smokeTest = false,
  onToggleSmoke,
  onSmokeChange,
  bundlerEnabled = true,
  cdnFallback = true,
}: PreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [entry, setEntry] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [fatal, setFatal] = useState<string | null>(
    typeof navigator !== 'undefined' && !('serviceWorker' in navigator) ? 'Service Worker indisponivel neste navegador' : null,
  );
  // Incrementa quando o VFS terminou de ser enviado ao Service Worker.
  // O auto-reload depende deste e nao do refreshToken: recarregar antes da
  // sincronizacao deixava o iframe pegando 404 para sempre no primeiro acesso.
  const [syncToken, setSyncToken] = useState(0);
  const [smoke, setSmoke] = useState<SmokeState | null>(() =>
    smokeTest && entry ? { state: 'running', message: 'Verificando preview...' } : null,
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

  /**
   * Decide a estrategia de servir o projeto:
   *  - se o entrypoint e script (TSX/JSX) chama o bundler local e envia os
   *    modulos ja transformados + import map;
   *  - senao envia os arquivos como estao (HTML/CSS/JS puro).
   */
  const syncVfs = useCallback(async (): Promise<{ entry: string | null; bundle: BundleResult | null }> => {
    const files = await vfs().listFiles();
    const textFiles = files.filter((f) => f.content !== null && f.size <= MAX_INLINE_BYTES);
    if (textFiles.length === 0) {
      setEntry(null);
      return { entry: null, bundle: null };
    }

    const index = textFiles.find((f) => f.path === 'index.html');
    const html = index?.content ?? null;

    const candidates = ['src/main.tsx', 'src/main.ts', 'src/main.jsx', 'src/index.tsx', 'src/index.ts', 'main.ts'];
    const entryPath = candidates.find((p) => files.some((f) => f.path === p)) ?? null;

    const needsBundle = bundlerEnabled && Boolean(entryPath && SCRIPT_ENTRY.test(entryPath));
    if (!needsBundle || !entryPath) {
      setEntry(html ? 'index.html' : (textFiles[0]?.path ?? null));
      return { entry: html ? 'index.html' : (textFiles[0]?.path ?? null), bundle: null };
    }

    const byPath = new Map(textFiles.map((f) => [f.path, f.content as string]));
    const nodeModules = files.some((f) => f.path.startsWith('node_modules/'));

    const result = await buildBundle({
      entry: entryPath,
      readProject: async (p) => byPath.get(p) ?? null,
      readNodeModule: async (p) => {
        const direct = byPath.get(p);
        if (direct !== undefined) return direct;
        const file = await vfs().readText(p);
        return file;
      },
      hasNodeModules: () => nodeModules,
      allowCdn: cdnFallback,
    });

    const htmlSource = html ?? '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
    const bundledHtml = buildPreviewHtml(htmlSource, result);

    setEntry('index.html');
    return { entry: 'index.html', bundle: result, bundledHtml } as never;
  }, [cdnFallback, bundlerEnabled]);

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
      const files = await vfs().listFiles();
      if (cancelled) return;
      const reg = await navigator.serviceWorker.ready;
      reg.active?.postMessage({ type: 'vfs:reset' });

      const text = files
        .filter((f) => f.content !== null && f.size <= MAX_INLINE_BYTES)
        .map((f) => ({ path: f.path, content: f.content as string }));

      const { bundledHtml, bundle } = (await syncVfs()) as { bundledHtml?: string; bundle: BundleResult | null };
      if (cancelled) return;

      // Modulos compilados tem precedencia sobre o fonte original.
      const compiledPaths = new Set<string>();
      if (bundle) {
        const modules = bundle.files
          .filter((f) => f.origin === 'project' || f.origin === 'cdn' || f.origin === 'node_modules')
          .map((f) => ({ path: f.path, content: new TextDecoder().decode(f.bytes) }));
        reg.active?.postMessage({ type: 'vfs:put-modules', modules });
        for (const m of modules) compiledPaths.add(m.path);
        reg.active?.postMessage({ type: 'vfs:import-map', content: bundle.importMap });
      }

      const raw = text.filter((f) => !compiledPaths.has(f.path));
      if (bundledHtml) {
        raw.push({ path: 'index.html', content: bundledHtml });
      }
      reg.active?.postMessage({ type: 'vfs:put-many', files: raw });
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, refreshToken, syncVfs]);

  useEffect(() => () => browserBridge().detach(), []);

  const smokeErrors = useRef<string[]>([]);
  const smokeTimer = useRef<number | null>(null);

  const finishSmoke = useCallback(
    (state: SmokeState['state'], message: string) => {
      if (smokeTimer.current !== null) {
        window.clearTimeout(smokeTimer.current);
        smokeTimer.current = null;
      }
      const next: SmokeState = { state, message };
      setSmoke(next);
      onSmokeChange?.(next);
    },
    [onSmokeChange],
  );

  useEffect(() => {
    const handler = (e: MessageEvent): void => {
      const data = e.data as { type?: string; level?: ConsoleEntry['level']; text?: string };
      if (data?.type === 'console') {
        const level = data.level ?? 'log';
        push(level, data.text ?? '');
        if (smokeTest && level === 'error' && data.text) {
          smokeErrors.current.push(data.text);
          finishSmoke('failed', data.text);
        }
      }
      if (data?.type === 'ready') {
        setFatal(null);
        finishSmoke('ok', 'Preview carregou sem erro fatal');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [push, smokeTest, finishSmoke]);

  const reloadKey = useRef(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const autoReloadEnabled = autoReload;

  // Dispara o smoke test: se a pagina nao mandar 'ready' nem erro em tempo
  // razoavel, tratamos como falha (script quebrado antes do bridge).
  useEffect(() => {
    if (!smokeTest || !entry) return;
    const timer = window.setTimeout(() => {
      finishSmoke('failed', 'Preview nao respondeu em 6s (o script pode ter falhado antes do console)');
    }, SMOKE_TIMEOUT_MS);
    smokeTimer.current = timer;
    return () => {
      if (smokeTimer.current !== null) window.clearTimeout(smokeTimer.current);
      smokeTimer.current = null;
    };
  }, [smokeTest, entry, reloadNonce, finishSmoke]);

  const startSmoke = useCallback((): void => {
    if (!smokeTest) {
      setSmoke(null);
      return;
    }
    const next: SmokeState = { state: 'running', message: 'Verificando preview...' };
    setSmoke(next);
    onSmokeChange?.(next);
  }, [smokeTest, onSmokeChange]);

  const reload = (): void => {
    setEntries([]);
    smokeErrors.current = [];
    browserBridge().detach();
    startSmoke();
    reloadKey.current += 1;
    setReloadNonce(reloadKey.current);
  };

  /**
   * Auto-reload com debounce, disparado so depois que a sincronizacao terminou.
   */
  useEffect(() => {
    if (!ready || !autoReloadEnabled || syncToken === 0) return;
    const timer = window.setTimeout(() => {
      setEntries([]);
      smokeErrors.current = [];
      startSmoke();
      reloadKey.current += 1;
      setReloadNonce(reloadKey.current);
    }, AUTO_RELOAD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [ready, syncToken, autoReloadEnabled, startSmoke]);

  const openExternal = (): void => {
    if (!frame.current?.contentWindow) return;
    const url = frame.current.src;
    window.open(url, '_blank', 'noopener');
  };

  const width = WIDTHS[viewport];

  /*
   * `allow-same-origin` e obrigatorio: sem ele o iframe tem origem opaca e o
   * Service Worker nao o controla, entao o preview fica sempre em 404.
   *
   * Consequencia: o codigo do preview roda na mesma origem do IDE e pode ler
   * o localStorage, onde ficam as chaves de API. Mitigacao: a opcao
   * "lembrar chaves" nas configuracoes deixa a chave apenas na memoria da aba.
   */
  const sandboxTokens = 'allow-scripts allow-modals allow-forms allow-popups allow-same-origin';

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
        {smoke && (
          <span
            title={smoke.message}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
              smoke.state === 'ok'
                ? 'bg-emerald-500/15 text-emerald-400'
                : smoke.state === 'failed'
                  ? 'bg-destructive/20 text-destructive'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {smoke.state === 'running' ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                testando
              </>
            ) : smoke.state === 'ok' ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                ok
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3" />
                erro
              </>
            )}
          </span>
        )}
        <ToggleBtn
          active={autoReload}
          onClick={() => onToggleAutoReload?.()}
          title="Recarregar preview automaticamente quando um arquivo muda"
          label="auto"
        />
        <ToggleBtn
          active={smokeTest}
          onClick={() => onToggleSmoke?.()}
          title="Rodar verificacao de erro fatal a cada reload"
          label="smoke"
        />
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
          sandbox={sandboxTokens}
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