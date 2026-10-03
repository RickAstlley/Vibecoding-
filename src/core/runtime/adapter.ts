/**
 * Contrato de execucao de codigo.
 *
 * O Arcanum Weaver roda 100% no browser, entao "executar" tem duas respostas
 * possiveis e o resto do app nao deve saber qual esta em uso:
 *
 *  - `local`: WebContainer (Node de verdade em WASM, dentro da aba)
 *  - `remote`: endpoint HTTP que executa do outro lado
 *  - `none`: sem execucao; o preview estatico continua funcionando
 */

export type RuntimeKind = 'none' | 'local' | 'remote';

export interface ExecRequest {
  /** Linguagem do comando. */
  language: 'bash' | 'node' | 'python' | 'auto';
  /** Comando ou codigo a executar. */
  command: string;
  /** Timeout em ms. */
  timeoutMs?: number;
  /** Variaveis de ambiente. */
  env?: Record<string, string>;
  /** Directorio de trabalho, relativo a raiz do projeto. */
  cwd?: string;
  /** Grava isto no stdin antes de rodar. */
  stdin?: string;
}

export interface ExecChunk {
  kind: 'stdout' | 'stderr' | 'system';
  text: string;
  ts: number;
}

export interface ExecResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  chunks: ExecChunk[];
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Execucao abortada por timeout ou pelo usuario. */
  timedOut: boolean;
  error?: string;
}

export interface RuntimeStatus {
  kind: RuntimeKind;
  ready: boolean;
  booting: boolean;
  /** Motivo pelo qual nao esta disponivel. */
  unavailableReason: string | null;
  /** Detalhes especificos da implementacao. */
  detail: string | null;
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  status(): RuntimeStatus;
  /** Prepara o ambiente. Deve ser idempotente. */
  boot(): Promise<RuntimeStatus>;
  /** Escreve o projeto no ambiente de execucao. */
  sync(files: Array<{ path: string; content: string }>): Promise<void>;
  exec(request: ExecRequest): Promise<ExecResult>;
  /** Instala dependencias do projeto. */
  install(): Promise<ExecResult>;
  /** Envia um comando ao terminal interativo. */
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onChunk(handler: (chunk: ExecChunk) => void): () => void;
  destroy(): Promise<void>;
}

export const UNSUPPORTED_HINT =
  'Execucao desativada. Use o preview estatico ou ative um runtime nas configuracoes.';

/** Junta os chunks em texto, separando streams. */
export function collect(chunks: ExecChunk[]): { stdout: string; stderr: string } {
  const stdout = chunks
    .filter((c) => c.kind === 'stdout')
    .map((c) => c.text)
    .join('');
  const stderr = chunks
    .filter((c) => c.kind === 'stderr')
    .map((c) => c.text)
    .join('');
  return { stdout, stderr };
}

/** Detecta a linguagem a partir do comando, para highlight e sandbox. */
export function detectLanguage(command: string, declared: ExecRequest['language']): ExecRequest['language'] {
  if (declared !== 'auto') return declared;
  const trimmed = command.trim();
  if (/^(python3?|pip3?)\s/.test(trimmed)) return 'python';
  if (/^(node|npm|npx|yarn|pnpm|bun)\s/.test(trimmed)) return 'node';
  return 'bash';
}

/** Verifica se o ambiente pode rodar WebContainer: exige Isolamento de origem. */
export function crossOriginIsolated(): boolean {
  return typeof globalThis !== 'undefined' && globalThis.crossOriginIsolated === true;
}

export function isolationMissingHeaders(): { coep: string; coop: string } {
  return {
    coep: 'Cross-Origin-Embedder-Policy: require-corp',
    coop: 'Cross-Origin-Opener-Policy: same-origin',
  };
}