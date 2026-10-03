import {
  collect,
  detectLanguage,
  UNSUPPORTED_HINT,
  type ExecChunk,
  type ExecRequest,
  type ExecResult,
  type RuntimeAdapter,
  type RuntimeKind,
  type RuntimeStatus,
} from './adapter';

export interface RemoteRuntimeConfig {
  /** URL base do endpoint que executa, ex.: "https://meu-executor.dev". */
  baseUrl: string;
  /** Token de autenticacao do endpoint. */
  token?: string;
  /** Tempo maximo de execucao no servidor, em ms. */
  timeoutMs?: number;
  /** Faz cada requisicao em uma sessao isolada. */
  ephemeral?: boolean;
}

/**
 * Executa comandos num endpoint HTTP. E a via que roda Node/Python de verdade
 * sem exigir nada do usuario alem de um servidor.
 *
 * Protocolo esperado (contrato minimo, facil de implementar em qualquer backend):
 *   POST {base}/exec   { command, language, cwd, env, stdin } -> { code, stdout, stderr }
 *   POST {base}/sync   { files: [{path, content}] }          -> { ok }
 */
export class RemoteRuntime implements RuntimeAdapter {
  readonly kind: RuntimeKind = 'remote';
  private handlers = new Set<(chunk: ExecChunk) => void>();
  private destroyed = false;

  constructor(private readonly config: RemoteRuntimeConfig) {}

  status(): RuntimeStatus {
    const hasUrl = Boolean(this.config.baseUrl && this.config.baseUrl.trim().length > 0);
    return {
      kind: 'remote',
      ready: hasUrl && !this.destroyed,
      booting: false,
      unavailableReason: hasUrl ? null : 'Configure a URL do executor nas configuracoes.',
      detail: hasUrl ? this.config.baseUrl : null,
    };
  }

  async boot(): Promise<RuntimeStatus> {
    return this.status();
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
    return headers;
  }

  async sync(files: Array<{ path: string; content: string }>): Promise<void> {
    if (!this.status().ready) return;
    const res = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/sync`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ files, ephemeral: this.config.ephemeral !== false }),
    });
    if (!res.ok) {
      throw new Error(`Falha ao sincronizar projeto: HTTP ${res.status}`);
    }
  }

  async exec(request: ExecRequest): Promise<ExecResult> {
    const started = Date.now();
    const chunks: ExecChunk[] = [];

    if (!this.status().ready) {
      return {
        ok: false,
        exitCode: null,
        signal: null,
        chunks: [{ kind: 'system', text: UNSUPPORTED_HINT, ts: started }],
        stdout: '',
        stderr: '',
        durationMs: 0,
        timedOut: false,
        error: 'runtime indisponivel',
      };
    }

    const controller = new AbortController();
    const timeout = request.timeoutMs ?? this.config.timeoutMs ?? 60_000;
    const timer = setTimeout(() => controller.abort(), timeout);

    const emit = (kind: ExecChunk['kind'], text: string): void => {
      if (!text) return;
      const chunk: ExecChunk = { kind, text, ts: Date.now() };
      chunks.push(chunk);
      for (const fn of this.handlers) fn(chunk);
    };

    try {
      const res = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/exec`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          command: request.command,
          language: detectLanguage(request.command, request.language),
          cwd: request.cwd ?? '/workspace',
          env: request.env ?? {},
          stdin: request.stdin ?? '',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const message = `HTTP ${res.status}: ${body.slice(0, 300)}`;
        emit('stderr', message);
        return {
          ok: false,
          exitCode: null,
          signal: null,
          chunks,
          stdout: '',
          stderr: message,
          durationMs: Date.now() - started,
          timedOut: false,
          error: message,
        };
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('event-stream')) {
        const json = (await res.json()) as { code?: number; stdout?: string; stderr?: string; signal?: string };
        emit('stdout', json.stdout ?? '');
        emit('stderr', json.stderr ?? '');
        return {
          ok: (json.code ?? 0) === 0,
          exitCode: json.code ?? 0,
          signal: json.signal ?? null,
          chunks,
          ...collect(chunks),
          durationMs: Date.now() - started,
          timedOut: false,
        };
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const evt = JSON.parse(payload) as { kind?: ExecChunk['kind']; text?: string; code?: number };
              if (evt.kind === 'system') emit('system', evt.text ?? '');
              else emit(evt.kind === 'stderr' ? 'stderr' : 'stdout', evt.text ?? '');
              if (typeof evt.code === 'number') {
                return {
                  ok: evt.code === 0,
                  exitCode: evt.code,
                  signal: null,
                  chunks,
                  ...collect(chunks),
                  durationMs: Date.now() - started,
                  timedOut: false,
                };
              }
            } catch {
              emit('stdout', payload);
            }
          }
        }
      }

      return {
        ok: true,
        exitCode: 0,
        signal: null,
        chunks,
        ...collect(chunks),
        durationMs: Date.now() - started,
        timedOut: false,
      };
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      const message = aborted ? `Timeout apos ${Math.round(timeout / 1000)}s` : e instanceof Error ? e.message : String(e);
      emit('stderr', message);
      return {
        ok: false,
        exitCode: null,
        signal: null,
        chunks,
        ...collect(chunks),
        durationMs: Date.now() - started,
        timedOut: aborted,
        error: message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async install(): Promise<ExecResult> {
    const hasPackageJson = await this.status().ready;
    if (!hasPackageJson) {
      return this.exec({ command: 'echo "sem package.json"', language: 'bash' });
    }
    return this.exec({ command: 'npm install', language: 'node', timeoutMs: 300_000 });
  }

  write(): void {
    /* Endpoint remoto nao mantem terminal interativo. */
  }

  resize(): void {
    /* Sem terminal interativo. */
  }

  onChunk(handler: (chunk: ExecChunk) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.handlers.clear();
  }
}