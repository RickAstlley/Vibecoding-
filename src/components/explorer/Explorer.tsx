'use client';

import { useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  FileCode2,
  FileJson,
  FileText,
  Image as ImageIcon,
  Upload,
  Download,
  Plus,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import type { TreeNode } from '@/stores/files';

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.html', '.vue', '.svelte']);
const DATA_EXT = new Set(['.json', '.yaml', '.yml', '.toml']);

function Icon({ node }: { node: TreeNode }) {
  const ext = node.name.includes('.') ? `.${node.name.split('.').pop()}` : '';
  if (node.kind === 'dir') return <Folder className="h-3.5 w-3.5 text-amber-500/80" />;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'].includes(ext)) {
    return <ImageIcon className="h-3.5 w-3.5 text-sky-400/80" />;
  }
  if (DATA_EXT.has(ext)) return <FileJson className="h-3.5 w-3.5 text-yellow-400/80" />;
  if (CODE_EXT.has(ext)) return <FileCode2 className="h-3.5 w-3.5 text-arc" />;
  if (['.md', '.txt', '.mdx'].includes(ext)) return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  return <FileIcon className="h-3.5 w-3.5 text-muted-foreground/70" />;
}

export interface ExplorerProps {
  tree: TreeNode[];
  expanded: Set<string>;
  activePath: string | null;
  recentlyEdited: string[];
  loading: boolean;
  onOpen(path: string): void;
  onToggle(path: string): void;
  onImportZip(file: File): void;
  onExportZip(): void;
  onNewFile(): void;
  onDelete(path: string): void;
  onRefresh(): void;
}

export function Explorer({
  tree,
  expanded,
  activePath,
  recentlyEdited,
  loading,
  onOpen,
  onToggle,
  onImportZip,
  onExportZip,
  onNewFile,
  onDelete,
  onRefresh,
}: ExplorerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pickZip = (): void => input.current?.click();

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onImportZip(file);
  };

  return (
    <div
      className={`flex h-full flex-col ${dragOver ? 'outline-2 outline-arc outline-offset-[-4px]' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImportZip(file);
          e.target.value = '';
        }}
      />

      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Arquivos</span>
        <span className="ml-auto flex items-center gap-0.5">
          <IconBtn title="Novo arquivo" onClick={onNewFile}>
            <Plus className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="Importar ZIP" onClick={pickZip}>
            <Upload className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="Exportar ZIP" onClick={onExportZip}>
            <Download className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn title="Atualizar" onClick={onRefresh}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </IconBtn>
        </span>
      </div>

      <div className="scrollbar-thin flex-1 overflow-auto py-1">
        {tree.length === 0 ? (
          <button
            type="button"
            onClick={pickZip}
            className="m-2 flex w-[calc(100%-1rem)] flex-col items-center gap-1.5 rounded-md border border-dashed border-border py-6 text-xs text-muted-foreground transition-colors hover:border-arc hover:text-arc"
          >
            <Upload className="h-5 w-5" />
            <span>Arraste um ZIP aqui</span>
            <span className="text-[10px]">ou clique para escolher</span>
          </button>
        ) : (
          tree.map((node) => <Node key={node.path} node={node} depth={0} {...{ expanded, activePath, recentlyEdited, onOpen, onToggle, onDelete }} />)
        )}
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80">
          <div className="rounded-lg border-2 border-dashed border-arc px-6 py-4 text-sm text-arc">
            Solte o ZIP para importar
          </div>
        </div>
      )}
    </div>
  );
}

function Node({
  node,
  depth,
  expanded,
  activePath,
  recentlyEdited,
  onOpen,
  onToggle,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  activePath: string | null;
  recentlyEdited: string[];
  onOpen(path: string): void;
  onToggle(path: string): void;
  onDelete(path: string): void;
}) {
  const isOpen = expanded.has(node.path);
  const isActive = activePath === node.path;
  const recent = recentlyEdited.includes(node.path);
  const pad = 6 + depth * 10;

  if (node.kind === 'dir') {
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          style={{ paddingLeft: pad }}
          className="flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[13px] hover:bg-muted/60"
        >
          {isOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500/80" /> : <Icon node={node} />}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && node.children.map((child) => (
          <Node
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            activePath={activePath}
            recentlyEdited={recentlyEdited}
            onOpen={onOpen}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onOpen(node.path)}
        style={{ paddingLeft: pad + 4 }}
        className={`flex w-full items-center gap-1.5 py-[3px] pr-6 text-left text-[13px] transition-colors hover:bg-muted/60 ${
          isActive ? 'bg-arc/20 text-arc-fg' : ''
        }`}
      >
        <Icon node={node} />
        <span className="truncate">{node.name}</span>
        {recent && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-arc" title="Editado recentemente" />}
      </button>
      <button
        type="button"
        onClick={() => onDelete(node.path)}
        className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive group-hover:block"
        title={`Excluir ${node.path}`}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}