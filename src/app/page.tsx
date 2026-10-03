'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSearch,
  GitBranch,
  KeyRound,
  ListChecks,
  PanelLeftClose,
  Plug,
  Rocket,
  TerminalIcon,
  PanelLeftOpen,
  MessageSquare,
  Bot,
  Eye,
  Settings as SettingsIcon,
  ChevronRight,
  X,
  Zap,
  Check,
  FileCode2,
} from 'lucide-react';
import { Explorer } from '@/components/explorer/Explorer';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { Preview, type ConsoleEntry, type SmokeState } from '@/components/preview/Preview';
import { Chat } from '@/components/chat/Chat';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { WalkthroughPanel } from '@/components/agents/WalkthroughPanel';
import { DeployPanel } from '@/components/deploy/DeployPanel';
import { McpPanel } from '@/components/mcp/McpPanel';
import { RagPanel } from '@/components/rag/RagPanel';
import { SessionPanel } from '@/components/session/SessionPanel';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { GitPanel } from '@/components/git/GitPanel';
import { approvePlan, parsePlan, rejectPlan } from '@/core/agents/cascade';
import { SecretsPanel } from '@/components/secrets/SecretsPanel';
import { RUNTIME_INSTRUCTIONS, type RuntimeConfig } from '@/core/runtime';
import { mergeTasks, parseTasks, type Task } from '@/core/agents/tasks';
import type { Checkpoint } from '@/core/agents/fast-apply';
import { checkpointStore } from '@/core/agents/checkpoint-store';
import { useFiles } from '@/stores/files';
import { useSettings } from '@/stores/settings';
import { newMessageId, useUi } from '@/stores/ui';
import { vfs } from '@/core/vfs/vfs';
import { detectLanguage } from '@/core/vfs/file';
import { createZip, extractZip, isZipFile } from '@/core/zip/unzip';
import { createRuntime, newRunId } from '@/lib/runtime';
import { createRuntime as createCodeRuntime, type RuntimeToolContext } from '@/core/runtime';
import { AgentRuntime } from '@/core/agents/runtime';
import { contextWindow } from '@/core/ia/providers';
import { costOf, formatCost } from '@/lib/tokens';
import { MODES } from '@/core/agents/modes';
import { tryNormalizePath } from '@/core/vfs/paths';

type SidePanel = 'chat' | 'preview' | 'settings' | 'session' | 'terminal' | 'git' | 'secrets' | 'review' | 'deploy' | 'mcp' | 'rag' | null;

export default function WeaverPage() {
  const files = useFiles();
  const ui = useUi();
  const settings = useSettings();

  const [sidePanel, setSidePanel] = useState<SidePanel>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [progress, setProgress] = useState({ running: false, step: 0, maxSteps: 30, tokensUsed: 0, status: '' });
  const [previewToken, setPreviewToken] = useState(0);
  const [previewAutoReload, setPreviewAutoReload] = useState(true);
  const [previewSmoke, setPreviewSmoke] = useState(true);
  const [smokeResult, setSmokeResult] = useState<SmokeState | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);

  const runtimeRef = useRef<AgentRuntime | null>(null);
  const approvalResolvers = useRef(new Map<string, (ok: boolean) => void>());

  const runtimeConfig: RuntimeConfig = useMemo(
    () => ({
      kind: settings.runtime.kind,
      remote: { baseUrl: settings.runtime.remoteBaseUrl, token: settings.runtime.remoteToken, timeoutMs: settings.runtime.timeoutMs },
      local: { timeoutMs: settings.runtime.timeoutMs },
    }),
    [settings.runtime],
  );

  const runtimeCtx = useMemo<RuntimeToolContext | undefined>(() => {
    if (settings.runtime.kind === 'none') return undefined;
    const adapter = createCodeRuntime(runtimeConfig);
    return {
      exec: async (command, timeoutMs) => {
        const r = await adapter.exec({ command, language: 'auto', ...(timeoutMs ? { timeoutMs } : {}) });
        return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, ...(r.error ? { error: r.error } : {}) };
      },
      install: async () => {
        const r = await adapter.install();
        return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, ...(r.error ? { error: r.error } : {}) };
      },
    };
  }, [runtimeConfig, settings.runtime.kind]);

  const activeContent = files.activePath ? (files.contents[files.activePath] ?? '') : '';
  const activeLanguage = files.activePath ? detectLanguage(files.activePath) : ('text' as const);

  const lastPatch = ui.messages.filter((m) => m.patch).at(-1)?.patch;
  const highlightLines = useMemo(() => lastPatch?.changedLines ?? [], [lastPatch]);

  useEffect(() => {
    (async () => {
      try {
        await vfs().init();
        await files.refresh();
        const hasIndex = await vfs().isFile('index.html');
        if (!hasIndex) {
          await vfs().writeText('index.html', STARTER_HTML, { origin: 'generated', reason: 'projeto inicial' });
          await vfs().writeText('README.md', STARTER_README, { origin: 'generated', reason: 'projeto inicial' });
          await files.refresh();
        }
      } catch {
        ui.setToast({ message: 'IndexedDB indisponivel - o projeto nao sera salvo', kind: 'error' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notify = useCallback(
    (message: string, kind: 'info' | 'error' | 'success' = 'info') => {
      ui.setToast({ message, kind });
      window.setTimeout(() => ui.setToast(null), 4200);
    },
    [ui],
  );

  const importZip = useCallback(
    async (file: File) => {
      if (!isZipFile(file.name, file.type)) {
        notify('Selecione um arquivo .zip', 'error');
        return;
      }
      setBusy('Lendo ZIP...');
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { entries, stats } = await extractZip(bytes, undefined, (done, total, path) => {
          setBusy(`Extraindo ${done}/${total}: ${path}`);
        });
        let count = 0;
        for (const entry of entries) {
          const path = tryNormalizePath(entry.path);
          if (!path) continue;
          await vfs().writeBytes(path, entry.bytes, { origin: 'import-zip', reason: `import ${file.name}` });
          count++;
        }
        await files.refresh();
        const prefix = stats.rootPrefix ? ` (prefixo removido: ${stats.rootPrefix}/)` : '';
        notify(`${count} arquivos importados de ${file.name}${prefix}`, 'success');
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        setBusy(null);
      }
    },
    [files, notify],
  );

  const exportZip = useCallback(async () => {
    setBusy('Gerando ZIP...');
    try {
      const list = await vfs().listFiles();
      const sources = await Promise.all(
        list.map(async (f) => ({
          path: f.path,
          bytes: (await vfs().readBytes(f.path)) ?? new Uint8Array(0),
        })),
      );
      const blob = new Blob([(await createZip(sources)) as unknown as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${files.projectName || 'projeto'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      notify(`${sources.length} arquivos exportados`, 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  }, [files.projectName, notify]);

  const newFile = useCallback(async () => {
    const name = window.prompt('Nome do arquivo (ex: src/utils/helpers.ts):');
    const path = name ? tryNormalizePath(name) : null;
    if (!path) return;
    await vfs().writeText(path, '', { origin: 'user', reason: 'novo arquivo' });
    await files.refresh();
    await files.openFile(path);
  }, [files]);

  const deleteFile = useCallback(
    async (path: string) => {
      if (!window.confirm(`Excluir ${path}?`)) return;
      await vfs().delete(path, { origin: 'user', reason: 'excluir' });
      files.closeTab(path);
      await files.refresh();
    },
    [files, ui],
  );

  const saveActive = useCallback(async () => {
    const path = files.activePath;
    if (!path) return;
    await vfs().writeText(path, activeContent, { origin: 'user', reason: 'salvar' });
    files.markSaved(path);
    files.touchRecent(path);
    setPreviewToken((t) => t + 1);
    ui.setToast({ message: `${path} salvo`, kind: 'success' });
    window.setTimeout(() => useUi.getState().setToast(null), 1800);
  }, [activeContent, files, ui]);

  const onEditorChange = useCallback(
    (value: string) => {
      const path = files.activePath;
      if (!path) return;
      files.updateContent(path, value);
    },
    [files],
  );

  const canSend = (settings.providers[settings.activeProvider]?.apiKey?.length ?? 0) > 0;

  const send = useCallback(async () => {
    const goal = ui.draft.trim();
    if (!goal || !canSend || progress.running) return;

    if (settings.agent.sessionBudgetUsd > 0 && ui.sessionCostUsd >= settings.agent.sessionBudgetUsd) {
      notify(`Orcamento da sessao estourado (${formatCost(ui.sessionCostUsd)}). Aumente o limite ou zere em Configuracoes.`, 'error');
      return;
    }

    ui.pushMessage({ id: newMessageId(), role: 'user', content: goal, ts: Date.now() });
    ui.setDraft('');
    ui.setRunning(true);
    setProgress({ running: true, step: 0, maxSteps: settings.agent.maxSteps, tokensUsed: 0, status: 'iniciando' });

    const assistantId = newMessageId();
    ui.pushMessage({ id: assistantId, role: 'assistant', content: '', ts: Date.now(), streaming: true });

    const mode = ui.mode;
    const providerId = settings.activeProvider;
    const modelId = settings.routing[mode === 'planner' || mode === 'architect' ? 'planner' : mode === 'ask' || mode === 'reviewer' ? 'fast' : 'coder'] || settings.activeModel;
    const cfg = settings.providers[providerId];

    const runtime = createRuntime({
      enableCompression: ui.compressionEnabled,
      compressionLayers: ui.compressionLayers,
      windowSize: settings.compression.windowSize,
      contextWindow: contextWindow(providerId, modelId),
      maxPatchLines: settings.agent.maxPatchLines,
      onDelta: (chunk) => ui.appendDelta(assistantId, chunk),
      onStatus: (status) => {
        setProgress({
          running: status.status === 'running',
          step: status.step,
          maxSteps: status.maxSteps,
          tokensUsed: status.tokensUsed,
          status: status.error ?? status.lastSummary.slice(0, 80) ?? '',
        });
      },
      onPatch: (patch) => {
        useFiles.setState((s) => ({ contents: { ...s.contents, [patch.path]: patch.after } }));
        files.touchRecent(patch.path);
        setPreviewToken((t) => t + 1);
      },
      onContentChange: (path, content) => {
        useFiles.setState((s) => ({ contents: { ...s.contents, [path]: content } }));
      },
      onCompressionReport: (savedPercent) => ui.setLastSaved(savedPercent),
      onTasks: (next) => setTasks(next),
      onCheckpoint: (cp) =>
        setCheckpoints((prev) => [...prev.filter((c) => c.id !== cp.id), cp]),
      fastApply: {
        enabled: settings.agent.fastApply,
        maxLines: settings.agent.maxPatchLines > 200 ? 12 : Math.min(12, settings.agent.maxPatchLines),
        alwaysReviewLevels: ['file'],
        checkpointBefore: settings.agent.checkpoints,
      },
      useProjectRules: settings.agent.useProjectRules,
      browserTools: { enabled: settings.agent.browserTools, timeoutMs: 8000 },
      exec: runtimeCtx,
      runtimeInstructions: runtimeCtx ? RUNTIME_INSTRUCTIONS : '',
      sessionCostUsd: ui.sessionCostUsd,
      onApproval: async (path, reason) => {
        return new Promise<boolean>((resolve) => {
          const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          approvalResolvers.current.set(key, resolve);
          ui.setApproval({ path, reason, resolve: (ok: boolean) => {
            approvalResolvers.current.delete(key);
            resolve(ok);
          } });
        });
      },
    });
    runtimeRef.current = runtime;

    const runId = newRunId();
    void checkpointStore.clear(runId);
    setTasks([]);
    setCheckpoints([]);

    try {
      const status = await runtime.run({
        runId,
        mode,
        goal,
        providerId,
        model: modelId,
        apiKey: cfg?.apiKey ?? '',
        baseUrlOverride: cfg?.baseUrl,
        budget: { maxSteps: settings.agent.maxSteps, maxTokens: settings.agent.maxTokens, maxPatchLines: settings.agent.maxPatchLines },
        history: [],
      });

      const usageIn = Math.round(status.tokensUsed * 0.7);
      const usageOut = status.tokensUsed - usageIn;
      ui.updateMessage(assistantId, {
        streaming: false,
        content: status.lastSummary || (status.error ?? 'Execucao concluida sem resposta textual.'),
        error: status.error ?? undefined,
        tokensIn: usageIn,
        tokensOut: usageOut,
        cost: costOf(providerId, { promptTokens: usageIn, completionTokens: usageOut, totalTokens: status.tokensUsed, estimated: true }),
        savedPercent: ui.lastSavedPercent,
      });

      ui.setSessionCost(ui.sessionCostUsd + (costOf(providerId, { promptTokens: usageIn, completionTokens: usageOut, totalTokens: status.tokensUsed, estimated: true }) || 0));
      ui.setRun(runId, status.step, status.maxSteps, status.tokensUsed);

      const parsed = parseTasks(status.lastSummary, runId);
      if (parsed.length > 0) setTasks((prev) => mergeTasks(prev, parsed));

      if (ui.mode === 'planner' || ui.mode === 'architect') {
        const plan = parsePlan(status.lastSummary, runId);
        if (plan.steps.length > 0) {
          plan.goal = goal;
          ui.setPlan(plan);
          if (ui.plan?.status === 'draft') notify('Plano pronto. Revise e aprove para executar.', 'info');
        }
      }

      await files.refresh();
      if (status.status === 'done') notify(`Concluido em ${status.step} passo(s)`, 'success');
      else if (status.status === 'paused') notify(`Pausado: ${status.error}`, 'info');
      else if (status.status === 'failed') notify(`Falhou: ${status.error}`, 'error');
    } catch (e) {
      ui.updateMessage(assistantId, { streaming: false, content: '', error: e instanceof Error ? e.message : String(e) });
      notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      ui.setRunning(false);
      ui.setApproval(null);
      approvalResolvers.current.clear();
      setProgress((p) => ({ ...p, running: false }));
    }
  }, [canSend, files, notify, progress.running, runtimeCtx, settings, ui]);

  const stop = useCallback(() => {
    runtimeRef.current?.abort();
    ui.setRunning(false);
    setProgress((p) => ({ ...p, running: false }));
  }, [ui]);

  const revertFile = useCallback(
    async (path: string) => {
      const snaps = await vfs().snapshotsFor(path, 1);
      const snap = snaps[0];
      if (!snap) {
        notify('Sem historico para reverter', 'error');
        return;
      }
      if (snap.content === null) {
        await vfs().delete(path, { reason: 'reverter patch' });
      } else {
        await vfs().writeText(path, snap.content, { reason: 'reverter patch' });
      }
      const content = await vfs().readText(path);
      useFiles.setState((s) => ({ contents: { ...s.contents, [path]: content ?? '' } }));
      await files.refresh();
      setPreviewToken((t) => t + 1);
      notify(`${path} revertido`, 'success');
    },
    [files, notify],
  );

  const acceptPatch = useCallback(() => notify('Patch mantido', 'success'), [notify]);

  const switchPanel = (panel: SidePanel): void => setSidePanel((p) => (p === panel ? null : panel));

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-10 w-full shrink-0 items-center gap-1 border-b border-border bg-card/60 px-2">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title={sidebarOpen ? 'Ocultar barra lateral' : 'Mostrar barra lateral'}
        >
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>

        <div className="flex items-center gap-1.5 px-2">
          <Zap className="h-4 w-4 text-arc" />
          <span className="text-sm font-semibold tracking-tight">Arcanum Weaver</span>
        </div>

        <div className="mx-2 h-4 w-px bg-border" />

        <PanelBtn icon={<MessageSquare className="h-4 w-4" />} label="Chat" active={sidePanel === 'chat'} onClick={() => switchPanel('chat')} />
        <PanelBtn icon={<Bot className="h-4 w-4" />} label="Agente" active={sidePanel === 'chat'} onClick={() => switchPanel('chat')} />
        <PanelBtn
          icon={<ListChecks className="h-4 w-4" />}
          label="Sessao"
          active={sidePanel === 'session'}
          onClick={() => switchPanel('session')}
          badge={tasks.length > 0 ? `${tasks.filter((t) => t.status === 'done').length}/${tasks.length}` : undefined}
        />
        <PanelBtn icon={<FileSearch className="h-4 w-4" />} label="Buscar" active={sidePanel === 'rag'} onClick={() => switchPanel('rag')} />
        <PanelBtn icon={<Plug className="h-4 w-4" />} label="MCP" active={sidePanel === 'mcp'} onClick={() => switchPanel('mcp')} />
        <PanelBtn icon={<Rocket className="h-4 w-4" />} label="Publicar" active={sidePanel === 'deploy'} onClick={() => switchPanel('deploy')} />
        <PanelBtn
          icon={<ListChecks className="h-4 w-4" />}
          label="Revisar"
          active={sidePanel === 'review'}
          onClick={() => switchPanel('review')}
        />
        <PanelBtn
          icon={<KeyRound className="h-4 w-4" />}
          label="Segredos"
          active={sidePanel === 'secrets'}
          onClick={() => switchPanel('secrets')}
        />
        <PanelBtn
          icon={<GitBranch className="h-4 w-4" />}
          label="Git"
          active={sidePanel === 'git'}
          onClick={() => switchPanel('git')}
        />
        <PanelBtn
          icon={<TerminalIcon className="h-4 w-4" />}
          label="Terminal"
          active={sidePanel === 'terminal'}
          onClick={() => switchPanel('terminal')}
        />
        <PanelBtn icon={<Eye className="h-4 w-4" />} label="Preview" active={sidePanel === 'preview'} onClick={() => switchPanel('preview')} />
        <PanelBtn icon={<SettingsIcon className="h-4 w-4" />} label="Config" active={sidePanel === 'settings'} onClick={() => switchPanel('settings')} />

        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          {busy && <span className="flex items-center gap-1 text-amber-400">{busy}</span>}
          <span className="font-mono">
            {settings.providers[settings.activeProvider]?.apiKey ? 'chave ok' : 'sem chave'}
          </span>
          <span className="font-mono">{files.flatPaths.length} arquivos</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <aside
            className="shrink-0 border-r border-border bg-card/20"
            style={{ width: files.sidebarWidth }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const w = e.clientX;
              files.setSidebarWidth(files.sidebarWidth + (w - (e.target as HTMLElement).getBoundingClientRect().left));
            }}
          >
            <Explorer
              tree={files.tree}
              expanded={files.expanded}
              activePath={files.activePath}
              recentlyEdited={files.recentlyEdited}
              loading={files.loading}
              onOpen={(p) => files.openFile(p)}
              onToggle={(p) => files.toggleDir(p)}
              onImportZip={importZip}
              onExportZip={exportZip}
              onNewFile={newFile}
              onDelete={deleteFile}
              onRefresh={() => files.refresh()}
            />
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-0 overflow-x-auto border-b border-border bg-card/30">
            {files.openTabs.map((tab) => (
              <button
                key={tab.path}
                type="button"
                onClick={() => files.setActive(tab.path)}
                className={`group flex h-9 shrink-0 items-center gap-1.5 border-r border-border px-2.5 text-xs transition-colors ${
                  files.activePath === tab.path ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <FileCode2 className="h-3 w-3 text-arc/70" />
                <span className="max-w-[160px] truncate">{tab.path.split('/').pop()}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    files.closeTab(tab.path);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      files.closeTab(tab.path);
                    }
                  }}
                  className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              </button>
            ))}
            {files.openTabs.length === 0 && (
              <span className="px-3 text-[11px] text-muted-foreground">Nenhum arquivo aberto</span>
            )}
          </div>

          <div className="min-h-0 flex-1">
            {files.activePath ? (
              <CodeEditor
                path={files.activePath}
                value={activeContent}
                language={activeLanguage}
                fontSize={settings.editor.fontSize}
                tabSize={settings.editor.tabSize}
                wordWrap={settings.editor.wordWrap}
                highlightLines={highlightLines}
                onChange={onEditorChange}
                onSave={saveActive}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Zap className="h-8 w-8 text-arc/40" />
                <p className="max-w-sm text-sm text-muted-foreground">
                  Selecione um arquivo no explorador, importe um ZIP, ou peça algo ao agente.
                </p>
                <button
                  type="button"
                  onClick={() => switchPanel('chat')}
                  className="mt-1 flex items-center gap-1.5 rounded bg-arc px-3 py-1.5 text-xs text-white hover:opacity-90"
                >
                  <ChevronRight className="h-3 w-3" />
                  Abrir chat
                </button>
              </div>
            )}
          </div>
        </main>

        {sidePanel && (
          <aside className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card/20 max-lg:w-[340px]">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
              <button
                type="button"
                onClick={() => setSidePanel(null)}
                className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Fechar painel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {sidePanel === 'settings' ? (
                <SettingsPanel />
              ) : sidePanel === 'session' ? (
                <SessionPanel
                  tasks={tasks}
                  checkpoints={checkpoints}
                  tokensUsed={ui.tokensUsed}
                  costUsd={ui.sessionCostUsd}
                  budgetUsd={settings.agent.sessionBudgetUsd}
                  onRestore={(label) => notify(label, 'info')}
                />
              ) : sidePanel === 'rag' ? (
                <RagPanel />
              ) : sidePanel === 'mcp' ? (
                <McpPanel />
              ) : sidePanel === 'deploy' ? (
                <DeployPanel
                  projectName={files.projectName}
                  bundlerEnabled={settings.build.bundlerEnabled}
                  onMessage={(message, kind) => notify(message, kind)}
                />
              ) : sidePanel === 'review' ? (
                <WalkthroughPanel
                  onMessage={(message, kind) => notify(message, kind)}
                  onClose={() => switchPanel('review')}
                />
              ) : sidePanel === 'secrets' ? (
                <SecretsPanel onMessage={(message, kind) => notify(message, kind)} />
              ) : sidePanel === 'git' ? (
                <GitPanel onMessage={(message, kind) => notify(message, kind)} />
              ) : sidePanel === 'terminal' ? (
                <TerminalPanel
                  config={runtimeConfig}
                  files={files.flatPaths.map((p) => ({ path: p, content: files.contents[p] ?? '' })).filter((f) => f.content !== '')}
                />
              ) : sidePanel === 'preview' ? (
                <Preview
                  refreshToken={previewToken}
                  autoReload={previewAutoReload}
                  onToggleAutoReload={() => setPreviewAutoReload((v) => !v)}
                  bundlerEnabled={settings.build.bundlerEnabled}
                  cdnFallback={settings.build.cdnFallback}
                  smokeTest={previewSmoke}
                  onToggleSmoke={() => setPreviewSmoke((v) => !v)}
                  onSmokeChange={setSmokeResult}
                  onConsoleChange={setConsoleEntries}
                />
              ) : (
                <Chat
                  messages={ui.messages}
                  draft={ui.draft}
                  mode={ui.mode}
                  running={progress.running}
                  progress={progress}
                  compressionEnabled={ui.compressionEnabled}
                  savedPercent={ui.lastSavedPercent}
                  approval={ui.approval}
                  plan={ui.plan}
                  onPlanApprove={() => ui.setPlan(ui.plan ? { ...approvePlan(ui.plan), status: 'approved' } : null)}
                  onPlanReject={() => ui.setPlan(ui.plan ? rejectPlan(ui.plan) : null)}
                  canSend={canSend}
                  onDraft={(v) => ui.setDraft(v)}
                  onMode={(m) => ui.setMode(m)}
                  onSend={send}
                  onStop={stop}
                  onToggleCompression={() => ui.setCompression(!ui.compressionEnabled)}
                  onRevertPatch={revertFile}
                  onPatchAccept={acceptPatch}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {ui.toast && (
        <div
          className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border px-3 py-1.5 text-xs shadow-lg ${
            ui.toast.kind === 'error'
              ? 'border-destructive/50 bg-destructive/15 text-destructive'
              : ui.toast.kind === 'success'
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                : 'border-border bg-card text-foreground'
          }`}
        >
          <span className="flex items-center gap-1.5">
            {ui.toast.kind === 'success' && <Check className="h-3 w-3" />}
            {ui.toast.message}
          </span>
        </div>
      )}

      {sidePanel !== 'preview' && (smokeResult?.state === 'failed' || consoleEntries.length > 0) && (
        <button
          type="button"
          onClick={() => switchPanel('preview')}
          className={`pointer-events-auto fixed bottom-1 right-1 rounded bg-card/90 px-2 py-0.5 font-mono text-[10px] ${
            smokeResult?.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'
          }`}
          title={smokeResult?.state === 'failed' ? smokeResult.message : `${consoleEntries.length} log(s) no preview`}
        >
          preview: {smokeResult?.state === 'failed' ? 'erro' : `${consoleEntries.length} log(s)`}
        </button>
      )}
    </div>
  );
}

function PanelBtn({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick(): void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
        active ? 'bg-arc/20 text-arc-fg' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {badge && <span className="rounded bg-muted px-1 font-mono text-[10px]">{badge}</span>}
    </button>
  );
}

const STARTER_HTML = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Meu projeto</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        background: linear-gradient(135deg, #0d0f16, #1a1030);
        color: #e6e3f0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }
      main { text-align: center; padding: 2rem; }
      h1 { font-size: 2.25rem; margin: 0 0 0.5rem; background: linear-gradient(90deg, #b18cff, #ff9ecd); -webkit-background-clip: text; background-clip: text; color: transparent; }
      p { color: #a5a0b8; margin: 0; }
      button {
        margin-top: 1.5rem; padding: 0.6rem 1.4rem; border-radius: 0.5rem;
        border: 1px solid #b18cff55; background: #b18cff22; color: #d8c9ff; cursor: pointer; font-size: 0.9rem;
      }
      button:hover { background: #b18cff33; }
    </style>
  </head>
  <body>
    <main>
      <h1>Arcanum Weaver</h1>
      <p>Edite este arquivo ou peca uma mudanca ao agente.</p>
      <button onclick="this.textContent = 'funcionando'">Testar</button>
    </main>
  </body>
</html>
`;

const STARTER_README = `# Meu projeto

Projeto criado pelo Arcanum Weaver.

## Como usar
1. Arraste um ZIP aqui no explorador para importar um projeto existente
2. Edite os arquivos no editor central
3. Use o painel de preview para ver o site
4. Peca mudancas ao agente - ele edita um arquivo por vez

## Garantias
- Um patch altera exatamente um arquivo
- Patches que quebram a sintaxe sao revertidos automaticamente
- ZIP bloqueia path traversal
`;

export { MODES };