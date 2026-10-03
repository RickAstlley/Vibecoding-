'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentMode } from '@/core/agents/modes';
import type { LayerId } from '@/core/compress/pipeline';
import type { ContextFileReport } from '@/core/context/builder';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  ts: number;
  streaming?: boolean;
  runId?: string;
  patch?: { path: string; before: string; after: string; level: string; changedLines: number[] };
  tokensIn?: number;
  tokensOut?: number;
  savedPercent?: number;
  cost?: number;
  reports?: ContextFileReport[];
  error?: string;
}

export type PanelTab = 'chat' | 'agent' | 'preview' | 'files';

export interface PatchRecord {
  patchId: string;
  path: string;
  before: string;
  after: string;
  level: string;
  changedLines: number[];
  ts: number;
  accepted: boolean;
}

export interface ApprovalRequest {
  path: string;
  reason: string;
  resolve(approved: boolean): void;
}

interface UiState {
  activePanel: PanelTab;
  bottomPanelOpen: boolean;
  sidebarWidth: number;
  messages: ChatMessage[];
  patches: PatchRecord[];
  mode: AgentMode;
  draft: string;
  running: boolean;
  runId: string | null;
  currentStep: number;
  maxSteps: number;
  tokensUsed: number;
  compressionEnabled: boolean;
  compressionLayers: LayerId[];
  lastSavedPercent: number;
  approval: ApprovalRequest | null;
  toast: { message: string; kind: 'info' | 'error' | 'success' } | null;

  setPanel(panel: PanelTab): void;
  toggleBottom(): void;
  setSidebarWidth(width: number): void;
  setDraft(text: string): void;
  setMode(mode: AgentMode): void;
  setRunning(running: boolean): void;
  setRun(runId: string | null, step: number, maxSteps: number, tokens: number): void;
  pushMessage(msg: ChatMessage): void;
  updateMessage(id: string, patch: Partial<ChatMessage>): void;
  appendDelta(id: string, chunk: string): void;
  setCompression(enabled: boolean, layers?: LayerId[]): void;
  setLastSaved(percent: number): void;
  addPatch(patch: PatchRecord): void;
  setApproval(approval: ApprovalRequest | null): void;
  setToast(toast: { message: string; kind: 'info' | 'error' | 'success' } | null): void;
  clearMessages(): void;
}

let msgCounter = 0;
export function newMessageId(): string {
  msgCounter = (msgCounter + 1) % 1e6;
  return `m${Date.now().toString(36)}${msgCounter.toString(36)}`;
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      activePanel: 'chat',
      bottomPanelOpen: true,
      sidebarWidth: 260,
      messages: [],
      patches: [],
      mode: 'coder',
      draft: '',
      running: false,
      runId: null,
      currentStep: 0,
      maxSteps: 30,
      tokensUsed: 0,
      compressionEnabled: true,
      compressionLayers: ['strip', 'dedupe', 'structure', 'window'],
      lastSavedPercent: 0,
      approval: null,
      toast: null,

      setPanel: (activePanel) => set({ activePanel }),
      toggleBottom: () => set({ bottomPanelOpen: !get().bottomPanelOpen }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: Math.max(180, Math.min(560, sidebarWidth)) }),
      setDraft: (draft) => set({ draft }),
      setMode: (mode) => set({ mode }),
      setRunning: (running) => set({ running }),
      setRun: (runId, currentStep, maxSteps, tokensUsed) => set({ runId, currentStep, maxSteps, tokensUsed }),
      pushMessage: (msg) => set({ messages: [...get().messages, msg] }),
      updateMessage: (id, patch) =>
        set({ messages: get().messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }),
      appendDelta: (id, chunk) =>
        set({
          messages: get().messages.map((m) => (m.id === id ? { ...m, content: m.content + chunk, streaming: true } : m)),
        }),
      setCompression: (compressionEnabled, compressionLayers) =>
        set({ compressionEnabled, ...(compressionLayers ? { compressionLayers } : {}) }),
      setLastSaved: (lastSavedPercent) => set({ lastSavedPercent }),
      addPatch: (patch) => set({ patches: [patch, ...get().patches].slice(0, 100) }),
      setApproval: (approval) => set({ approval }),
      setToast: (toast) => set({ toast }),
      clearMessages: () => set({ messages: [], patches: [] }),
    }),
    {
      name: 'arcanum-weaver-ui',
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        messages: s.messages.map((m) => ({ ...m, streaming: false })),
        patches: s.patches.slice(0, 30),
        mode: s.mode,
        compressionEnabled: s.compressionEnabled,
        compressionLayers: s.compressionLayers,
      }),
    },
  ),
);