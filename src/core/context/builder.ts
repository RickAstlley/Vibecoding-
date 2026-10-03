import { compressPrompt, extractLineRefs, type CompressOptions, type CompressResult } from '../compress/pipeline';
import { detectLanguage } from '../vfs/file';
import { estimateTokens } from '@/lib/tokens';
import { buildImportGraph, rankFiles, type RankableFile } from './ranker';

export interface BudgetConfig {
  contextWindow: number;
  systemShare: number;
  userShare: number;
  codeShare: number;
  historyShare: number;
  outputReserve: number;
}

export const DEFAULT_BUDGET: BudgetConfig = {
  contextWindow: 128000,
  systemShare: 0.15,
  userShare: 0.2,
  codeShare: 0.5,
  historyShare: 0.1,
  outputReserve: 0.05,
};

export interface ContextFileReport {
  path: string;
  score: number;
  reasons: string[];
  tokensRaw: number;
  tokensSent: number;
  compressed: boolean;
  level: 'full' | 'compressed' | 'sketch' | 'omitted';
}

export interface BuildContextInput {
  question: string;
  files: RankableFile[];
  systemPrompt: string;
  history: Array<{ role: string; content: string }>;
  budget?: Partial<BudgetConfig>;
  compress?: CompressOptions;
  activePath?: string | null;
  forcePaths?: string[];
  enableCompression?: boolean;
}

export interface BuildContextResult {
  system: string;
  userBlock: string;
  history: Array<{ role: string; content: string }>;
  reports: ContextFileReport[];
  tokensSystem: number;
  tokensUser: number;
  tokensCode: number;
  tokensHistory: number;
  tokensTotal: number;
  savedPercent: number;
  budgetTotal: number;
  includedPaths: string[];
  omittedPaths: string[];
}

function fence(path: string, content: string): string {
  const ext = path.split('.').pop() ?? '';
  return `--- ${path} ---\n\`\`\`${ext}\n${content}\n\`\`\``;
}

export function buildContext(input: BuildContextInput): BuildContextResult {
  const budget = { ...DEFAULT_BUDGET, ...input.budget };
  const count = estimateTokens;

  const codeBudget = Math.floor(budget.contextWindow * budget.codeShare);
  const userBudget = Math.floor(budget.contextWindow * budget.userShare);
  const historyBudget = Math.floor(budget.contextWindow * budget.historyShare);

  const graph = buildImportGraph(input.files);
  const ranked = rankFiles(input.files, input.question, graph);

  const forced = new Set(input.forcePaths ?? []);
  const ordered = [
    ...ranked.filter((f) => forced.has(f.path)),
    ...ranked.filter((f) => !forced.has(f.path)),
  ];

  const focusAll = extractLineRefs(input.question);
  const reports: ContextFileReport[] = [];
  const blocks: string[] = [];
  let used = 0;
  const included: string[] = [];
  const omitted: string[] = [];

  for (const file of ordered) {
    const isForced = forced.has(file.path);
    const isActive = input.activePath === file.path;
    const tokensRaw = count(file.content);

    if (isForced || isActive || file.score > 0) {
      if (used + tokensRaw <= codeBudget || isForced) {
        blocks.push(fence(file.path, file.content));
        used += tokensRaw;
        included.push(file.path);
        reports.push({ path: file.path, score: file.score, reasons: file.reasons, tokensRaw, tokensSent: tokensRaw, compressed: false, level: 'full' });
        continue;
      }
    }

    if (input.enableCompression === false) {
      omitted.push(file.path);
      reports.push({ path: file.path, score: file.score, reasons: file.reasons, tokensRaw, tokensSent: 0, compressed: false, level: 'omitted' });
      continue;
    }

    if (used >= codeBudget && !isForced) {
      omitted.push(file.path);
      reports.push({ path: file.path, score: file.score, reasons: file.reasons, tokensRaw, tokensSent: 0, compressed: false, level: 'omitted' });
      continue;
    }

    const remaining = codeBudget - used;
    const language = detectLanguage(file.path);
    const focus = isActive || isForced ? focusAll : [];
    const result: CompressResult = compressPrompt(
      file.content,
      language,
      { ...input.compress, focusLines: focus, perFileBudget: remaining },
      count,
    );

    if (result.tokensAfter === 0) {
      omitted.push(file.path);
      reports.push({ path: file.path, score: file.score, reasons: file.reasons, tokensRaw, tokensSent: 0, compressed: true, level: 'omitted' });
      continue;
    }

    if (result.tokensAfter > remaining && !isForced) {
      omitted.push(file.path);
      reports.push({ path: file.path, score: file.score, reasons: file.reasons, tokensRaw, tokensSent: 0, compressed: true, level: 'omitted' });
      continue;
    }

    blocks.push(fence(file.path, result.text));
    used += result.tokensAfter;
    included.push(file.path);
    reports.push({
      path: file.path,
      score: file.score,
      reasons: file.reasons,
      tokensRaw,
      tokensSent: result.tokensAfter,
      compressed: result.tokensAfter < tokensRaw,
      level: result.savedPercent > 50 ? 'sketch' : 'compressed',
    });
  }

  const history: Array<{ role: string; content: string }> = [];
  let historyTokens = 0;
  for (let i = input.history.length - 1; i >= 0; i--) {
    const msg = input.history[i];
    if (!msg) continue;
    const t = count(msg.content);
    if (historyTokens + t > historyBudget) break;
    history.unshift(msg);
    historyTokens += t;
  }

  const question = input.question.length > userBudget * 4 ? input.question.slice(0, userBudget * 4) : input.question;

  const userBlock = [
    `## Arquivos do projeto (${included.length} de ${input.files.length})`,
    '',
    blocks.join('\n\n'),
    '',
    '## Tarefa',
    question,
  ].join('\n');

  const tokensSystem = count(input.systemPrompt);
  const tokensUser = count(userBlock);
  const tokensCode = reports.reduce((acc, r) => acc + r.tokensSent, 0);
  const tokensTotal = tokensSystem + tokensUser + historyTokens;
  const rawTotal = reports.reduce((acc, r) => acc + r.tokensRaw, 0) + tokensSystem + tokensUser + historyTokens;

  return {
    system: input.systemPrompt,
    userBlock,
    history,
    reports,
    tokensSystem,
    tokensUser,
    tokensCode,
    tokensHistory: historyTokens,
    tokensTotal,
    savedPercent: rawTotal > 0 ? Math.max(0, Math.round((1 - tokensTotal / rawTotal) * 100)) : 0,
    budgetTotal: budget.contextWindow,
    includedPaths: included,
    omittedPaths: omitted,
  };
}

export function contextFits(result: BuildContextResult, reserveOutput = 8000): boolean {
  return result.tokensTotal + reserveOutput <= result.budgetTotal;
}
