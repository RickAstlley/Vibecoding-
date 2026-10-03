'use client';

import { vfs } from '@/core/vfs/vfs';
import { isEntryPoint } from '@/core/context/ranker';
import { applySurgicalPatch, PatchRejection, newPatchId, type PatchRequest } from '@/core/patch/surgical';
import { buildContext } from '@/core/context/builder';
import { AgentRuntime, newRunId, type RunConfig, type RunStatus } from '@/core/agents/runtime';
import type { ContextFileReport } from '@/core/context/builder';
import type { ChatMessage } from '@/core/ia/client';
import type { ToolExecutionContext } from '@/core/agents/tools';

export interface AppDeps {
  enableCompression: boolean;
  compressionLayers: string[];
  windowSize: number;
  contextWindow: number;
  maxPatchLines: number;
  onDelta?(chunk: string): void;
  onStatus?(status: RunStatus): void;
  onPatch?(patch: { path: string; before: string; after: string; level: string; changedLines: number[] }): void;
  onApproval?(path: string, reason: string): Promise<boolean>;
  onContentChange?(path: string, content: string): void;
  onDelete?(path: string): void;
  onCompressionReport?(savedPercent: number, reports: ContextFileReport[]): void;
}

async function searchCode(query: string, scope?: string, useRegex = false): Promise<Array<{ path: string; line: number; text: string }>> {
  const files = await vfs().listFiles();
  let re: RegExp;
  try {
    re = useRegex ? new RegExp(query, 'i') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  } catch {
    return [];
  }
  const prefix = scope ? `${scope}/` : '';
  const out: Array<{ path: string; line: number; text: string }> = [];
  for (const f of files) {
    if (f.content === null) continue;
    if (prefix && !f.path.startsWith(prefix)) continue;
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length && out.length < 200; i++) {
      const line = lines[i] as string;
      if (re.test(line)) out.push({ path: f.path, line: i + 1, text: line });
    }
  }
  return out;
}

export function createRuntime(deps: AppDeps): AgentRuntime {
  const toolCtx: ToolExecutionContext = {
    read: (path) => vfs().readText(path),
    listFiles: async () => (await vfs().tree()).files,
    search: searchCode,
    applyEdit: async (tool, args) => {
      const path = String(args.path ?? '');
      let request: PatchRequest;
      if (tool === 'edit_line') {
        request = { level: 'line', path, ops: [{ kind: 'replace', line: Number(args.line), text: String(args.text ?? '') }], patchId: newPatchId() };
      } else if (tool === 'edit_anchor') {
        request = { level: 'anchor', path, op: { kind: 'replace-anchor', anchor: String(args.anchor), text: String(args.text ?? '') }, patchId: newPatchId() };
      } else {
        request = { level: 'file', path, content: String(args.content ?? ''), patchId: newPatchId() };
      }

      try {
        const applied = await applySurgicalPatch(request, {
          read: (p) => vfs().readText(p),
          hash: (p) => vfs().hashOf(p),
          exists: (p) => vfs().isFile(p),
          write: async (p, content, patchId, note) => {
            await vfs().writeText(p, content, { origin: 'agent-patch', patchId, reason: note });
            deps.onContentChange?.(p, content);
          },
        });
        deps.onPatch?.({
          path: applied.path,
          before: applied.before,
          after: applied.after,
          level: applied.level,
          changedLines: applied.changedLines,
        });
        return {
          ok: true,
          summary: `Patch aplicado em ${applied.path}: ${applied.linesAdded + applied.linesRemoved} linha(s) alterada(s)${applied.changedLines.length ? ` (linhas ${applied.changedLines.slice(0, 10).join(', ')})` : ''}. Verificacao de sintaxe: OK.`,
          patchPath: applied.path,
        };
      } catch (e) {
        if (e instanceof PatchRejection) {
          return { ok: false, summary: e.message };
        }
        throw e;
      }
    },
  };

  return new AgentRuntime({
    ...toolCtx,
    buildContext: async (goal: string, history: ChatMessage[]) => {
      const files = await vfs().listFiles();
      const rankable = files
        .filter((f) => f.content !== null && f.size < 400_000)
        .map((f) => ({
          path: f.path,
          content: f.content as string,
          size: f.size,
          recentlyEdited: Date.now() - f.updatedAt < 10 * 60 * 1000,
          isOpen: false,
          isEntry: isEntryPoint(f.path),
        }));

      const built = buildContext({
        question: goal,
        files: rankable,
        systemPrompt: '',
        history: history.filter((h) => h.role !== 'system').map((h) => ({ role: h.role, content: h.content })),
        budget: { contextWindow: deps.contextWindow },
        enableCompression: deps.enableCompression,
        compress: {
          enabled: deps.compressionLayers as never,
          windowSize: deps.windowSize,
        },
      });

      deps.onCompressionReport?.(built.savedPercent, built.reports);

      return {
        system: '',
        userBlock: built.userBlock,
        history: built.history.map((h) => ({ role: h.role as ChatMessage['role'], content: h.content })),
      };
    },
  });
}

export { newRunId };
export type { RunConfig, RunStatus };