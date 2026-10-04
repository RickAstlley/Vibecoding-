import { expect, type Page } from '@playwright/test';

export async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Limpa uma vez por contexto de teste. Se limpasse a cada navegacao,
    // o reload de setApiKey apagaria a chave antes do agente rodar.
    try {
      if (sessionStorage.getItem('__arcanum_booted')) return;
      sessionStorage.setItem('__arcanum_booted', '1');
      localStorage.clear();
    } catch {
      /* ignora */
    }
  });
  await page.goto('/');
  await expect(page.getByText('Arcanum Weaver')).toBeVisible();
}

export async function openPanel(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: false }).first().click();
}

export async function openFile(page: Page, path: string): Promise<void> {
  const parts = path.split('/');
  const name = parts[parts.length - 1] as string;

  for (const part of parts.slice(0, -1)) {
    const dir = page.getByRole('button', { name: part, exact: true }).first();
    if (await dir.isVisible().catch(() => false)) {
      await dir.click();
      await page.waitForTimeout(60);
    }
  }

  await page.getByRole('button', { name, exact: false }).first().click();
  await expect(page.locator('[data-testid="code-editor"]')).toBeVisible();
}

/** Escreve no CodeMirror via API da view, nao por digitacao. */
export async function setEditorContent(page: Page, content: string): Promise<void> {
  const editor = page.locator('[data-testid="code-editor"] .cm-content');
  await editor.click();
  await page.waitForTimeout(80);

  await page.evaluate((text) => {
    const host = document.querySelector('[data-testid="code-editor"]') as HTMLElement | null;
    if (!host) throw new Error('editor nao encontrado');
    const view = (
      host as unknown as { __cmView?: { dispatch(spec: unknown): void; state: { doc: { length: number } } } }
    ).__cmView;
    if (!view) throw new Error('view do CodeMirror nao exposta');
    // o limite tem de ser o tamanho real do documento
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, content);
  await page.waitForTimeout(150);
}

export async function readEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="code-editor"]') as HTMLElement | null;
    const view = (host as unknown as { __cmView?: { state: { doc: { toString(): string } } } })?.__cmView;
    return view?.state.doc.toString() ?? '';
  });
}

export async function readProjectFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (target) => {
    const hooks = window.__weaver;
    if (!hooks) throw new Error('gancho de teste nao instalado');
    return hooks.vfs().readText(target);
  }, path);
}

export async function writeProjectFile(page: Page, path: string, content: string): Promise<void> {
  await page.evaluate(
    async (args: string[]) => {
      const hooks = window.__weaver;
      if (!hooks) throw new Error('gancho de teste nao instalado');
      await hooks.vfs().writeText(args[0] as string, args[1] as string);
    },
    [path, content],
  );
}

export async function listProjectFiles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const hooks = window.__weaver;
    if (!hooks) throw new Error('gancho de teste nao instalado');
    return (await hooks.vfs().tree()).files;
  });
}

export async function historyEntries(page: Page): Promise<Array<{ label: string; actor: string; undone: boolean }>> {
  return page.evaluate(async () => {
    const hooks = window.__weaver;
    if (!hooks) throw new Error('gancho de teste nao instalado');
    const entries = await hooks.history().list(50);
    return entries.map((e: { label: string; actor: string; undone: boolean }) => ({
      label: e.label,
      actor: e.actor,
      undone: e.undone,
    }));
  });
}

/**
 * Espera o frame do preview carregar de verdade.
 *
 * Só encontrar o frame nao basta: no primeiro acesso ele ainda pode estar
 * no 404 do dev server, porque o Service Worker so responde depois de
 * receber os arquivos do VFS.
 */
export async function previewFrame(page: Page, readyText?: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const frame = page.frames().find((f) => f.url().includes('/__preview__/index.html'));
    if (frame) {
      const text = await frame
        .locator('body')
        .innerText()
        .catch(() => '');
      const notFound = text.includes('404') || text.includes('This page could not be found');
      const looksEmpty = text.trim().length === 0 && text.includes('<') === false;
      const matches = readyText ? text.includes(readyText) : true;
      if (!notFound && !looksEmpty && matches) return frame;
    }
    await page.waitForTimeout(250);
  }
  const frame = page.frames().find((f) => f.url().includes('/__preview__/index.html'));
  const text = frame ? await frame.locator('body').innerText().catch(() => '') : '(sem frame)';
  throw new Error(`preview nao carregou. Corpo atual: ${text.slice(0, 200)}`);
}

/** Envia um comando ao bridge do preview e espera o resultado. */
export async function bridgeCommand<T = unknown>(
  page: Page,
  op: string,
  args: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<T> {
  return page.evaluate(
    (raw: Array<string | number | Record<string, unknown>>) => {
      const opName = raw[0] as string;
      const payload = (raw[1] ?? {}) as Record<string, unknown>;
      const timeout = (raw[2] ?? 15000) as number;
      return new Promise<T>((resolve, reject) => {
        const id = `e2e-${Date.now().toString(36)}`;
        const timer = setTimeout(() => reject(new Error(`comando ${opName} sem resposta`)), timeout);
        const listener = (e: MessageEvent) => {
          const data = e.data as { ns?: string; type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
          if (data?.ns !== '__arcanum' || data.type !== 'result' || data.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener('message', listener);
          if (data.ok) resolve(data.result as T);
          else reject(new Error(data.error ?? 'erro'));
        };
        window.addEventListener('message', listener);
        const frame = document.querySelector('[data-testid="preview-frame"]') as HTMLIFrameElement | null;
        frame?.contentWindow?.postMessage({ ns: '__arcanum', kind: 'cmd', id, op: opName, args: payload }, '*');
      });
    },
    [op, args, timeoutMs],
  );
}

/**
 * Intercepta o provider de IA e devolve uma resposta programada.
 * Permite testar o loop do agente sem chamar nenhum servico real.
 */
export async function mockProvider(
  page: Page,
  options: {
    replies: Array<{
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    }>;
    status?: number;
  },
): Promise<void> {
  let index = 0;

  await page.route('**/chat/completions', async (route) => {
    const reply = options.replies[Math.min(index, options.replies.length - 1)] ?? { content: 'ok' };
    index += 1;

    const message: Record<string, unknown> = { role: 'assistant', content: reply.content };
    if (reply.toolCalls?.length) {
      message.tool_calls = reply.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }

    const payload = {
      id: 'mock',
      object: 'chat.completion',
      model: 'mock-model',
      choices: [{ index: 0, message, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
    };

    // O runtime sempre pede stream:true, e o parser so aceita frames SSE.
    // Responder JSON puro faria o tool call passar despercebido.
    let wantsStream = true;
    try {
      const body = JSON.parse(route.request().postData() ?? '{}') as { stream?: boolean };
      wantsStream = body.stream !== false;
    } catch {
      /* assume stream */
    }

    if (wantsStream) {
      const chunk = (delta: Record<string, unknown>, finish: string | null): string =>
        `data: ${JSON.stringify({
          id: 'mock',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta, finish_reason: finish }],
          usage: null,
        })}\n\n`;

      const frames = [
        chunk({ role: 'assistant', content: reply.content }, null),
        ...(reply.toolCalls ?? []).map((tc) =>
          chunk(
            {
              tool_calls: [
                { index: 0, id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } },
              ],
            },
            null,
          ),
        ),
        chunk({}, 'stop'),
        `data: ${JSON.stringify({
          id: 'mock',
          object: 'chat.completion.chunk',
          choices: [],
          usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        })}\n\n`,
        'data: [DONE]\n\n',
      ].join('');

      await route.fulfill({ status: options.status ?? 200, contentType: 'text/event-stream', body: frames });
      return;
    }

    await route.fulfill({
      status: options.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

/** Grava uma chave de API nas settings para o agente poder rodar. */
export async function setApiKey(page: Page, provider = 'nvidia-nim', key = 'teste-chave'): Promise<void> {
  await page.evaluate(
    ([p, k]: string[]) => {
      const raw = localStorage.getItem('arcanum-weaver-settings');
      const parsed = raw ? (JSON.parse(raw) as { state?: Record<string, unknown> }) : { state: {} };
      const state = parsed.state ?? {};
      const providers = (state.providers as Record<string, { apiKey: string; baseUrl: string; enabled: boolean }>) ?? {};
      providers[p as string] = { apiKey: k ?? '', baseUrl: '', enabled: true };
      (state as Record<string, unknown>).providers = providers;
      (state as Record<string, unknown>).activeProvider = p;
      localStorage.setItem('arcanum-weaver-settings', JSON.stringify({ state, version: 0 }));
    },
    [provider, key],
  );
  await page.reload();
  await expect(page.getByText('Arcanum Weaver')).toBeVisible();
}

/** Envia um prompt pelo painel de chat. */
export async function send(page: Page, prompt: string): Promise<void> {
  const box = page.getByPlaceholder(/Descreva a tarefa/i);
  await box.click();
  await box.fill(prompt);
  await page.getByRole('button', { name: /enviar/i }).click();
}

/**
 * Cria um projeto TSX no VFS, com um React local minimo.
 *
 * Usamos um shim em vez de esm.sh de proposito: a resolucao por
 * node_modules exercita o mesmo caminho do bundler sem depender de rede
 * nem de certificado externo.
 */
export async function seedTsxProject(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const hooks = window.__weaver;
    if (!hooks) throw new Error('gancho de teste nao instalado');
    const store = hooks.vfs();
    await store.init();

    await store.writeText('index.html', '<!doctype html><html><head></head><body><div id="root"></div></body></html>');

    await store.writeText(
      'src/main.tsx',
      [
        "import { createRoot } from 'react-dom/client';",
        "import { App } from './App';",
        '',
        "const root = document.getElementById('root');",
        'if (root) createRoot(root).render(<App title="ola-mundo" />);',
      ].join('\n'),
    );

    await store.writeText(
      'src/App.tsx',
      [
        'interface Props { title: string }',
        '',
        'export function App({ title }: Props) {',
        '  return <h1 className="titulo">{title}</h1>;',
        '}',
      ].join('\n'),
    );

    await store.writeText(
      'package.json',
      JSON.stringify({ name: 'teste', dependencies: { react: '^19', 'react-dom': '^19' } }, null, 2),
    );

    await store.writeText(
      'node_modules/react/package.json',
      JSON.stringify({ name: 'react', version: '19.0.0', main: './index.js' }),
    );
    await store.writeText(
      'node_modules/react/index.js',
      [
        'export function createElement(type, props, ...children) {',
        '  const flat = children.flat(3);',
        '  const text = flat.filter((c) => typeof c === "string" || typeof c === "number").join("");',
        '  if (typeof type === "function") return type({ ...(props || {}), children: flat });',
        '  const el = document.createElement(type);',
        '  for (const [k, v] of Object.entries(props || {})) {',
        '    if (k === "children") continue;',
        '    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);',
        '    else el.setAttribute(k === "className" ? "class" : k, String(v));',
        '  }',
        '  if (text) el.textContent = text;',
        '  for (const child of flat) {',
        '    if (child && typeof child === "object" && child.nodeType === 1) el.appendChild(child);',
        '  }',
        '  return el;',
        '}',
        'export const Fragment = "fragment";',
        'export default { createElement, Fragment };',
      ].join('\n'),
    );
    await store.writeText(
      'node_modules/react-dom/package.json',
      JSON.stringify({ name: 'react-dom', version: '19.0.0', main: './index.js' }),
    );
    await store.writeText(
      'node_modules/react-dom/index.js',
      'export function createPortal(child) { return child; }\nexport default { createPortal };',
    );
    await store.writeText(
      'node_modules/react-dom/client/package.json',
      JSON.stringify({ name: 'react-dom/client', version: '19.0.0', main: './index.js' }),
    );
    await store.writeText(
      'node_modules/react-dom/client/index.js',
      [
        "import { createElement } from 'react';",
        'export function createRoot(container) {',
        '  return {',
        '    render(element) {',
        '      container.textContent = "";',
        '      if (element && element.nodeType === 1) container.appendChild(element);',
        '      else container.appendChild(createElement(element));',
        '    },',
        '    unmount() { container.textContent = ""; },',
        '  };',
        '}',
      ].join('\n'),
    );
  });

  await page.reload();
  await expect(page.getByText('Arcanum Weaver')).toBeVisible();

  await expect
    .poll(async () => (await listProjectFiles(page)).sort().join(','), { timeout: 10_000 })
    .toContain('src/App.tsx');
}