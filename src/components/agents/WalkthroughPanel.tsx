'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ListChecks, SkipForward, Undo2, X } from 'lucide-react';
import {
  advance,
  applyWalkthrough,
  buildWalkthrough,
  current,
  pendingCount,
  type WalkthroughEntry,
  type WalkthroughState,
} from '@/core/agents/walkthrough';
import { diffAgainst, head } from '@/core/git/repo';
import { useFiles } from '@/stores/files';
import { DiffViewer } from '@/components/editor/DiffViewer';

export interface WalkthroughPanelProps {
  onMessage?(message: string, kind?: 'info' | 'error' | 'success'): void;
  onClose?(): void;
}

export function WalkthroughPanel({ onMessage, onClose }: WalkthroughPanelProps) {
  const [state, setState] = useState<WalkthroughState | null>(null);
  const [busy, setBusy] = useState(false);

  const fileCount = useFiles((s) => s.flatPaths.length);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const base = await head();
        const changes = await diffAgainst(base);
        if (changes.length === 0) {
          setState(null);
          return;
        }
        setState({ ...buildWalkthrough(changes), base });
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fileCount]);

  const entry = useMemo(() => (state ? current(state) : null), [state]);
  const pending = state ? pendingCount(state) : 0;

  const finish = useCallback(async () => {
    if (!state) return;
    setBusy(true);
    try {
      const result = await applyWalkthrough(state);
      await useFiles.getState().refresh();
      onMessage?.(
        `${result.applied.length} aceito(s), ${result.reverted.length} revertido(s)`,
        'success',
      );
      setState(null);
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }, [onMessage, state]);

  if (!state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ListChecks className="h-6 w-6 text-muted-foreground/40" />
        <p className="text-[11px] text-muted-foreground">
          Nada para revisar. Altere um arquivo ou peça algo ao agente.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card/40 px-2 py-1.5">
        <ListChecks className="h-3.5 w-3.5 text-arc" />
        <span className="text-[11px] font-medium">Revisar mudancas</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {state.cursor + 1}/{state.entries.length}
        </span>
        {pending > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{pending} pendente(s)</span>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Fechar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1">
        {state.entries.map((e) => (
          <button
            key={e.index}
            type="button"
            onClick={() => setState({ ...state, cursor: e.index })}
            title={e.path}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              e.index === state.cursor
                ? 'bg-arc'
                : e.decision === 'accepted'
                  ? 'bg-emerald-500'
                  : e.decision === 'reverted'
                    ? 'bg-destructive'
                    : 'bg-muted'
            }`}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {entry ? <EntryCard entry={entry} /> : <p className="p-4 text-center text-[11px] text-muted-foreground">Fim</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-2 py-1.5">
        <button
          type="button"
          onClick={() => setState(advance(state, 'prev'))}
          disabled={state.cursor === 0}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          title="Anterior"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setState(advance(state, 'undo'))}
          disabled={!entry || entry.decision === 'pending'}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          title="Desfazer decisao"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setState(advance(state, 'revert'))}
          disabled={!entry}
          className="flex items-center gap-1 rounded bg-destructive/70 px-2 py-1 text-[11px] text-white disabled:opacity-40"
        >
          <X className="h-3 w-3" />
          reverter
        </button>
        <button
          type="button"
          onClick={() => setState(advance(state, 'skip'))}
          disabled={!entry}
          className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/70 disabled:opacity-40"
        >
          <SkipForward className="h-3 w-3" />
          pular
        </button>
        <button
          type="button"
          onClick={() => setState(advance(state, 'accept'))}
          disabled={!entry}
          className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] text-white disabled:opacity-40"
        >
          <Check className="h-3 w-3" />
          aceitar
        </button>

        {pending === 0 && (
          <button
            type="button"
            onClick={() => void finish()}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded bg-arc px-2 py-1 text-[11px] text-white disabled:opacity-40"
          >
            aplicar
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function EntryCard({ entry }: { entry: WalkthroughEntry }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="font-mono text-[11px]">{entry.path}</span>
        <span
          className={`rounded px-1 py-0.5 text-[9px] ${
            entry.kind === 'add'
              ? 'bg-emerald-500/15 text-emerald-400'
              : entry.kind === 'delete'
                ? 'bg-destructive/15 text-destructive'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          {entry.kind}
        </span>
        {entry.decision !== 'pending' && (
          <span
            className={`rounded px-1 py-0.5 text-[9px] ${
              entry.decision === 'accepted'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-destructive/15 text-destructive'
            }`}
          >
            {entry.decision}
          </span>
        )}
      </div>
      <DiffViewer path={entry.path} before={entry.before ?? ''} after={entry.after ?? ''} compact />
    </div>
  );
}
