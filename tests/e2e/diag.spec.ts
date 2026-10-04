import { expect, test } from '@playwright/test';
import { boot, mockProvider, readProjectFile, send, setApiKey, writeProjectFile } from './helpers';

test('diagnostico do loop do agente', async ({ page }) => {
  const hits: string[] = [];
  const logs: string[] = [];

  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => logs.push(`PAGEERROR ${e.message.slice(0, 200)}`));
  page.on('requestfailed', (r) => logs.push(`REQFAIL ${r.url().slice(0, 90)} ${r.failure()?.errorText ?? ''}`));

  await boot(page);
  await setApiKey(page);
  await writeProjectFile(page, 'src/t.ts', 'const a = 1;\nconst b = 2;\n');
  await page.reload();

  await page.route('**/chat/completions', async (route) => {
    hits.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'm',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'editando',
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'edit_line', arguments: JSON.stringify({ path: 'src/t.ts', line: 2, text: 'const b = 42;' }) } },
              ],
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
  });

  const enabled = await page.getByRole('button', { name: /enviar/i }).isEnabled();
  const placeholder = await page.getByPlaceholder(/Descreva a tarefa|Configure uma chave/i).first().getAttribute('placeholder');

  await send(page, 'mude a linha 2');
  await page.waitForTimeout(12_000);

  const after = await readProjectFile(page, 'src/t.ts');
  const panel = await page.locator('aside').last().innerText().catch(() => '');

  console.log('ENABLED:', enabled);
  console.log('PLACEHOLDER:', placeholder);
  console.log('ROUTE_HITS:', hits.length, hits.slice(0, 2));
  console.log('FILE:', JSON.stringify(after));
  console.log('PANEL:', panel.slice(0, 260).replace(/\n/g, ' | '));
  console.log('LOGS:', JSON.stringify(logs.slice(0, 10), null, 1));
  expect(true).toBe(true);
});