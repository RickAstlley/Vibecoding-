import type { PatchApplied, PatchLevel } from '../patch/surgical';

export type ApplyDecision = 'fast' | 'review';

export interface FastApplyConfig {
  /** Liga o modo fast apply. */
  enabled: boolean;
  /** Acima deste total de linhas alteradas, sempre mostra diff. */
  maxLines: number;
  /** Nivel de patch que nunca entra em modo fast. */
  alwaysReviewLevels: PatchLevel[];
  /** Salva checkpoint automaticamente antes de aplicar. */
  checkpointBefore: boolean;
}

export const DEFAULT_FAST_APPLY: FastApplyConfig = {
  enabled: true,
  maxLines: 12,
  alwaysReviewLevels: ['file'],
  checkpointBefore: true,
};

export interface DecisionInput {
  level: PatchLevel;
  linesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  createsFile: boolean;
  deletesContent: boolean;
  config?: FastApplyConfig;
}

export interface Decision {
  apply: ApplyDecision;
  reason: string;
}

/**
 * Decide se o patch entra direto no arquivo (fast apply) ou se precisa de
 * revisao humana. Criterio: pequeno,Localized e nao destrutivo.
 */
export function decideApply(input: DecisionInput): Decision {
  const cfg = input.config ?? DEFAULT_FAST_APPLY;
  const linesChanged = input.linesAdded + input.linesRemoved;

  if (!cfg.enabled) {
    return { apply: 'review', reason: 'fast apply desativado' };
  }
  if (cfg.alwaysReviewLevels.includes(input.level)) {
    return { apply: 'review', reason: `patch de nivel "${input.level}" sempre pede revisao` };
  }
  if (input.createsFile) {
    return { apply: 'review', reason: 'cria arquivo novo' };
  }
  if (input.deletesContent && linesChanged > 2) {
    return { apply: 'review', reason: 'remove mais de 2 linhas' };
  }
  if (linesChanged > cfg.maxLines) {
    return { apply: 'review', reason: `${linesChanged} linhas alteradas, acima do limite de ${cfg.maxLines}` };
  }
  return { apply: 'fast', reason: `${linesChanged} linha(s), patch pequeno` };
}

export function isFast(patch: PatchApplied, config?: FastApplyConfig): boolean {
  const linesChanged = patch.linesAdded + patch.linesRemoved;
  return decideApply({
    level: patch.level,
    linesChanged,
    linesAdded: patch.linesAdded,
    linesRemoved: patch.linesRemoved,
    createsFile: patch.before === '',
    deletesContent: patch.linesRemoved > 0,
    config,
  }).apply === 'fast';
}

export interface Checkpoint {
  id: string;
  runId: string;
  seq: number;
  label: string;
  createdAt: number;
  /** Estado do projeto no momento do checkpoint, para rewind. */
  files: Array<{ path: string; content: string | null; hash: string }>;
  tokensAtCheckpoint: number;
}

export interface CheckpointStore {
  save(cp: Checkpoint): Promise<void>;
  list(runId: string): Promise<Checkpoint[]>;
  get(id: string): Promise<Checkpoint | null>;
  clear(runId: string): Promise<void>;
}

/**
 * Guarda o estado de todos os arquivos do projeto antes de um passo, para
 * poder voltar o agente a um ponto anterior sem perder o resto da sessão.
 */
export async function createCheckpoint(
  runId: string,
  seq: number,
  label: string,
  tokensAtCheckpoint: number,
  readAll: () => Promise<Array<{ path: string; content: string | null; hash: string }>>,
): Promise<Checkpoint> {
  return {
    id: `cp_${runId}_${seq}_${Date.now().toString(36)}`,
    runId,
    seq,
    label,
    createdAt: Date.now(),
    files: await readAll(),
    tokensAtCheckpoint,
  };
}

/** Caminho de arquivos que diferem entre um checkpoint e o estado atual. */
export function diffAgainstCheckpoint(
  checkpoint: Checkpoint,
  current: Array<{ path: string; content: string | null; hash: string }>,
): { changed: string[]; added: string[]; removed: string[] } {
  const before = new Map(checkpoint.files.map((f) => [f.path, f.hash]));
  const after = new Map(current.map((f) => [f.path, f.hash]));

  const changed: string[] = [];
  const added: string[] = [];
  for (const [path, hash] of after) {
    if (!before.has(path)) added.push(path);
    else if (before.get(path) !== hash) changed.push(path);
  }
  const removed: string[] = [];
  for (const path of before.keys()) if (!after.has(path)) removed.push(path);

  return { changed, added, removed };
}