'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Key, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { audit, mask, parseEnv, serializeEnv, type SecretEntry } from '@/core/secrets/env';
import { vfs } from '@/core/vfs/vfs';
import { useFiles } from '@/stores/files';

const ENV_PATHS = ['.env', '.env.local', '.env.example'];

export interface SecretsPanelProps {
  onMessage?(message: string, kind?: 'info' | 'error' | 'success'): void;
}

export function SecretsPanel({ onMessage }: SecretsPanelProps) {
  const [path, setPath] = useState('.env');
  const [entries, setEntries] = useState<SecretEntry[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [exists, setExists] = useState(false);

  const fileCount = useFiles((s) => s.flatPaths.length);

  const load = useCallback(async (target: string) => {
    const content = await vfs().readText(target);
    setExists(content !== null);
    if (!content) {
      setEntries([]);
      return;
    }
    setEntries(parseEnv(content).entries);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(path), 0);
    return () => window.clearTimeout(timer);
  }, [path, load, fileCount]);

  const report = useMemo(() => audit(entries), [entries]);

  const update = (key: string, value: string): void => {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, value } : e)));
    setDirty(true);
  };

  const remove = (key: string): void => {
    setEntries((prev) => prev.filter((e) => e.key !== key));
    setDirty(true);
  };

  const add = (): void => {
    let name = 'NOVA_VARIAVEL';
    let i = 1;
    while (entries.some((e) => e.key === name)) name = `NOVA_VARIAVEL_${i++}`;
    setEntries((prev) => [...prev, { key: name, value: '', kind: 'public' }]);
    setDirty(true);
  };

  const save = async (): Promise<void> => {
    try {
      await vfs().writeText(path, serializeEnv(entries), { origin: 'user', reason: 'editar .env' });
      setDirty(false);
      setExists(true);
      await useFiles.getState().refresh();
      onMessage?.(`${path} salvo`, 'success');
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const toggleReveal = (key: string): void => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card/40 px-2 py-1.5">
        <Key className="h-3.5 w-3.5 text-arc" />
        <span className="text-[11px] font-medium">Segredos</span>
        <div className="ml-auto flex gap-0.5">
          {ENV_PATHS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPath(p)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                path === p ? 'bg-arc/20 text-arc-fg' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-[10px]">
        <ShieldCheck className="h-3 w-3 text-emerald-400" />
        <span className="text-muted-foreground">
          {report.total} variavel(is) · {report.secret} segredo(s) mascarado(s)
        </span>
        {report.suspicious.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-yellow-400">
            <AlertTriangle className="h-3 w-3" />
            {report.suspicious.length} suspeita(s)
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
            <Key className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">
              {exists ? 'Arquivo vazio.' : `${path} nao existe ainda.`}
            </p>
            <button
              type="button"
              onClick={add}
              className="rounded bg-arc px-2 py-1 text-[11px] text-white"
            >
              Adicionar variavel
            </button>
          </div>
        ) : (
          <ul>
            {entries.map((entry) => {
              const isRevealed = revealed.has(entry.key);
              const flagged = report.suspicious.find((s) => s.key === entry.key);
              return (
                <li key={entry.key} className="border-b border-border/40 px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      value={entry.key}
                      onChange={(e) => {
                        const key = e.target.value;
                        setEntries((prev) => prev.map((x) => (x.key === entry.key ? { ...x, key } : x)));
                        setDirty(true);
                      }}
                      className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-arc/60"
                    />
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${
                        entry.kind === 'secret' ? 'bg-amber-500/15 text-amber-400' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {entry.kind}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleReveal(entry.key)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={isRevealed ? 'Ocultar' : 'Mostrar'}
                    >
                      {isRevealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(entry.key)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                      title="Remover"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <input
                    value={isRevealed ? entry.value : mask(entry.value)}
                    onChange={(e) => update(entry.key, e.target.value)}
                    readOnly={!isRevealed}
                    placeholder="valor"
                    className={`mt-1 w-full rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-arc/60 ${
                      flagged ? 'border-yellow-500/50' : 'border-border'
                    } ${isRevealed ? '' : 'text-muted-foreground'}`}
                  />
                  {flagged && (
                    <p className="mt-0.5 text-[9px] text-yellow-400">{entry.key}: {flagged.reason}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-2 py-1.5">
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          variavel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty}
          className="ml-auto flex items-center gap-1 rounded bg-arc px-2 py-1 text-[11px] text-white disabled:opacity-40"
        >
          <Save className="h-3 w-3" />
          salvar
        </button>
      </div>
    </div>
  );
}