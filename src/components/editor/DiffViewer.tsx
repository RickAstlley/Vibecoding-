'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileDiff, RotateCcw } from 'lucide-react';

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export function computeDiff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      const nextRow = lcs[i + 1] as number[];
      row[j] = a[i] === b[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] as string, oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push({ type: 'del', text: a[i] as string, oldNo: i + 1, newNo: null });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] as string, oldNo: null, newNo: j + 1 });
      j++;
    }
  }
  while (i < a.length) {
    out.push({ type: 'del', text: a[i] as string, oldNo: i + 1, newNo: null });
    i++;
  }
  while (j < b.length) {
    out.push({ type: 'add', text: b[j] as string, oldNo: null, newNo: j + 1 });
    j++;
  }
  return out;
}

const CONTEXT = 3;

export function collapse(diff: DiffLine[]): DiffLine[] {
  const keep = new Set<number>();
  diff.forEach((line, idx) => {
    if (line.type === 'ctx') return;
    for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(diff.length - 1, idx + CONTEXT); k++) {
      keep.add(k);
    }
  });
  const out: DiffLine[] = [];
  let skipping = 0;
  diff.forEach((line, idx) => {
    if (keep.has(idx)) {
      if (skipping > 0) {
        out.push({ type: 'hunk', text: `... ${skipping} linha(s) inalterada(s) ...`, oldNo: null, newNo: null });
        skipping = 0;
      }
      out.push(line);
    } else {
      skipping++;
    }
  });
  if (skipping > 0) {
    out.push({ type: 'hunk', text: `... ${skipping} linha(s) inalterada(s) ...`, oldNo: null, newNo: null });
  }
  return out;
}

export interface DiffViewerProps {
  path: string;
  before: string;
  after: string;
  highlightLines?: number[];
  onRevert?(): void;
  compact?: boolean;
}

export function DiffViewer({ path, before, after, highlightLines, onRevert, compact }: DiffViewerProps) {
  const { rows, added, removed } = useMemo(() => {
    const full = computeDiff(before, after);
    return {
      rows: compact ? collapse(full) : full,
      added: full.filter((r) => r.type === 'add').length,
      removed: full.filter((r) => r.type === 'del').length,
    };
  }, [before, after, compact]);

  const hl = useMemo(() => new Set(highlightLines ?? []), [highlightLines]);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card/40">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs">
        <FileDiff className="h-3.5 w-3.5 text-arc" />
        <span className="font-mono text-muted-foreground">{path}</span>
        <span className="ml-auto flex items-center gap-2 font-mono">
          <span className="text-emerald-500">+{added}</span>
          <span className="text-red-500">-{removed}</span>
        </span>
        {onRevert && (
          <button
            type="button"
            onClick={onRevert}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
            title="Reverter este arquivo inteiro"
          >
            <RotateCcw className="h-3 w-3" />
            reverter
          </button>
        )}
      </div>
      <div className="max-h-80 overflow-auto font-mono text-[12px] leading-relaxed">
        {rows.map((row, idx) => {
          const isHighlighted = row.newNo !== null && hl.has(row.newNo);
          const bg =
            row.type === 'add'
              ? 'bg-emerald-500/10'
              : row.type === 'del'
                ? 'bg-red-500/10'
                : row.type === 'hunk'
                  ? 'bg-muted/40 text-muted-foreground italic'
                  : isHighlighted
                    ? 'bg-arc/20'
                    : '';
          const prefix = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ';
          return (
            <div key={idx} className={`flex ${bg}`}>
              <span className="w-10 shrink-0 select-none border-r border-border/50 px-1.5 text-right text-[10px] text-muted-foreground/70">
                {row.oldNo ?? ''}
              </span>
              <span className="w-10 shrink-0 select-none border-r border-border/50 px-1.5 text-right text-[10px] text-muted-foreground/70">
                {row.newNo ?? ''}
              </span>
              <span className="w-4 shrink-0 select-none text-center text-muted-foreground/60">{prefix}</span>
              <span className="flex-1 whitespace-pre-wrap break-words pl-1">{row.text || ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DiffTree({ items }: { items: Array<{ path: string; before: string; after: string; level: string; changedLines: number[] }> }) {
  const [open, setOpen] = useState<string[]>(items.map((i) => i.path));
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const isOpen = open.includes(item.path);
        return (
          <div key={item.path}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? open.filter((p) => p !== item.path) : [...open, item.path])}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted"
            >
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span className="font-mono text-muted-foreground">{item.path}</span>
              <span className="ml-auto rounded bg-arc/20 px-1.5 py-0.5 text-[10px] text-arc-fg">{item.level}</span>
            </button>
            {isOpen && (
              <div className="ml-3">
                <DiffViewer path={item.path} before={item.before} after={item.after} highlightLines={item.changedLines} compact />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}