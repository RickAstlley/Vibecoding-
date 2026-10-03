import { expect, test } from '@playwright/test';
import {
  boot,
  historyEntries,
  listProjectFiles,
  mockProvider,
  openPanel,
  readProjectFile,
  send,
  setApiKey,
  writeProjectFile,
} from './helpers';

test.describe('loop do agente', () => {
  test('edit_line altera so a linha pedida', async ({ page }) => {
    await boot(page);
    await setApiKey(page);
    await writeProjectFile(page, 'src/target.ts', 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    await page.reload();

    await mockProvider(page, {
      replies: [
        {
          content: 'ajustando',
          toolCalls: [
            { id: 'c1', name: 'edit_line', arguments: { path: 'src/target.ts', line: 2, text: 'const b = 999;' } },
          ],
        },
        { content: 'Pronto. Alterei a linha 2.' },
      ],
    });

    await send(page, 'mude a linha 2 de src/target.ts para 999');

    await expect
      .poll(async () => readProjectFile(page, 'src/target.ts'), { timeout: 30_000 })
      .toBe('const a = 1;\nconst b = 999;\nconst c = 3;\n');
  });

  test('patch que quebra sintaxe e revertido', async ({ page }) => {
    await boot(page);
    await setApiKey(page);
    await writeProjectFile(page, 'src/broken.ts', 'export function f() {\n  return 1;\n}\n');
    await page.reload();

    await mockProvider(page, {
      replies: [
        {
          content: 'quebrando de proposito',
          toolCalls: [
            {
              id: 'c1',
              name: 'write_file',
              arguments: { path: 'src/broken.ts', content: 'export function f() {\n  return 1;' },
            },
          ],
        },
        { content: 'O patch foi revertido pelo verificador.' },
      ],
    });

    await send(page, 'quebre src/broken.ts');

    // o arquivo tem de voltar ao conteudo original
    await expect
      .poll(async () => readProjectFile(page, 'src/broken.ts'), { timeout: 30_000 })
      .toBe('export function f() {\n  return 1;\n}\n');
  });

  test('patch em um arquivo nao toca nos demais', async ({ page }) => {
    await boot(page);
    await setApiKey(page);
    await writeProjectFile(page, 'src/um.ts', 'export const um = 1;\n');
    await writeProjectFile(page, 'src/dois.ts', 'export const dois = 2;\n');
    await page.reload();

    await mockProvider(page, {
      replies: [
        {
          content: 'editando um',
          toolCalls: [{ id: 'c1', name: 'edit_line', arguments: { path: 'src/um.ts', line: 1, text: 'export const um = 111;' } }],
        },
        { content: 'Feito.' },
      ],
    });

    await send(page, 'mude src/um.ts');

    await expect
      .poll(async () => readProjectFile(page, 'src/um.ts'), { timeout: 30_000 })
      .toBe('export const um = 111;\n');
    expect(await readProjectFile(page, 'src/dois.ts')).toBe('export const dois = 2;\n');
  });

  test('registra edicao do agente no historico unificado', async ({ page }) => {
    await boot(page);
    await setApiKey(page);
    await writeProjectFile(page, 'src/x.ts', 'export const x = 1;\n');
    await page.reload();

    await mockProvider(page, {
      replies: [
        {
          content: 'editando',
          toolCalls: [{ id: 'c1', name: 'edit_line', arguments: { path: 'src/x.ts', line: 1, text: 'export const x = 5;' } }],
        },
        { content: 'ok' },
      ],
    });

    await send(page, 'mude x');

    await expect.poll(async () => readProjectFile(page, 'src/x.ts'), { timeout: 30_000 }).toContain('= 5');

    const entries = await historyEntries(page);
    const agentEdit = entries.find((e) => e.actor === 'agent');
    expect(agentEdit).toBeTruthy();
    expect(agentEdit?.label).toContain('src/x.ts');
  });

  test('cria arquivo novo pelo agente', async ({ page }) => {
    await boot(page);
    await setApiKey(page);
    await page.reload();

    await mockProvider(page, {
      replies: [
        {
          content: 'criando',
          toolCalls: [
            { id: 'c1', name: 'write_file', arguments: { path: 'src/novo.ts', content: 'export const novo = true;\n' } },
          ],
        },
        { content: 'criado' },
      ],
    });

    await send(page, 'crie src/novo.ts');

    await expect.poll(async () => (await listProjectFiles(page)).includes('src/novo.ts'), { timeout: 30_000 }).toBe(true);
    expect(await readProjectFile(page, 'src/novo.ts')).toBe('export const novo = true;\n');
  });

  test('patch de TSX valido passa na verificacao', async ({ page }) => {
    await boot(page);
    await setApiKey(page);
    await writeProjectFile(page, 'src/C.tsx', 'export function C() {\n  return <div>ok</div>;\n}\n');
    await page.reload();

    await mockProvider(page, {
      replies: [
        {
          content: 'corrigindo',
          toolCalls: [
            {
              id: 'c1',
              name: 'edit_line',
              arguments: { path: 'src/C.tsx', line: 2, text: '  return <div>corrigido</div>;' },
            },
          ],
        },
        { content: 'ok' },
      ],
    });

    await send(page, 'corrija o C');

    await expect.poll(async () => readProjectFile(page, 'src/C.tsx'), { timeout: 30_000 }).toContain('corrigido');
  });

  test('erro do provider nao quebra a interface', async ({ page }) => {
    await boot(page);
    await setApiKey(page);

    await mockProvider(page, { replies: [{ content: '' }], status: 500 });

    await send(page, 'qualquer coisa');
    await page.waitForTimeout(6000);

    await expect(page.getByText('Arcanum Weaver')).toBeVisible();
    await expect(page.getByPlaceholder(/Descreva a tarefa/i)).toBeVisible();
  });

  test('sem chave de API o envio fica bloqueado', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'Sessao');

    const box = page.getByPlaceholder(/Descreva a tarefa/i);
    await box.fill('teste');
    await expect(page.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });
});