import { describe, expect, it, vi } from 'vitest';
import { collect, crossOriginIsolated, detectLanguage, isolationMissingHeaders } from '@/core/runtime/adapter';
import { RemoteRuntime } from '@/core/runtime/remote';
import { splitCommand } from '@/core/runtime/local';
import { createRuntime, DEFAULT_RUNTIME_CONFIG, runRuntimeTool, toolsForRuntime, type RuntimeConfig } from '@/core/runtime';

function config(over: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return { ...DEFAULT_RUNTIME_CONFIG, ...over };
}

describe('adapter - helpers', () => {
  it('junta stdout e stderr separadamente', () => {
    const { stdout, stderr } = collect([
      { kind: 'stdout', text: 'a', ts: 1 },
      { kind: 'stderr', text: 'e', ts: 2 },
      { kind: 'stdout', text: 'b', ts: 3 },
      { kind: 'system', text: 'ignora', ts: 4 },
    ]);
    expect(stdout).toBe('ab');
    expect(stderr).toBe('e');
  });

  it('detecta linguagem a partir do comando', () => {
    expect(detectLanguage('npm test', 'auto')).toBe('node');
    expect(detectLanguage('npx vite', 'auto')).toBe('node');
    expect(detectLanguage('python -c "print(1)"', 'auto')).toBe('python');
    expect(detectLanguage('pip install x', 'auto')).toBe('python');
    expect(detectLanguage('ls -la', 'auto')).toBe('bash');
    expect(detectLanguage('ls', 'python')).toBe('python');
  });

  it('avisa quando o isolamento de origem falta', () => {
    expect(typeof crossOriginIsolated()).toBe('boolean');
    const headers = isolationMissingHeaders();
    expect(headers.coop).toContain('same-origin');
    expect(headers.coep).toContain('require-corp');
  });
});

describe('splitCommand', () => {
  it('separa comando e argumentos', () => {
    expect(splitCommand('npm run build')).toEqual({ command: 'npm', args: ['run', 'build'] });
    expect(splitCommand('  node   server.js  ')).toEqual({ command: 'node', args: ['server.js'] });
    expect(splitCommand('ls')).toEqual({ command: 'ls', args: [] });
    expect(splitCommand('')).toEqual({ command: '', args: [] });
  });
});

describe('createRuntime', () => {
  it('devolve runtime inerte quando kind = none', () => {
    const adapter = createRuntime(config());
    expect(adapter.kind).toBe('none');
    expect(adapter.status().ready).toBe(false);
    expect(adapter.status().unavailableReason).toContain('desativada');
  });

  it('devolve runtime remoto com url vazia como indisponivel', () => {
    const adapter = createRuntime(config({ kind: 'remote' }));
    expect(adapter.kind).toBe('remote');
    expect(adapter.status().ready).toBe(false);
    expect(adapter.status().unavailableReason).toContain('URL');
  });

  it('devolve runtime remoto pronto com url preenchida', () => {
    const adapter = createRuntime(config({ kind: 'remote', remote: { baseUrl: 'https://x.dev', timeoutMs: 1000 } }));
    expect(adapter.status().ready).toBe(true);
  });

  it('devolve runtime local', () => {
    const adapter = createRuntime(config({ kind: 'local' }));
    expect(adapter.kind).toBe('local');
  });

  it('runtime inerte nao executa nada', async () => {
    const adapter = createRuntime(config());
    const r = await adapter.exec({ command: 'ls', language: 'bash' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('desativada');
  });
});

describe('ferramentas de runtime', () => {
  it('nao expoe ferramentas quando kind = none', () => {
    expect(toolsForRuntime(createRuntime(config()))).toHaveLength(0);
  });

  it('expoe run_command e install quando há runtime', () => {
    const names = toolsForRuntime(createRuntime(config({ kind: 'remote', remote: { baseUrl: 'https://x.dev' } }))).map((t) => t.name);
    expect(names).toEqual(['run_command', 'install_dependencies']);
  });

  it('run_command formata stdout e exit code', async () => {
    const ctx = {
      exec: vi.fn(async () => ({ ok: false, stdout: '3 testes', stderr: 'falhou', exitCode: 1 })),
      install: vi.fn(async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })),
    };
    const r = await runRuntimeTool('run_command', { command: 'npm test' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('npm test');
    expect(r.summary).toContain('exit code: 1');
    expect(r.summary).toContain('3 testes');
    expect(r.summary).toContain('falhou');
    expect(ctx.exec).toHaveBeenCalledWith('npm test', undefined);
  });

  it('run_command repassa timeoutMs', async () => {
    const ctx = {
      exec: vi.fn(async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })),
      install: vi.fn(async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })),
    };
    await runRuntimeTool('run_command', { command: 'npm test', timeoutMs: 5000 }, ctx);
    expect(ctx.exec).toHaveBeenCalledWith('npm test', 5000);
  });

  it('run_command recusa comando vazio', async () => {
    const ctx = {
      exec: vi.fn(async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })),
      install: vi.fn(async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 })),
    };
    const r = await runRuntimeTool('run_command', { command: '   ' }, ctx);
    expect(r.ok).toBe(false);
    expect(ctx.exec).not.toHaveBeenCalled();
  });

  it('install_dependencies delega para install', async () => {
    const ctx = {
      exec: vi.fn(),
      install: vi.fn(async () => ({ ok: true, stdout: 'added 10 packages', stderr: '', exitCode: 0 })),
    } as never;
    const r = await runRuntimeTool('install_dependencies', {}, ctx);
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('added 10 packages');
  });

  it('ferramenta desconhecida falha', async () => {
    const ctx = { exec: vi.fn(), install: vi.fn() } as never;
    const r = await runRuntimeTool('run_qualquer_coisa', {}, ctx);
    expect(r.ok).toBe(false);
  });
});

describe('RemoteRuntime', () => {
  function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const spy = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('faz POST em /exec com o contrato documentado', async () => {
    const spy = stubFetch(
      () =>
        new Response(JSON.stringify({ code: 0, stdout: 'ok', stderr: '' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const adapter = new RemoteRuntime({ baseUrl: 'https://exec.dev' });
    const r = await adapter.exec({ command: 'npm test', language: 'node', cwd: '/workspace', env: { A: '1' }, stdin: 'x' });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://exec.dev/exec');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ command: 'npm test', language: 'node', cwd: '/workspace', env: { A: '1' }, stdin: 'x' });
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe('ok');
  });

  it('envia Authorization quando ha token', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const adapter = new RemoteRuntime({ baseUrl: 'https://exec.dev', token: 'segredo' });
    await adapter.exec({ command: 'ls', language: 'bash' });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer segredo');
  });

  it('reporta HTTP de erro sem quebrar', async () => {
    stubFetch(() => new Response('sem autorizacao', { status: 401 }));
    const adapter = new RemoteRuntime({ baseUrl: 'https://exec.dev' });
    const r = await adapter.exec({ command: 'ls', language: 'bash' });
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain('401');
    expect(r.stderr).toContain('sem autorizacao');
  });

  it('reporta timeout como timedOut', async () => {
    stubFetch((_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }),
    );
    const adapter = new RemoteRuntime({ baseUrl: 'https://exec.dev', timeoutMs: 10 });
    const r = await adapter.exec({ command: 'sleep 100', language: 'bash' });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('sincroniza arquivos em /sync', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const adapter = new RemoteRuntime({ baseUrl: 'https://exec.dev' });
    await adapter.sync([{ path: 'a.ts', content: 'x' }]);
    const [url] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://exec.dev/sync');
  });

  it('nao sincroniza quando indisponivel', async () => {
    const spy = stubFetch(() => new Response('{}', { status: 200 }));
    const adapter = new RemoteRuntime({ baseUrl: '' });
    await adapter.sync([{ path: 'a.ts', content: 'x' }]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('instala dependencias com npm install', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ code: 0, stdout: '' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const adapter = new RemoteRuntime({ baseUrl: 'https://exec.dev' });
    await adapter.install();
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).command).toBe('npm install');
  });

  it('propaga chunks para quem Assina', async () => {
    stubFetch(() => new Response(JSON.stringify({ code: 0, stdout: 'linha1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const adapter = new RemoteRuntime({ baseUrl: 'https://exec.dev' });
    const seen: string[] = [];
    const off = adapter.onChunk((c) => seen.push(c.text));
    await adapter.exec({ command: 'ls', language: 'bash' });
    off();
    expect(seen.join('')).toBe('linha1');
  });
});

