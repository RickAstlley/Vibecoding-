'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, FileDiff, FilePlus2, GitBranch, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import {
  checkout,
  commit as gitCommit,
  diffAgainst,
  head,
  initialsOf,
  listCommits,
  type Commit,
  type StagedChange,
} from '@/core/git/repo';
import { vfs } from '@/core/vfs/vfs';
import { useFiles } from '@/stores/files';
import { DiffViewer } from '@/components/editor/DiffViewer';

const KIND_ICON = {
  add: FilePlus2,
  modify: Pencil,
  delete: Trash2,
  rename: FileDiff,
} as const;

const KIND_COLOR = {
  add: 'text-emerald-400',
  modify: 'text-yellow-400',
  delete: 'text-red-400',
  rename: 'text-sky-400',
} as const;

export interface GitPanelProps {
  onMessage?(message: string, kind?: 'info' | 'error' | 'success'): void;
}

export function GitPanel({ onMessage }: GitPanelProps) {
  const [changes, setChanges] = useState<StagedChange[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [current, setCurrent] = useState<Commit | null>(null);
  const [staged, setStaged] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const h = await head();
    const diff = await diffAgainst(h);
    setCurrent(h);
    setChanges(diff);
    setCommits(await listCommits(40));
  }, []);

  const fileCount = useFiles((s) => s.flatPaths.length);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh, fileCount]);

  const doCommit = useCallback(async () => {
    const text = message.trim();
    if (!text || staged.size === 0) return;
    setBusy(true);
    try {
      const result = await gitCommit(text, 'arcanum', [...staged]);
      if (result.commit) {
        setMessage('');
        setStaged(new Set());
        await refresh();
        const skipped = result.skipped.length;
        onMessage?.(
          skipped > 0 ? `Commit criado. ${skipped} arquivo(s) ficaram de fora.` : `Commit ${result.commit.hash.slice(0, 7)} criado`,
          'success',
        );
      }
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }, [message, onMessage, refresh, staged]);

  const doCheckout = useCallback(
    async (c: Commit) => {
      if (!window.confirm(`Voltar o projeto para "${c.message}"? Arquivos alterados depois serao sobrescritos.`)) return;
      setBusy(true);
      try {
        const r = await checkout(c.id, async (path, content) => {
          if (content === null) await vfs().delete(path, { reason: 'git checkout' });
          else await vfs().writeText(path, content, { origin: 'external', reason: 'git checkout' });
        });
        await useFiles.getState().refresh();
        await refresh();
        onMessage?.(`Restaurado: ${r.restored} arquivo(s), ${r.removed} removido(s)`, 'success');
      } catch (e) {
        onMessage?.(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        setBusy(false);
      }
    },
    [onMessage, refresh],
  );

  const stageAll = useCallback(() => {
    setStaged(new Set(changes.map((c) => c.path)));
  }, [changes]);

  const unstageAll = useCallback(() => {
    setStaged(new Set());
  }, []);

  const dirty = changes.length > 0;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card/40 px-2 py-1.5">
        <GitBranch className="h-3.5 w-3.5 text-arc" />
        <span className="text-[11px] font-medium">Controle de versao</span>
        {current && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {current.hash.slice(0, 7)}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {dirty ? `${changes.length} alterado(s)` : 'limpo'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <section className="border-b border-border">
          <div className="flex items-center gap-1 px-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Alteracoes
            </span>
            <span className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={stageAll}
                disabled={!dirty}
                className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                stage all
              </button>
              <button
                type="button"
                onClick={unstageAll}
                disabled={staged.size === 0}
                className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                unstage all
              </button>
            </span>
          </div>

          {!dirty ? (
            <p className="px-2 pb-2 text-[11px] text-muted-foreground">
              Nada alterado desde o ultimo commit.
            </p>
          ) : (
            <ul className="pb-1">
              {changes.map((change) => {
                const Icon = KIND_ICON[change.kind];
                const isOpen = open === change.path;
                const isStaged = staged.has(change.path);
                return (
                  <li key={change.path} className="border-t border-border/40">
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <input
                        type="checkbox"
                        checked={isStaged}
                        onChange={() =>
                          setStaged((prev) => {
                            const next = new Set(prev);
                            if (next.has(change.path)) next.delete(change.path);
                            else next.add(change.path);
                            return next;
                          })
                        }
                        className="h-3 w-3 shrink-0 accent-[hsl(var(--arc))]"
                      />
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : change.path)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      >
                        <Icon className={`h-3 w-3 shrink-0 ${KIND_COLOR[change.kind]}`} />
                        <span className="truncate font-mono text-[11px]">{change.path}</span>
                      </button>
                      <span className="shrink-0 font-mono text-[10px]">
                        <span className="text-emerald-400">+{change.added}</span>{' '}
                        <span className="text-red-400">-{change.removed}</span>
                      </span>
                    </div>
                    {isOpen && (
                      <div className="px-2 pb-2">
                        <DiffViewer
                          path={change.path}
                          before={change.before?.content ?? ''}
                          after={change.after?.content ?? ''}
                          compact
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && message.trim() && staged.size > 0) void doCommit();
              }}
              placeholder={staged.size > 0 ? `Commit ${staged.size} arquivo(s)` : 'Stage algo primeiro'}
              disabled={staged.size === 0}
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-arc/60 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void doCommit()}
              disabled={busy || !message.trim() || staged.size === 0}
              className="rounded bg-arc px-2 py-1 text-[11px] text-white disabled:opacity-40"
            >
              <span className="flex items-center gap-1">
                <Check className="h-3 w-3" />
                commitar
              </span>
            </button>
          </div>
        </section>

        <section>
          <div className="px-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Historico</span>
          </div>
          {commits.length === 0 ? (
            <p className="px-2 pb-2 text-[11px] text-muted-foreground">
              Nenhum commit ainda. Stage algo e faca o primeiro commit.
            </p>
          ) : (
            <ul>
              {commits.map((c) => (
                <li key={c.id} className="group flex items-start gap-1.5 border-t border-border/40 px-2 py-1.5">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-arc/25 text-[8px] font-semibold text-arc-fg">
                    {initialsOf(c.author)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px]">{c.message}</p>
                    <p className="font-mono text-[9px] text-muted-foreground">
                      {c.hash.slice(0, 7)} · {new Date(c.createdAt).toLocaleString('pt-BR')} · {c.files.length} arquivo(s)
                    </p>
                  </div>
                  {c.id !== current?.id && (
                    <button
                      type="button"
                      onClick={() => void doCheckout(c)}
                      disabled={busy}
                      title="Restaurar este estado"
                      className="mt-0.5 rounded p-1 text-muted-foreground opacity-0 transition-colors hover:bg-arc/20 hover:text-arc disabled:opacity-40 group-hover:opacity-100"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
