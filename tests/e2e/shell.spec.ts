import { expect, test } from '@playwright/test';
import { boot, openFile, openPanel, readEditorContent, readProjectFile, setEditorContent } from './helpers';

test.describe('shell do IDE', () => {
  test('carrega com projeto inicial criado', async ({ page }) => {
    await boot(page);

    await expect(page.getByText('Arcanum Weaver')).toBeVisible();
    await expect(page.getByText('2 arquivos', { exact: false })).toBeVisible();

    const index = await readProjectFile(page, 'index.html');
    expect(index).toContain('<!doctype html>');
    expect(index).toContain('Arcanum Weaver');

    const readme = await readProjectFile(page, 'README.md');
    expect(readme).toContain('Meu projeto');
  });

  test('abre um arquivo no editor', async ({ page }) => {
    await boot(page);
    await openFile(page, 'README.md');

    const content = await readEditorContent(page);
    expect(content).toContain('Meu projeto');
  });

  test('salva edicao de arquivo', async ({ page }) => {
    await boot(page);
    await openFile(page, 'README.md');

    await setEditorContent(page, '# Editado pelo teste E2E\n');
    await page.keyboard.press('Control+s');

    // o toast some rapido; o que importa e o arquivo ter sido gravado
    await expect.poll(async () => readProjectFile(page, 'README.md'), { timeout: 8000 }).toBe('# Editado pelo teste E2E\n');
    expect(await readEditorContent(page)).toBe('# Editado pelo teste E2E\n');
  });

  test('navega entre os paineis', async ({ page }) => {
    await boot(page);

    const paineis: Array<[string, string]> = [
      ['Sessao', 'Orcamento'],
      ['Revisar', 'Revisar mudancas'],
      ['Git', 'Controle de versao'],
      ['Segredos', 'Segredos'],
      ['Publicar', 'Publicar'],
      ['Buscar', 'Busca semantica'],
      ['MCP', 'Servidores MCP'],
      ['Config', 'Provedores e chaves'],
    ];

    for (const [label, esperado] of paineis) {
      await openPanel(page, label);
      await expect(page.getByText(esperado, { exact: false }).first()).toBeVisible();
    }
  });
});
