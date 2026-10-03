export type Binary = Uint8Array;

export interface VFile {
  path: string;
  kind: 'file';
  content: string | null;
  blob: Binary | null;
  size: number;
  hash: string;
  encoding: 'utf8' | 'binary';
  updatedAt: number;
  version: number;
}

export interface VDir {
  path: string;
  kind: 'dir';
  children: string[];
  updatedAt: number;
}

export type VNode = VFile | VDir;

export type Language =
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'json'
  | 'html'
  | 'css'
  | 'markdown'
  | 'python'
  | 'yaml'
  | 'shell'
  | 'text'
  | 'binary';

export type FileOrigin = 'user' | 'import-zip' | 'agent-patch' | 'generated' | 'external';

export interface Snapshot {
  id: string;
  path: string;
  version: number;
  hash: string;
  content: string | null;
  reason: string;
  createdAt: number;
  origin: FileOrigin;
  patchId?: string;
}
