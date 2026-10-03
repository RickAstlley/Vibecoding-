import { RemoteRuntime, type RemoteRuntimeConfig } from './remote';
import { LocalRuntime, type LocalRuntimeConfig } from './local';
import type { RuntimeAdapter, RuntimeKind } from './adapter';
import type { ToolDef } from '@/core/ia/client';

export type { RuntimeAdapter, RuntimeKind, ExecRequest, ExecResult, ExecChunk, RuntimeStatus } from './adapter';
export { RemoteRuntime } from './remote';
export { LocalRuntime } from './local';

export interface RuntimeConfig {
  kind: RuntimeKind;
  remote: RemoteRuntimeConfig;
  local: LocalRuntimeConfig;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  kind: 'none',
  remote: { baseUrl: '', timeoutMs: 60_000 },
  local: { timeoutMs: 60_000, autoSync: true },
};

/**
 * Escolhe a implementacao conforme a configuracao. `none` devolve um adapter
 * inerte: o app inteiro continua funcionando, so nao executa codigo.
 */
export function createRuntime(config: RuntimeConfig): RuntimeAdapter {
  switch (config.kind) {
    case 'remote':
      return new RemoteRuntime(config.remote);
    case 'local':
      return new LocalRuntime(config.local);
    default:
      return new InertRuntime();
  }
}

/** Adapter que sempre falha educadamente, usado quando execucao esta off. */
class InertRuntime implements RuntimeAdapter {
  readonly kind: RuntimeKind = 'none';
  private handlers = new Set<(chunk: never) => void>();

  status() {
    return {
      kind: 'none' as const,
      ready: false,
      booting: false,
      unavailableReason: 'Execucao desativada nas configuracoes.',
      detail: null,
    };
  }

  async boot() {
    return this.status();
  }

  async sync(): Promise<void> {}

  async exec() {
    return {
      ok: false,
      exitCode: null,
      signal: null,
      chunks: [],
      stdout: '',
      stderr: '',
      durationMs: 0,
      timedOut: false,
      error: 'execucao desativada',
    };
  }

  async install() {
    return this.exec();
  }

  write(): void {}
  resize(): void {}
  onChunk(handler: (chunk: never) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  async destroy(): Promise<void> {
    this.handlers.clear();
  }
}

/* ------------------------------------------------------- ferramentas do agente */

export const EXEC_TOOL: ToolDef = {
  name: 'run_command',
  description:
    'Executa um comando no ambiente do projeto (npm test, npm run build, node script.js, python -c ...). ' +
    'Use para VERIFICAR que a mudanca funciona: rode os testes, o build, ou um script. ' +
    'Retorna stdout, stderr e codigo de saida. Leia o resultado antes de concluir que terminou.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Comando a executar, ex.: "npm test"' },
      timeoutMs: { type: 'number', description: 'Timeout em ms (padrao 60000)' },
    },
    required: ['command'],
  },
};

export const INSTALL_TOOL: ToolDef = {
  name: 'install_dependencies',
  description: 'Roda "npm install" no projeto. Use quando faltar dependencia.',
  parameters: { type: 'object', properties: {}, required: [] },
};

export const RUNTIME_INSTRUCTIONS = `
Voce tem acesso a execucao real do projeto pela ferramenta run_command.
Antes de dizer que terminou, rode o comando que comprova: testes, build, ou
o proprio script. Se o comando falhar, leia o stderr e corrija.
`.trim();

export function toolsForRuntime(adapter: RuntimeAdapter): ToolDef[] {
  if (adapter.kind === 'none') return [];
  return [EXEC_TOOL, INSTALL_TOOL];
}

export interface RuntimeToolContext {
  exec(command: string, timeoutMs?: number): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string }>;
  install(): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string }>;
}

export async function runRuntimeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: RuntimeToolContext,
): Promise<{ ok: boolean; summary: string }> {
  if (name === 'run_command') {
    const command = String(args.command ?? '').trim();
    if (!command) return { ok: false, summary: 'Comando vazio.' };
    const r = await ctx.exec(command, typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined);
    const parts = ['exit code: ' + (r.exitCode ?? 'n/a')];
    if (r.stdout.trim()) parts.push(`stdout:\n${r.stdout.slice(-3000)}`);
    if (r.stderr.trim()) parts.push(`stderr:\n${r.stderr.slice(-3000)}`);
    if (r.error) parts.push(`erro: ${r.error}`);
    return { ok: r.ok, summary: `$ ${command}\n${parts.join('\n')}` };
  }

  if (name === 'install_dependencies') {
    const r = await ctx.install();
    const parts = ['exit code: ' + (r.exitCode ?? 'n/a')];
    if (r.stdout.trim()) parts.push(`stdout:\n${r.stdout.slice(-2000)}`);
    if (r.stderr.trim()) parts.push(`stderr:\n${r.stderr.slice(-2000)}`);
    if (r.error) parts.push(`erro: ${r.error}`);
    return { ok: r.ok, summary: `npm install\n${parts.join('\n')}` };
  }

  return { ok: false, summary: `Ferramenta desconhecida: ${name}` };
}
