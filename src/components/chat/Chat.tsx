'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  Square,
  Sparkles,
  Gauge,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Wrench,
  Brain,
  Terminal,
  AlertTriangle,
} from 'lucide-react';
import { MODES, type AgentMode } from '@/core/agents/modes';
import { DiffViewer } from '@/components/editor/DiffViewer';
import { formatCost, formatTokens, savingsPercent } from '@/lib/tokens';
import type { ChatMessage } from '@/stores/ui';

export interface RunProgress {
  running: boolean;
  step: number;
  maxSteps: number;
  tokensUsed: number;
  status: string;
}

export interface ChatProps {
  messages: ChatMessage[];
  draft: string;
  mode: AgentMode;
  running: boolean;
  progress: RunProgress;
  compressionEnabled: boolean;
  savedPercent: number;
  approval: { path: string; reason: string; resolve(ok: boolean): void } | null;
  canSend: boolean;
  onDraft(v: string): void;
  onMode(m: AgentMode): void;
  onSend(): void;
  onStop(): void;
  onToggleCompression(): void;
  onRevertPatch(path: string): void;
  onPatchAccept(path: string): void;
}

export function Chat({
  messages,
  draft,
  mode,
  running,
  progress,
  compressionEnabled,
  savedPercent,
  approval,
  canSend,
  onDraft,
  onMode,
  onSend,
  onStop,
  onToggleCompression,
  onRevertPatch,
  onPatchAccept,
}: ChatProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const [openReports, setOpenReports] = useState<Record<string, boolean>>({});

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const spec = MODES[mode];
  const Icon = useMemo(() => (spec.icon === '◇' ? Brain : spec.icon === '!' ? AlertTriangle : Wrench), [spec.icon]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setModeOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-2 py-1 text-xs transition-colors hover:border-arc/60"
          >
            <Icon className="h-3.5 w-3.5 text-arc" />
            <span className="font-medium">{spec.label}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
          {modeOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-xl">
              {(Object.keys(MODES) as AgentMode[]).map((id) => {
                const m = MODES[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      onMode(id);
                      setModeOpen(false);
                    }}
                    className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted ${
                      id === mode ? 'bg-arc/15' : ''
                    }`}
                  >
                    <span className="mt-0.5 font-mono text-xs text-arc">{m.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">{m.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{m.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleCompression}
          title={compressionEnabled ? 'Compressao de prompt ativa' : 'Compressao de prompt desativada'}
          className={`ml-auto flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
            compressionEnabled
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          <Gauge className="h-3.5 w-3.5" />
          compressao
          {compressionEnabled && savedPercent > 0 && (
            <span className="rounded bg-emerald-500/20 px-1 font-mono">-{savedPercent}%</span>
          )}
        </button>
      </div>

      <div ref={scroller} className="scrollbar-thin flex-1 overflow-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Sparkles className="h-7 w-7 text-arc/60" />
            <p className="max-w-xs text-sm text-muted-foreground">
              Importe um ZIP ou descreva o que quer construir. O agente edita um arquivo por vez e nunca toca no resto.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBlock
            key={msg.id}
            msg={msg}
            onRevert={onRevertPatch}
            onAccept={onPatchAccept}
            expanded={Boolean(openReports[msg.id])}
            onToggleReports={() => setOpenReports((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
          />
        ))}

        {approval && (
          <div className="mt-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-yellow-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Aprovacao necessaria
            </div>
            <p className="mb-2 font-mono text-[11px] text-muted-foreground">{approval.path}</p>
            <p className="mb-2 text-[11px] text-muted-foreground">{approval.reason}</p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => approval.resolve(true)}
                className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] text-white hover:bg-emerald-500"
              >
                <Check className="h-3 w-3" /> aprovar
              </button>
              <button
                type="button"
                onClick={() => approval.resolve(false)}
                className="flex items-center gap-1 rounded bg-destructive px-2 py-1 text-[11px] text-white hover:bg-destructive/90"
              >
                <X className="h-3 w-3" /> rejeitar
              </button>
            </div>
          </div>
        )}
      </div>

      {running && (
        <div className="flex items-center gap-2 border-t border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-arc opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-arc" />
            </span>
            executando
          </span>
          <span className="font-mono">
            passo {progress.step}/{progress.maxSteps}
          </span>
          <span className="font-mono">{formatTokens(progress.tokensUsed)} tokens</span>
          <span className="ml-auto truncate">{progress.status}</span>
        </div>
      )}

      <div className="border-t border-border p-2">
        <textarea
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (canSend && !running) onSend();
            }
          }}
          rows={3}
          placeholder={canSend ? 'Descreva a tarefa... (Ctrl+Enter envia)' : 'Configure uma chave de API em Configuracoes'}
          className="w-full resize-none rounded-md border border-border bg-card/50 p-2 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-arc/60"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{spec.description}</span>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              className="ml-auto flex items-center gap-1 rounded bg-destructive px-2.5 py-1 text-xs text-white hover:bg-destructive/90"
            >
              <Square className="h-3 w-3" /> parar
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend || !draft.trim()}
              className="ml-auto flex items-center gap-1 rounded bg-arc px-2.5 py-1 text-xs text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-3 w-3" /> enviar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBlock({
  msg,
  expanded,
  onRevert,
  onAccept,
  onToggleReports,
}: {
  msg: ChatMessage;
  expanded: boolean;
  onRevert(path: string): void;
  onAccept(path: string): void;
  onToggleReports(): void;
}) {
  const showReports = expanded;
  const isUser = msg.role === 'user';
  const isTool = msg.role === 'tool';

  return (
    <div className={`mb-3 ${isUser ? 'flex justify-end' : ''}`}>
      <div className={`max-w-full ${isUser ? 'max-w-[85%]' : ''}`}>
        {!isUser && !isTool && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {msg.streaming ? <Terminal className="h-3 w-3 animate-pulse text-arc" /> : <Sparkles className="h-3 w-3 text-arc" />}
            arcanum
            {msg.savedPercent !== undefined && msg.savedPercent > 0 && (
              <span className="rounded bg-emerald-500/15 px-1 font-mono normal-case text-emerald-400">-{msg.savedPercent}% tokens</span>
            )}
          </div>
        )}

        <div
          className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
            isUser
              ? 'bg-arc/20 text-arc-fg'
              : isTool
                ? 'border border-border bg-muted/30 font-mono text-[11px] text-muted-foreground'
                : 'bg-card/60 text-foreground'
          } ${msg.error ? 'border border-destructive/40' : ''}`}
        >
          {msg.content || (msg.streaming ? '...' : '')}
        </div>

        {msg.patch && (
          <div className="mt-2">
            <DiffViewer
              path={msg.patch.path}
              before={msg.patch.before}
              after={msg.patch.after}
              highlightLines={msg.patch.changedLines}
              compact
            />
            <div className="mt-1 flex gap-1.5">
              <button
                type="button"
                onClick={() => onAccept(msg.patch!.path)}
                className="flex items-center gap-1 rounded bg-emerald-600/80 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-600"
              >
                <Check className="h-2.5 w-2.5" /> manter
              </button>
              <button
                type="button"
                onClick={() => onRevert(msg.patch!.path)}
                className="flex items-center gap-1 rounded bg-destructive/70 px-2 py-0.5 text-[10px] text-white hover:bg-destructive"
              >
                <X className="h-2.5 w-2.5" /> reverter arquivo
              </button>
            </div>
          </div>
        )}

        {msg.reports && msg.reports.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={onToggleReports}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {showReports ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              contexto: {msg.reports.length} arquivo(s)
              {msg.reports.filter((r) => r.compressed).length > 0 && (
                <span className="ml-1 text-emerald-400">{msg.reports.filter((r) => r.compressed).length} comprimidos</span>
              )}
            </button>
            {showReports && (
              <div className="mt-1 overflow-hidden rounded border border-border">
                <table className="w-full text-[10px]">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-1.5 py-1 text-left">arquivo</th>
                      <th className="px-1.5 py-1 text-right">antes</th>
                      <th className="px-1.5 py-1 text-right">enviado</th>
                      <th className="px-1.5 py-1 text-right">economia</th>
                      <th className="px-1.5 py-1 text-left">nivel</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {msg.reports.map((r) => (
                      <tr key={r.path} className="border-t border-border/50">
                        <td className="max-w-[180px] truncate px-1.5 py-0.5">{r.path}</td>
                        <td className="px-1.5 py-0.5 text-right text-muted-foreground">{formatTokens(r.tokensRaw)}</td>
                        <td className="px-1.5 py-0.5 text-right">{r.tokensSent ? formatTokens(r.tokensSent) : '-'}</td>
                        <td className="px-1.5 py-0.5 text-right text-emerald-400">
                          {r.tokensRaw > 0 && r.tokensSent > 0 ? `${savingsPercent(r.tokensRaw, r.tokensSent)}%` : '-'}
                        </td>
                        <td className="px-1.5 py-0.5 text-muted-foreground">{r.level}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {(msg.tokensIn !== undefined || msg.cost !== undefined) && (
          <div className="mt-1 flex gap-2 font-mono text-[10px] text-muted-foreground">
            {msg.tokensIn !== undefined && <span>in {formatTokens(msg.tokensIn)}</span>}
            {msg.tokensOut !== undefined && <span>out {formatTokens(msg.tokensOut)}</span>}
            {msg.cost !== undefined && msg.cost > 0 && <span className="text-amber-400">{formatCost(msg.cost)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}