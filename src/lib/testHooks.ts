'use client';

import { vfs } from '@/core/vfs/vfs';
import { history } from '@/core/history/undo';
import { head, diffAgainst, listCommits, commit as gitCommit } from '@/core/git/repo';
import { ProjectIndex } from '@/core/rag';

export interface WeaverTestHooks {
  vfs: typeof vfs;
  history: typeof history;
  git: {
    head: typeof head;
    diff: typeof diffAgainst;
    list: typeof listCommits;
    commit: typeof gitCommit;
  };
  rag: ProjectIndex;
}

declare global {
  interface Window {
    __weaver?: WeaverTestHooks;
  }
}

/**
 * Expoe os nucleos do app em `window.__weaver`.
 *
 * Os testes E2E precisam falar com o IndexedDB e com o historico de dentro
 * da pagina. Importar os modulos TS por URL nao funciona no dev server do
 * Next (ele nao serve caminhos de fonte arbitrarios), entao o gancho e
 * instalado aqui.
 *
 * Tambem util no console do navegador para depurar sem abrir cinco abas
 * diferentes no DevTools.
 */
export function installTestHooks(): void {
  if (typeof window === 'undefined') return;
  window.__weaver = {
    vfs,
    history,
    git: { head, diff: diffAgainst, list: listCommits, commit: gitCommit },
    rag: new ProjectIndex(),
  };
}

export function uninstallTestHooks(): void {
  if (typeof window === 'undefined') return;
  delete window.__weaver;
}