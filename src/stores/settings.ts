'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MODELS, PROVIDERS } from '@/core/ia/providers';

export interface ProviderSettings {
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
}

interface SettingsState {
  providers: Record<string, ProviderSettings>;
  activeProvider: string;
  activeModel: string;
  routing: { planner: string; coder: string; fast: string };
  compression: {
    enabled: boolean;
    layers: string[];
    windowSize: number;
    semantic: boolean;
  };
  agent: {
    maxSteps: number;
    maxTokens: number;
    maxPatchLines: number;
    autoApproveSmall: boolean;
    stream: boolean;
  };
  editor: { fontSize: number; tabSize: number; wordWrap: boolean; minimap: boolean };
  setApiKey: (providerId: string, key: string) => void;
  setBaseUrl: (providerId: string, url: string) => void;
  setActiveProvider: (id: string) => void;
  setActiveModel: (model: string) => void;
  setRouting: (role: 'planner' | 'coder' | 'fast', model: string) => void;
  setCompression: (patch: Partial<SettingsState['compression']>) => void;
  setAgent: (patch: Partial<SettingsState['agent']>) => void;
  setEditor: (patch: Partial<SettingsState['editor']>) => void;
  resetKeys: () => void;
}

const defaultProviders = (): Record<string, ProviderSettings> =>
  Object.fromEntries(
    PROVIDERS.map((p) => [p.id, { apiKey: '', baseUrl: p.baseUrl, enabled: p.featured === true }]),
  );

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      providers: defaultProviders(),
      activeProvider: 'nvidia-nim',
      activeModel: DEFAULT_MODELS['nvidia-nim'] ?? 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
      routing: { planner: '', coder: '', fast: '' },
      compression: { enabled: true, layers: ['strip', 'dedupe', 'structure', 'window'], windowSize: 40, semantic: false },
      agent: { maxSteps: 30, maxTokens: 400000, maxPatchLines: 200, autoApproveSmall: true, stream: true },
      editor: { fontSize: 13, tabSize: 2, wordWrap: false, minimap: false },
      setApiKey: (providerId, key) =>
        set((s) => {
          const current = s.providers[providerId] ?? { apiKey: '', baseUrl: '', enabled: false };
          return { providers: { ...s.providers, [providerId]: { ...current, apiKey: key } } };
        }),
      setBaseUrl: (providerId, url) =>
        set((s) => {
          const current = s.providers[providerId] ?? { apiKey: '', baseUrl: '', enabled: false };
          return { providers: { ...s.providers, [providerId]: { ...current, baseUrl: url } } };
        }),
      setActiveProvider: (id) =>
        set(() => ({ activeProvider: id, activeModel: DEFAULT_MODELS[id] ?? PROVIDERS.find((p) => p.id === id)?.models[0]?.id ?? '' })),
      setActiveModel: (model) => set({ activeModel: model }),
      setRouting: (role, model) => set((s) => ({ routing: { ...s.routing, [role]: model } })),
      setCompression: (patch) => set((s) => ({ compression: { ...s.compression, ...patch } })),
      setAgent: (patch) => set((s) => ({ agent: { ...s.agent, ...patch } })),
      setEditor: (patch) => set((s) => ({ editor: { ...s.editor, ...patch } })),
      resetKeys: () => set({ providers: defaultProviders() }),
    }),
    {
      name: 'arcanum-weaver-settings',
      partialize: (s) => ({
        providers: s.providers,
        activeProvider: s.activeProvider,
        activeModel: s.activeModel,
        routing: s.routing,
        compression: s.compression,
        agent: s.agent,
        editor: s.editor,
      }),
    },
  ),
);

export function activeApiKey(state: SettingsState): string {
  return state.providers[state.activeProvider]?.apiKey ?? '';
}

export function activeBaseUrl(state: SettingsState): string {
  const p = state.providers[state.activeProvider];
  if (!p) return '';
  return p.baseUrl || (PROVIDERS.find((x) => x.id === state.activeProvider)?.baseUrl ?? '');
}

export function hasKey(state: SettingsState): boolean {
  const key = activeApiKey(state);
  return key.length > 0;
}