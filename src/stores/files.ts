'use client';

import { create } from 'zustand';
import type { FileOrigin } from '@/types/vfs';

export interface TreeNode {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  children: TreeNode[];
}

export interface OpenTab {
  path: string;
  preview: boolean;
}

export interface FilesState {
  tree: TreeNode[];
  flatPaths: string[];
  dirs: string[];
  contents: Record<string, string>;
  openTabs: OpenTab[];
  activePath: string | null;
  expanded: Set<string>;
  recentlyEdited: string[];
  projectName: string;
  sidebarWidth: number;
  loading: boolean;
  saving: Set<string>;

  refresh(): Promise<void>;
  openFile(path: string, preview?: boolean): Promise<void>;
  closeTab(path: string): void;
  setActive(path: string): void;
  toggleDir(path: string): void;
  updateContent(path: string, content: string): void;
  markSaved(path: string): void;
  setTree(tree: TreeNode[], flat: string[], dirs: string[]): void;
  setLoading(loading: boolean): void;
  touchRecent(path: string, origin?: FileOrigin): void;
  setProjectName(name: string): void;
  setSidebarWidth(width: number): void;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

export function buildTree(files: string[], dirs: string[]): TreeNode[] {
  const root: TreeNode = { path: '', name: '', kind: 'dir', children: [] };
  const index = new Map<string, TreeNode>([['', root]]);

  const ensureDir = (path: string): TreeNode => {
    const cached = index.get(path);
    if (cached) return cached;
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const parent = ensureDir(parentPath);
    const node: TreeNode = { path, name: basename(path), kind: 'dir', children: [] };
    parent.children.push(node);
    index.set(path, node);
    return node;
  };

  for (const d of [...dirs].sort()) ensureDir(d);
  for (const f of [...files].sort()) {
    const parentPath = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    const parent = ensureDir(parentPath);
    parent.children.push({ path: f, name: basename(f), kind: 'file', children: [] });
  }

  const sort = (node: TreeNode): void => {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) sort(c);
  };
  sort(root);
  return root.children;
}

export const useFiles = create<FilesState>((set, get) => ({
  tree: [],
  flatPaths: [],
  dirs: [],
  contents: {},
  openTabs: [],
  activePath: null,
  expanded: new Set<string>(['src']),
  recentlyEdited: [],
  projectName: 'meu-projeto',
  sidebarWidth: 260,
  loading: false,
  saving: new Set<string>(),

  setTree: (tree, flat, dirs) => set({ tree, flatPaths: flat, dirs }),
  setLoading: (loading) => set({ loading }),

  refresh: async () => {
    set({ loading: true });
    const { vfs } = await import('@/core/vfs/vfs');
    const { files, dirs } = await vfs().tree();
    set({ tree: buildTree(files, dirs), flatPaths: files, dirs, loading: false });
  },

  openFile: async (path, preview = false) => {
    const { contents, openTabs } = get();
    if (!contents[path]) {
      const { vfs } = await import('@/core/vfs/vfs');
      const content = await vfs().readText(path);
      set({ contents: { ...get().contents, [path]: content ?? '' } });
    }
    const exists = openTabs.some((t) => t.path === path);
    if (!exists) {
      set({ openTabs: [...openTabs, { path, preview }] });
    }
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const expanded = new Set(get().expanded);
    if (parent) expanded.add(parent);
    set({ activePath: path, expanded });
  },

  closeTab: (path) => {
    const openTabs = get().openTabs.filter((t) => t.path !== path);
    const activePath = get().activePath === path ? (openTabs[openTabs.length - 1]?.path ?? null) : get().activePath;
    set({ openTabs, activePath });
  },

  setActive: (path) => set({ activePath: path }),

  toggleDir: (path) => {
    const expanded = new Set(get().expanded);
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    set({ expanded });
  },

  updateContent: (path, content) => {
    const contents = { ...get().contents, [path]: content };
    const saving = new Set(get().saving).add(path);
    set({ contents, saving });
  },

  markSaved: (path) => {
    const saving = new Set(get().saving);
    saving.delete(path);
    set({ saving });
  },

  touchRecent: (path) => {
    const recent = [path, ...get().recentlyEdited.filter((p) => p !== path)].slice(0, 20);
    set({ recentlyEdited: recent });
  },

  setProjectName: (projectName) => set({ projectName }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: Math.max(180, Math.min(560, sidebarWidth)) }),
}));