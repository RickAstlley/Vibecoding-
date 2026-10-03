import { createZip } from '../zip/unzip';
import { vfs } from '../vfs/vfs';
import { diffAgainst, head } from '../git/repo';

export type DeployTarget = 'zip' | 'github-pages' | 'netlify-drop' | 'hostinger';

export interface DeployArtifact {
  /** HTML do bundle estatico. */
  html: string;
  /** Um unico zip, com tudo que o navegador precisa. */
  zip: Uint8Array;
  entry: string;
  fileCount: number;
  bytes: number;
  /** Avisos que nao impedem o deploy. */
  warnings: string[];
}

export interface DeployPlan {
  target: DeployTarget;
  label: string;
  description: string;
  /** Precisa de acao manual do usuario? */
  manual: boolean;
  instructions: string[];
}

export const DEPLOY_PLANS: DeployPlan[] = [
  {
    target: 'zip',
    label: 'ZIP para upload manual',
    description: 'Gera um .zip estatico pronto para qualquer hospedagem.',
    manual: false,
    instructions: [
      'Baixe o arquivo .zip',
      'Descompacte',
      'Envie o conteudo para a pasta publica do seu host',
      'O .htaccess vai junto e ja resolve SPA + cache',
    ],
  },
  {
    target: 'hostinger',
    label: 'Hostinger (FTP)',
    description: 'Comandos rsync/scp para subir direto por FTP/SSH.',
    manual: true,
    instructions: [
      'Use o arquivo .zip gerado',
      'Descompacte localmente',
      'rsync -avz ./ usuario@ftp.seudominio.com:/public_html/',
      'Ative HTTPS no hPanel -> Sites -> Performance',
    ],
  },
  {
    target: 'netlify-drop',
    label: 'Netlify Drop',
    description: 'Arrasta a pasta direto no painel da Netlify.',
    manual: true,
    instructions: [
      'Descompacte o .zip',
      'Abra app.netlify.com/drop',
      'Arraste a pasta',
      'Voce recebe uma URL publica immediately',
    ],
  },
  {
    target: 'github-pages',
    label: 'GitHub Pages',
    description: 'Publica o estatico a partir de um repositorio.',
    manual: true,
    instructions: [
      'Descompacte o .zip',
      'Commite na branch gh-pages',
      'Settings -> Pages -> Deploy from a branch -> gh-pages',
      'Aguarde o build (1-3 minutos)',
    ],
  },
];

const IGNORED = new Set(['node_modules', '.git', '.next', '.weaver', '.env', '.env.local']);

export interface BuildOptions {
  /** Injeta o bundle do bundler local no HTML. */
  transformEntry?: boolean;
  includeHiddenFiles?: boolean;
}

/**
 * Produz um artefato publicavel: HTML pronto + zip.
 *
 * Deliberadamente NAO inclui node_modules nem .env - quem publica o
 * bundle estatico nao precisa das dependencias de desenvolvimento,
 * e vaza-las seria inseguro.
 */
export async function buildDeployArtifact(options: BuildOptions = {}): Promise<DeployArtifact> {
  const warnings: string[] = [];
  const files = await vfs().listFiles();

  const publishable = files.filter((f) => {
    const parts = f.path.split('/');
    if (parts.some((p) => IGNORED.has(p))) return false;
    if (!options.includeHiddenFiles && parts.some((p) => p.startsWith('.') && p !== '.htaccess' && p !== '.nojekyll')) return false;
    return f.content !== null || f.size < 8 * 1024 * 1024;
  });

  const sources = await Promise.all(
    publishable.map(async (f) => ({ path: f.path, bytes: (await vfs().readBytes(f.path)) ?? new Uint8Array(0) })),
  );

  let entry = 'index.html';
  if (!sources.some((s) => s.path === 'index.html')) {
    const firstHtml = sources.find((s) => s.path.endsWith('.html'));
    if (firstHtml) {
      entry = firstHtml.path;
      warnings.push(`Nao havia index.html na raiz; usei ${entry}. Adicione um index.html para nao depender disso.`);
    } else {
      warnings.push('O projeto nao tem nenhum arquivo HTML. Nada a publicar.');
    }
  }

  const needsBundle = sources.some((s) => /\.(tsx?|jsx?)$/i.test(s.path) && !s.path.startsWith('node_modules/'));
  if (needsBundle && !options.transformEntry) {
    warnings.push('O projeto tem TSX/JSX. Habilite o bundler no preview para gerar JS antes de publicar.');
  }

  const zip = await createZip(sources);

  const entryFile = files.find((f) => f.path === entry);
  return {
    html: entryFile?.content ?? '',
    zip,
    entry,
    fileCount: sources.length,
    bytes: zip.byteLength,
    warnings,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function downloadArtifact(artifact: DeployArtifact, projectName: string): void {
  const blob = new Blob([artifact.zip as unknown as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectName || 'projeto'}-estatico.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

/** O que seria publicado, para o usuario revisar antes de enviar. */
export interface DeployPreview {
  files: Array<{ path: string; bytes: number }>;
  excluded: Array<{ path: string; reason: string }>;
  totalBytes: number;
}

export async function previewDeploy(): Promise<DeployPreview> {
  const files = await vfs().listFiles();
  const included: DeployPreview['files'] = [];
  const excluded: DeployPreview['excluded'] = [];

  for (const f of files) {
    const parts = f.path.split('/');
    if (parts.some((p) => IGNORED.has(p))) {
      excluded.push({ path: f.path, reason: 'dependencia/configuracao local' });
      continue;
    }
    if (parts.some((p) => p.startsWith('.') && p !== '.htaccess' && p !== '.nojekyll')) {
      excluded.push({ path: f.path, reason: 'arquivo oculto' });
      continue;
    }
    included.push({ path: f.path, bytes: f.size });
  }

  return {
    files: included.sort((a, b) => b.bytes - a.bytes),
    excluded: excluded.sort((a, b) => a.path.localeCompare(b.path)),
    totalBytes: included.reduce((acc, f) => acc + f.bytes, 0),
  };
}

/** Snapshot antes do deploy, para permitir voltar. */
export async function commitBeforeDeploy(message: string): Promise<string | null> {
  const before = await head();
  const changes = await diffAgainst(before);
  if (changes.length === 0) return before?.hash ?? null;
  const mod = await import('../git/repo');
  const { commit } = await mod.commit(message, 'arcanum');
  return commit?.hash ?? null;
}