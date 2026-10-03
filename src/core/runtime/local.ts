import {
  collect,
  crossOriginIsolated,
  detectLanguage,
  isolationMissingHeaders,
  UNSUPPORTED_HINT,
  type ExecChunk,
  type ExecRequest,
  type ExecResult,
  type RuntimeAdapter,
  type RuntimeKind,
  type RuntimeStatus,
} from './adapter';

/**
 * Runtime local: Node de verdade rodando em WebAssembly dentro da aba.
 *
 * Pre-requisito duro: a pagina precisa estar isolada de origem
 * (COEP/COOP), senao o SharedArrayBuffer nao existe e o WebContainer
 * nao sobe. Sem isso, esta classe fica indisponivel e o app cai no
 * runtime remoto - que e exatamente o motivo de existir a abstracao.
 */
export interface LocalRuntimeConfig {
  /** URL do pacote @webcontainer/api (CDN). */
  apiUrl?: string;
  /** Imagem do container. Se vazio, usa a padrao da StackBlitz. */
  imageUrl?: string;
  timeoutMs?: number;
  /** Monta o projeto inteiro no boot. */
  autoSync?: boolean;
}

const DEFAULT_API_URL = 'https://esm.sh/@webcontainer/api@1.6.1?bundle';

interface WebContainerLike {
  boot(): Promise<void>;
  mount(mounts: Array<{ type: 'file'; path: string; file: { contents: string } }>): Promise<void>;
  spawn(command: string, args?: string[]): Promise<{
    input: { write(s: string): void; close(): void };
    output: ReadableStream<string>;
    exit: Promise<number>;
  }>;
  teardown(): void;
}

export class LocalRuntime implements RuntimeAdapter {
  readonly kind: RuntimeKind = 'local';
  private handlers = new Set<(chunk: ExecChunk) => void>();
  private container: WebContainerLike | null = null;
  private booting = false;
  private bootPromise: Promise<void> | null = null;
  private reason: string | null = null;
  private lastCommand = '';

  constructor(private readonly config: LocalRuntimeConfig = {}) {}

  status(): RuntimeStatus {
    return {
      kind: 'local',
      ready: this.container !== null,
      booting: this.booting,
      unavailableReason: this.reason,
      detail: crossOriginIsolated() ? null : `Faltam cabecalhos de isolamento: ${isolationMissingHeaders().coop} e ${isolationMissingHeaders().coep}`,
    };
  }

  async boot(): Promise<RuntimeStatus> {
    if (this.container) return this.status();
    if (!crossOriginIsolated()) {
      this.reason =
        'O navegador nao isola a origem. Adicione COOP/COEP no servidor (o .htaccess do projeto ja traz) e recarregue.';
      return this.status();
    }
    if (this.booting) {
      await this.bootPromise;
      return this.status();
    }

    this.booting = true;
    this.reason = null;
    this.bootPromise = this.doBoot().finally(() => {
      this.booting = false;
      this.bootPromise = null;
    });

    await this.bootPromise;
    return this.status();
  }

  private async doBoot(): Promise<void> {
    const url = this.config.apiUrl ?? DEFAULT_API_URL;
    const mod = (await import(/* webpackIgnore: true */ url)) as { WebContainer: { boot(opts?: unknown): Promise<WebContainerLike> } };
    const options = this.config.imageUrl ? { imageUrl: this.config.imageUrl } : undefined;
    this.container = await mod.WebContainer.boot(options);
  }

  async sync(files: Array<{ path: string; content: string }>): Promise<void> {
    if (!this.container) return;
    if (files.length === 0) return;
    const mounts = files
      .filter((f) => f.content.length < 4 * 1024 * 1024)
      .map((f) => ({ type: 'file' as const, path: f.path, file: { contents: f.content } }));
    if (mounts.length === 0) return;
    await this.container.mount(mounts);
  }

  async exec(request: ExecRequest): Promise<ExecResult> {
    const started = Date.now();
    const chunks: ExecChunk[] = [];

    if (!this.container) {
      return {
        ok: false,
        exitCode: null,
        signal: null,
        chunks: [{ kind: 'system', text: UNSUPPORTED_HINT, ts: started }],
        stdout: '',
        stderr: '',
        durationMs: 0,
        timedOut: false,
        error: 'runtime nao iniciado',
      };
    }

    const emit = (kind: ExecChunk['kind'], text: string): void => {
      if (!text) return;
      const chunk: ExecChunk = { kind, text, ts: Date.now() };
      chunks.push(chunk);
      for (const fn of this.handlers) fn(chunk);
    };

    const { command, args } = splitCommand(request.command);
    this.lastCommand = request.command;

    const timeout = request.timeoutMs ?? this.config.timeoutMs ?? 60_000;
    let timedOut = false;

    try {
      const proc = await this.container.spawn(command, args);

      if (request.stdin) {
        proc.input.write(request.stdin);
        if (!request.command.includes('cat')) proc.input.close();
      }

      const reader = proc.output.getReader();

      const pump = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
          emit(text.includes('Error') || text.includes('error:') ? 'stderr' : 'stdout', text);
        }
      })();

      const exitPromise = proc.exit;
      const guard = new Promise<number>((_, reject) => {
        setTimeout(() => {
          timedOut = true;
          reject(new Error(`Timeout de ${Math.round(timeout / 1000)}s`));
        }, timeout);
      });

      const exitCode = await Promise.race([exitPromise, guard]);
      await pump;

      return {
        ok: exitCode === 0,
        exitCode,
        signal: null,
        chunks,
        ...collect(chunks),
        durationMs: Date.now() - started,
        timedOut,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      emit('stderr', message);
      return {
        ok: false,
        exitCode: null,
        signal: null,
        chunks,
        ...collect(chunks),
        durationMs: Date.now() - started,
        timedOut,
        error: message,
      };
    }
  }

  async install(): Promise<ExecResult> {
    return this.exec({ command: 'npm install', language: 'node', timeoutMs: 300_000 });
  }

  write(data: string): void {
    void data;
    /* Terminal interativo fica para a proxima iteracao. */
  }

  resize(): void {
    /* Sem terminal interativo por enquanto. */
  }

  onChunk(handler: (chunk: ExecChunk) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async destroy(): Promise<void> {
    this.container?.teardown();
    this.container = null;
    this.handlers.clear();
    this.lastCommand = '';
  }

  get lastExecuted(): string {
    return this.lastCommand;
  }
}

/** Quebra "npm run dev -- --port 3000" em ["npm", ["run","dev","--","--port","3000"]]. */
export function splitCommand(command: string): { command: string; args: string[] } {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const head = parts.shift() ?? '';
  return { command: head, args: parts };
}

export { detectLanguage };