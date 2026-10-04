'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Info, Package, Rocket, TriangleAlert } from 'lucide-react';
import {
  DEPLOY_PLANS,
  buildDeployArtifact,
  commitBeforeDeploy,
  downloadArtifact,
  formatBytes,
  previewDeploy,
  type DeployArtifact,
  type DeployPreview,
} from '@/core/deploy/artifact';
import { useFiles } from '@/stores/files';

export interface DeployPanelProps {
  projectName: string;
  bundlerEnabled: boolean;
  onMessage?(message: string, kind?: 'info' | 'error' | 'success'): void;
}

export function DeployPanel({ projectName, bundlerEnabled, onMessage }: DeployPanelProps) {
  const [preview, setPreview] = useState<DeployPreview | null>(null);
  const [artifact, setArtifact] = useState<DeployArtifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(DEPLOY_PLANS[0]!.target);

  const fileCount = useFiles((s) => s.flatPaths.length);

  useEffect(() => {
    const timer = window.setTimeout(() => void previewDeploy().then(setPreview), 0);
    return () => window.clearTimeout(timer);
  }, [fileCount]);

  const build = useCallback(async () => {
    setBusy(true);
    try {
      const built = await buildDeployArtifact({ transformEntry: bundlerEnabled });
      setArtifact(built);
      if (built.warnings.length > 0) {
        for (const w of built.warnings) onMessage?.(w, 'info');
      } else {
        onMessage?.(`Pacote pronto: ${built.fileCount} arquivos, ${formatBytes(built.bytes)}`, 'success');
      }
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }, [bundlerEnabled, onMessage]);

  const download = useCallback(async () => {
    const built = artifact ?? (await buildDeployArtifact({ transformEntry: bundlerEnabled }));
    if (!artifact) setArtifact(built);
    downloadArtifact(built, projectName);
    onMessage?.('ZIP baixado', 'success');
  }, [artifact, bundlerEnabled, onMessage, projectName]);

  const plan = DEPLOY_PLANS.find((p) => p.target === target) ?? DEPLOY_PLANS[0]!;

  return (
    <div className="scrollbar-thin h-full overflow-auto p-3">
      <div className="mb-3">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <Rocket className="h-4 w-4 text-arc" />
          Publicar
        </h3>
        <p className="text-[11px] text-muted-foreground">
          O Arcanum Weaver gera um site estatico. Servidor Node nao e necessario - qualquer
          hospedagem compartilhada serve.
        </p>
      </div>

      <div className="mb-3 space-y-1.5 rounded-lg border border-border bg-card/40 p-2.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Arquivos no projeto</span>
          <span className="font-mono">{preview?.files.length ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Serão publicados</span>
          <span className="font-mono text-emerald-400">{preview?.files.length ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Excluídos de propósito</span>
          <span className="font-mono text-muted-foreground">{preview?.excluded.length ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Tamanho total</span>
          <span className="font-mono">{formatBytes(preview?.totalBytes ?? 0)}</span>
        </div>
      </div>

      <div className="mb-3 flex gap-1.5">
        <button
          type="button"
          onClick={() => void build()}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-arc px-2 py-1.5 text-[11px] text-white disabled:opacity-40"
        >
          <Package className="h-3.5 w-3.5" />
          {busy ? 'gerando...' : 'gerar pacote'}
        </button>
        <button
          type="button"
          onClick={() => void download()}
          className="flex items-center justify-center gap-1.5 rounded bg-emerald-600 px-2 py-1.5 text-[11px] text-white"
        >
          <Download className="h-3.5 w-3.5" />
          baixar .zip
        </button>
      </div>

      {artifact && (
        <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px]">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            pacote pronto
          </div>
          <div className="text-muted-foreground">
            {artifact.fileCount} arquivos · {formatBytes(artifact.bytes)} · entry {artifact.entry}
          </div>
          {artifact.warnings.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {artifact.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1 text-[10px] text-yellow-400">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-1">
        {DEPLOY_PLANS.map((p) => (
          <button
            key={p.target}
            type="button"
            onClick={() => setTarget(p.target)}
            className={`rounded px-2 py-1 text-[10px] transition-colors ${
              target === p.target ? 'bg-arc/20 text-arc-fg' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-2.5">
        <p className="mb-2 text-[11px] text-muted-foreground">{plan.description}</p>
        <ol className="space-y-1">
          {plan.instructions.map((step, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px]">
              <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground">
                {i + 1}
              </span>
              <span className="text-foreground">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-card/40 p-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          Excluídos do pacote
        </div>
        <p className="text-[10px] text-muted-foreground">
          node_modules, arquivos .env e ocultos ficam de fora: quem recebe o bundle estatico nao
          precisa das dependencias de desenvolvimento, e vaza-las seria inseguro.
        </p>
        {preview && preview.excluded.length > 0 && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
              ver {preview.excluded.length} arquivo(s)
            </summary>
            <ul className="mt-1 space-y-0.5">
              {preview.excluded.slice(0, 30).map((f) => (
                <li key={f.path} className="font-mono text-[9px] text-muted-foreground/70">
                  {f.path} — {f.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <button
        type="button"
        onClick={() => void commitBeforeDeploy('antes do deploy').then(() => onMessage?.('Commit de segurança criado', 'success'))}
        className="mt-3 w-full rounded border border-border px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        criar commit de segurança antes de publicar
      </button>
    </div>
  );
}
