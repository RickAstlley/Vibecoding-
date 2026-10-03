'use client';

import { useCallback, useEffect, useState } from 'react';
import { Database, FileSearch, RefreshCw, Scan } from 'lucide-react';
import { ProjectIndex, renderContext, type IndexStats, type SearchHit } from '@/core/rag';
import { vfs } from '@/core/vfs/vfs';
import { useFiles } from '@/stores/files';

export function RagPanel() {
  const [index] = useState(() => new ProjectIndex());
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  const fileCount = useFiles((s) => s.flatPaths.length);

  const rebuild = useCallback(async () => {
    setBusy(true);
    try {
      const files = await vfs().listFiles();
      const withText = files
        .filter((f) => f.content !== null && f.size < 400_000)
        .map((f) => ({ path: f.path, content: f.content as string }));
      setStats(index.build(withText));
    } finally {
      setBusy(false);
    }
  }, [index]);

  useEffect(() => {
    const timer = window.setTimeout(() => void rebuild(), 0);
    return () => window.clearTimeout(timer);
  }, [rebuild, fileCount]);

  const search = useCallback(
    (q: string) => {
      setQuery(q);
      setHits(q.trim() ? index.search(q) : []);
    },
    [index],
  );

  const context = hits.length > 0 ? renderContext(hits) : '';

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card/40 px-2 py-1.5">
        <FileSearch className="h-3.5 w-3.5 text-arc" />
        <span className="text-[11px] font-medium">Busca semantica</span>
        {stats && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {stats.chunks} trechos · {stats.files} arquivos
          </span>
        )}
        <button
          type="button"
          onClick={() => void rebuild()}
          disabled={busy}
          title="Reindexar"
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="shrink-0 border-b border-border p-2">
        <input
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="onde eu trato o login?"
          className="w-full rounded border border-border bg-card/50 px-2 py-1 text-[12px] outline-none focus:border-arc/60"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {hits.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <Database className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">
              A busca divide os arquivos por simbolo e ranqueia por BM25. Funciona offline, sem
              embedding e sem gastar token.
            </p>
          </div>
        ) : (
          <ul>
            {hits.map((hit) => (
              <li key={hit.chunk.id} className="border-b border-border/40 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-arc">{hit.chunk.path}</span>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    :{hit.chunk.startLine}-{hit.chunk.endLine}
                  </span>
                  <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                    {hit.chunk.kind}
                  </span>
                  <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                    {hit.score.toFixed(2)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{hit.chunk.name}</p>
                <p className="mt-1 font-mono text-[10px] leading-relaxed text-foreground/80">{hit.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {context && (
        <div className="shrink-0 border-t border-border bg-card/40 p-2">
          <div className="mb-1 flex items-center gap-1.5">
            <Scan className="h-3 w-3 text-arc" />
            <span className="text-[10px] font-medium">Contexto para o agente</span>
            <span className="ml-auto font-mono text-[9px] text-muted-foreground">
              {context.length} chars
            </span>
          </div>
          <pre className="scrollbar-thin max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[9px] text-muted-foreground">
            {context.slice(0, 400)}
          </pre>
        </div>
      )}
    </div>
  );
}