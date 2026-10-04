'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, CircleDot, History, RotateCcw, XCircle } from 'lucide-react';
import { restoreCheckpoint } from '@/core/agents/checkpoint-store';
import { loadRules } from '@/core/agents/rules';
import { diffAgainstCheckpoint, type Checkpoint } from '@/core/agents/fast-apply';
import { progressOf, type Task } from '@/core/agents/tasks';
import { vfs } from '@/core/vfs/vfs';
import { formatCost, formatTokens } from '@/lib/tokens';
import { useFiles } from '@/stores/files';

export interface SessionPanelProps {
  tasks: Task[];
  checkpoints: Checkpoint[];
  tokensUsed: number;
  costUsd: number;
  budgetUsd: number;
  onRestore?(label: string): void;
}

export function SessionPanel({ tasks, checkpoints, tokensUsed, costUsd, budgetUsd, onRestore }: SessionPanelProps) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const [rules, setRules] = useState<Array<{ path: string; bytes: number }>>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const docs = await loadRules((p) => vfs().readText(p), '');
      if (!cancelled) setRules(docs.map((d) => ({ path: d.path, bytes: d.bytes })));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rewind = useCallback(
    async (cp: Checkpoint) => {
      if (!window.confirm(`Voltar ao checkpoint "${cp.label}"? Arquivos alterados depois serao sobrescritos.`)) return;
      setRestoring(cp.id);
      try {
        const current = (await vfs().listFiles()).map((f) => ({ path: f.path, content: f.content, hash: f.hash }));
        const impact = diffAgainstCheckpoint(cp, current);
        await restoreCheckpoint(cp, async (path, content) => {
          if (content === null) await vfs().delete(path, { reason: 'rewind' });
          else await vfs().writeText(path, content, { origin: 'external', reason: 'rewind' });
        });
        await useFiles.getState().refresh();
        for (const path of impact.changed) await useFiles.getState().openFile(path);
        onRestore?.(`rewind: ${impact.changed.length} alterado(s), ${impact.added.length} criado(s), ${impact.removed.length} removido(s)`);
      } finally {
        setRestoring(null);
      }
    },
    [onRestore],
  );

  const progress = progressOf(tasks);
  const overBudget = budgetUsd > 0 && costUsd >= budgetUsd;
  const nearBudget = budgetUsd > 0 && costUsd >= budgetUsd * 0.8;

  return (
    <div className="scrollbar-thin h-full overflow-auto p-3">
      <section className="mb-4">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
          <CircleDot className="h-4 w-4 text-arc" />
          Sessao
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="tokens" value={formatTokens(tokensUsed)} />
          <Stat
            label="custo"
            value={formatCost(costUsd)}
            tone={overBudget ? 'error' : nearBudget ? 'warn' : 'default'}
          />
        </div>
        {budgetUsd > 0 && (
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
              <span>orcamento</span>
              <span className={overBudget ? 'text-destructive' : nearBudget ? 'text-yellow-400' : ''}>
                {formatCost(costUsd)} / {formatCost(budgetUsd)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all ${overBudget ? 'bg-destructive' : nearBudget ? 'bg-yellow-400' : 'bg-arc'}`}
                style={{ width: `${Math.min(100, budgetUsd > 0 ? (costUsd / budgetUsd) * 100 : 0)}%` }}
              />
            </div>
            {overBudget && (
              <p className="mt-1 text-[10px] text-destructive">
                Orcamento estourado. O agente para no proximo passo.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="mb-4">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
          <CheckCircle2 className="h-4 w-4 text-arc" />
          Tarefas
          {tasks.length > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {progress.done}/{progress.total}
            </span>
          )}
        </h3>
        {tasks.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhuma tarefa ainda. Peça um plano ao agente no modo Planejador.
          </p>
        ) : (
          <>
            <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
            <ul className="space-y-0.5">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-start gap-1.5 text-[12px]">
                  <TaskIcon status={task.status} />
                  <span
                    className={
                      task.status === 'done'
                        ? 'text-muted-foreground line-through'
                        : task.status === 'cancelled'
                          ? 'text-muted-foreground/50 line-through'
                          : task.status === 'in_progress'
                            ? 'text-arc-fg'
                            : 'text-foreground'
                    }
                  >
                    {task.text}
                  </span>
                  {task.targetPath && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                      {task.targetPath.split('/').pop()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="mb-4">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
          <History className="h-4 w-4 text-arc" />
          Checkpoints
          {checkpoints.length > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {checkpoints.length}
            </span>
          )}
        </h3>
        {checkpoints.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhum checkpoint ainda. Ative "checkpoints" nas configuracoes para poder voltar o agente.
          </p>
        ) : (
          <ul className="space-y-1">
            {checkpoints
              .slice()
              .reverse()
              .map((cp) => (
                <li key={cp.id} className="rounded border border-border bg-card/40">
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === cp.id ? null : cp.id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{cp.seq}</span>
                      <span className="truncate text-[11px]">{cp.label}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => rewind(cp)}
                      disabled={restoring === cp.id}
                      title="Voltar o projeto para este ponto"
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-arc/20 hover:text-arc disabled:opacity-40"
                    >
                      <RotateCcw className={`h-3 w-3 ${restoring === cp.id ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  {expanded === cp.id && (
                    <p className="border-t border-border px-2 py-1 font-mono text-[10px] text-muted-foreground">
                      {new Date(cp.createdAt).toLocaleTimeString('pt-BR')} · {cp.files.length} arquivos ·{' '}
                      {formatTokens(cp.tokensAtCheckpoint)} tokens
                    </p>
                  )}
                </li>
              ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-sm font-semibold">Regras do projeto</h3>
        {rules.length === 0 ? (
          <div className="rounded border border-dashed border-border p-2.5 text-[11px] text-muted-foreground">
            Nenhum arquivo de regras. Crie <code className="font-mono text-arc">AGENTS.md</code> na raiz para ditar
            convencoes ao agente.
          </div>
        ) : (
          <ul className="space-y-1">
            {rules.map((rule) => (
              <li key={rule.path} className="flex items-center gap-2 rounded border border-border bg-card/40 px-2 py-1 text-[11px]">
                <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                <span className="font-mono">{rule.path}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{rule.bytes} B</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TaskIcon({ status }: { status: Task['status'] }) {
  if (status === 'done') return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  if (status === 'cancelled') return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
  if (status === 'in_progress') return <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-arc" />;
  return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'default' | 'warn' | 'error' }) {
  return (
    <div className="rounded border border-border bg-card/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`font-mono text-sm ${
          tone === 'error' ? 'text-destructive' : tone === 'warn' ? 'text-yellow-400' : 'text-foreground'
        }`}
      >
        {value}
      </div>
    </div>
  );
}