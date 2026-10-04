'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ListTree, MessageCircleQuestion, Play, X } from 'lucide-react';
import { planProgress, type CascadePlan, type PlanStep } from '@/core/agents/cascade';

export interface CascadePanelProps {
  plan: CascadePlan | null;
  onApprove?(): void;
  onReject?(reason?: string): void;
  onRunStep?(stepId: string): void;
}

export function CascadePanel({ plan, onApprove, onReject, onRunStep }: CascadePanelProps) {
  const [busy, setBusy] = useState(false);
  const progress = useMemo(() => planProgress(plan?.steps ?? []), [plan]);

  if (!plan || plan.steps.length === 0) return null;

  const canRun = plan.status === 'approved' || plan.status === 'executing';

  return (
    <div className="overflow-hidden rounded-md border border-arc/30 bg-arc/5">
      <div className="flex items-center gap-1.5 border-b border-arc/20 px-2 py-1.5">
        <ListTree className="h-3.5 w-3.5 text-arc" />
        <span className="text-[11px] font-medium">Plano</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {progress.done}/{progress.total}
        </span>
        <StatusChip status={plan.status} />
        <div className="ml-auto flex gap-1">
          {plan.status === 'draft' && (
            <>
              <button
                type="button"
                onClick={() => onApprove?.()}
                className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500"
              >
                <Play className="h-2.5 w-2.5" />
                aprovar
              </button>
              <button
                type="button"
                onClick={() => onReject?.()}
                className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/70"
              >
                <X className="h-2.5 w-2.5" />
                rejeitar
              </button>
            </>
          )}
        </div>
      </div>

      {progress.total > 0 && (
        <div className="h-0.5 bg-muted">
          <div className="h-full bg-arc transition-all" style={{ width: `${progress.percent}%` }} />
        </div>
      )}

      <ol className="divide-y divide-border/40">
        {plan.steps.map((step) => (
          <li key={step.id} className="px-2 py-1.5">
            <div className="flex items-start gap-1.5">
              <StepBadge status={step.status} order={step.order} />
              <div className="min-w-0 flex-1">
                <p className={`text-[11px] ${step.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {step.text}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {step.targetPath && (
                    <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">
                      {step.targetPath}
                    </span>
                  )}
                  {step.tokens > 0 && (
                    <span className="font-mono text-[9px] text-muted-foreground">{step.tokens} tokens</span>
                  )}
                  {step.outcome && step.status === 'skipped' && (
                    <span className="text-[9px] text-muted-foreground">{step.outcome}</span>
                  )}
                </div>
              </div>
              {canRun && step.status === 'pending' && onRunStep && (
                <button
                  type="button"
                  onClick={() => {
                    setBusy(true);
                    onRunStep(step.id);
                  }}
                  disabled={busy}
                  title="Executar so este passo"
                  className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-arc/20 hover:text-arc disabled:opacity-40"
                >
                  <Play className="h-3 w-3" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      {plan.questions.length > 0 && (
        <div className="border-t border-arc/20 px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-amber-400">
            <MessageCircleQuestion className="h-3 w-3" />
            o agente precisa saber
          </div>
          <ul className="space-y-0.5">
            {plan.questions.map((q, i) => (
              <li key={i} className="text-[10px] text-muted-foreground">
                · {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.risks.length > 0 && (
        <div className="border-t border-arc/20 px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-yellow-400">
            <AlertTriangle className="h-3 w-3" />
            riscos
          </div>
          <ul className="space-y-0.5">
            {plan.risks.map((r, i) => (
              <li key={i} className="text-[10px] text-muted-foreground">
                · {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StepBadge({ status, order }: { status: PlanStep['status']; order: number }) {
  if (status === 'done') {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
        <Check className="h-2.5 w-2.5" />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-arc/30 text-[8px] font-semibold text-arc-fg">
        {order}
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] text-muted-foreground">
        {order}
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-border text-[8px] text-muted-foreground">
      {order}
    </span>
  );
}

function StatusChip({ status }: { status: CascadePlan['status'] }) {
  const map: Record<CascadePlan['status'], { label: string; className: string }> = {
    draft: { label: 'aguardando', className: 'bg-muted text-muted-foreground' },
    approved: { label: 'aprovado', className: 'bg-emerald-500/15 text-emerald-400' },
    executing: { label: 'executando', className: 'bg-arc/20 text-arc-fg' },
    rejected: { label: 'rejeitado', className: 'bg-destructive/15 text-destructive' },
    done: { label: 'concluido', className: 'bg-emerald-500/15 text-emerald-400' },
  };
  const chip = map[status];
  return <span className={`rounded px-1.5 py-0.5 text-[9px] ${chip.className}`}>{chip.label}</span>;
}