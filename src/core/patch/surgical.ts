import { detectLanguage } from '../vfs/file';
import { sha256Hex } from '@/lib/hash';
import { applyLinePatch, type LineOp, type LinePatchResult } from './line-edit';
import { AnchorError, applyAnchorOp, extractAnchors, reanchor, type Anchor, type AnchorOp } from './anchors';
import { verifySource, verifySourceAsync, type VerifyResult } from './verify';

export type PatchLevel = 'line' | 'anchor' | 'file';

export type PatchRequest =
  | { level: 'line'; path: string; ops: LineOp[]; note?: string; patchId?: string }
  | { level: 'anchor'; path: string; op: AnchorOp; note?: string; patchId?: string }
  | { level: 'file'; path: string; content: string; note?: string; patchId?: string };

export interface PatchApplied {
  patchId: string;
  level: PatchLevel;
  path: string;
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
  changedLines: number[];
  linesAdded: number;
  linesRemoved: number;
  verified: boolean;
  verifyIssues: string[];
  reverted: boolean;
  durationMs: number;
}

export class PatchRejection extends Error {
  constructor(message: string, readonly code: string, readonly detail?: unknown) {
    super(message);
    this.name = 'PatchRejection';
  }
}

export interface SurgicalContext {
  /** Le o arquivo alvo. Retorna null se nao existir (criacao). */
  read(path: string): Promise<string | null>;
  /** Escreve o arquivo alvo. */
  write(path: string, content: string, patchId: string, note: string): Promise<void>;
  /** Hash atual do arquivo. */
  hash(path: string): Promise<string | null>;
  /** Verifica se o arquivo existe. */
  exists(path: string): Promise<boolean>;
}

let counter = 0;
export function newPatchId(): string {
  counter = (counter + 1) % 1_000_000;
  return `p${Date.now().toString(36)}${counter.toString(36)}`;
}

function countLines(text: string): number {
  return text === '' ? 0 : text.split('\n').length;
}

/**
 * Garante a regra inviolavel: um patch toca exatamente UM arquivo.
 * Se a IA tentar varios, o runtime rejeita antes de escrever qualquer coisa.
 */
export function assertSingleFile(paths: string[]): void {
  const unique = new Set(paths);
  if (unique.size > 1) {
    throw new PatchRejection(
      `Patch Surgical aceita apenas 1 arquivo por operacao, mas foram enviados ${unique.size}: ${[...unique].join(', ')}`,
      'multi-file-forbidden',
      [...unique],
    );
  }
  if (unique.size === 0) {
    throw new PatchRejection('Patch Surgical requer ao menos 1 arquivo', 'empty-target');
  }
}

export interface ApplyOptions {
  /** Reverte automaticamente se a verificacao falhar. Padrao: true. */
  autoRevert?: boolean;
  /** Pular verificacao. Padrao: false. */
  skipVerify?: boolean;
}

export async function applySurgicalPatch(
  request: PatchRequest,
  ctx: SurgicalContext,
  options: ApplyOptions = {},
): Promise<PatchApplied> {
  const started = Date.now();
  assertSingleFile([request.path]);
  const patchId = request.patchId ?? newPatchId();
  const autoRevert = options.autoRevert ?? true;
  const skipVerify = options.skipVerify ?? false;

  const before = (await ctx.read(request.path)) ?? '';
  const beforeHash = await ctx.hash(request.path);
  const kind = detectLanguage(request.path);
  const existed = await ctx.exists(request.path);

  let result: LinePatchResult | { after: string; appliedAt?: number };

  switch (request.level) {
    case 'line': {
      result = applyLinePatch(before, request.ops);
      break;
    }
    case 'anchor': {
      const anchors = extractAnchors(request.path, before);
      try {
        result = applyAnchorOp(before, anchors, request.op);
      } catch (e) {
        if (e instanceof AnchorError) {
          throw new PatchRejection(e.message, `anchor-${e.code}`, { anchors: anchors.map((a) => a.id) });
        }
        throw e;
      }
      break;
    }
    case 'file': {
      result = { after: request.content };
      break;
    }
  }

  const after = result.after;

  if (after === before) {
    throw new PatchRejection(`Patch nao altera nada em ${request.path}`, 'no-op');
  }

  const verify: VerifyResult =
    skipVerify || kind === 'binary'
      ? { ok: true, issues: [], balanced: true, kind: 'text' }
      : await verifySourceAsync(request.path, after, kind as VerifyResult['kind']);
  const verifyMessages = verify.issues.map((i) => `${i.severity}: ${i.message}${i.line ? ` (linha ${i.line})` : ''}`);

  if (!verify.ok) {
    if (autoRevert && existed) {
      await ctx.write(request.path, before, patchId, `revert: ${verifyMessages[0] ?? 'verificacao falhou'}`);
    }
    throw new PatchRejection(
      `Patch em ${request.path} quebrou a sintaxe e foi revertido: ${verifyMessages.join('; ')}`,
      'verify-failed',
      { issues: verifyMessages, reverted: autoRevert && existed },
    );
  }

  await ctx.write(request.path, after, patchId, request.note ?? describeRequest(request));

  const afterHash = await sha256Hex(after);
  const changedLines =
    request.level === 'line'
      ? (result as LinePatchResult).changedLines
      : changedLineNumbers(before, after);

  return {
    patchId,
    level: request.level,
    path: request.path,
    before,
    after,
    beforeHash: beforeHash ?? (await sha256Hex(before)),
    afterHash,
    changedLines,
    linesAdded: Math.max(0, countLines(after) - countLines(before)),
    linesRemoved: Math.max(0, countLines(before) - countLines(after)),
    verified: !skipVerify,
    verifyIssues: verifyMessages,
    reverted: false,
    durationMs: Date.now() - started,
  };
}

function describeRequest(r: PatchRequest): string {
  // o caminho entra no rotulo: sem ele o historico mostrava apenas
  // "line-edit: replace" e nao dava para saber qual arquivo mudou
  const what = (() => {
    switch (r.level) {
      case 'line':
        return `line-edit: ${r.ops.map((o) => o.kind).join(', ')}`;
      case 'anchor':
        return `anchor-edit: ${r.op.kind} @ ${r.op.anchor}`;
      case 'file':
        return 'file-rewrite';
    }
  })();
  return `${what} em ${r.path}`;
}

export function changedLineNumbers(before: string, after: string): number[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const max = Math.max(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) out.push(i + 1);
  }
  return out;
}

export function summarizePatch(p: PatchApplied): string {
  const verb = p.level === 'line' ? 'edicao de linha' : p.level === 'anchor' ? 'edicao ancorada' : 'reescrita';
  const scope = p.changedLines.length > 0 ? `linhas ${p.changedLines.slice(0, 8).join(', ')}${p.changedLines.length > 8 ? '...' : ''}` : 'conteudo';
  return `${verb} em ${p.path} (${scope}, +${p.linesAdded}/-${p.linesRemoved})`;
}

export { applyLinePatch, extractAnchors, reanchor, verifySource, verifySourceAsync };
export type { Anchor, AnchorOp, LineOp };
