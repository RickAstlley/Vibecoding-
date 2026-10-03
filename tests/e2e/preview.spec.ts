import { expect, test } from '@playwright/test';
import {
  bridgeCommand,
  boot,
  openFile,
  openPanel,
  previewFrame,
  seedTsxProject,
  setEditorContent,
} from './helpers';

test.describe('preview e bundler', () => {
  test('renderiza o HTML estatico e o smoke test passa', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'Preview');

    await expect(page.locator('[data-testid="preview-frame"]')).toBeVisible();

    const frame = await previewFrame(page, 'Arcanum Weaver');
    await expect(frame.getByText('Arcanum Weaver')).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByRole('button', { name: 'Testar' })).toBeVisible();

    // smoke test: sai de "testando" e nao acusa erro
    await expect(page.getByText('testando')).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText('erro', { exact: true })).toHaveCount(0);
  });

  test('captura console da pagina do preview', async ({ page }) => {
    await boot(page);
    await openFile(page, 'index.html');
    await setEditorContent(
      page,
      '<!doctype html><html><body><script>console.log("MENSAGEM-DE-TESTE-42")</script></body></html>',
    );
    await page.keyboard.press('Control+s');

    await openPanel(page, 'Preview');
    await previewFrame(page);
    await page.getByRole('button', { name: /console/i }).first().click();

    await expect(page.getByText('MENSAGEM-DE-TESTE-42')).toBeVisible({ timeout: 25_000 });
  });

  test('recarrega sozinho apos mudanca', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'Preview');

    const frame = await previewFrame(page, 'Edite este arquivo');
    await expect(frame.getByText('Edite este arquivo')).toBeVisible({ timeout: 15_000 });

    await openFile(page, 'index.html');
    await setEditorContent(page, '<!doctype html><html><body><h1>CONTEUDO-NOVO-777</h1></body></html>');
    await page.keyboard.press('Control+s');

    // o auto-reload tem debounce de 700ms
    await expect(frame.getByText('CONTEUDO-NOVO-777')).toBeVisible({ timeout: 25_000 });
  });

  test('bundle TSX: componente React renderiza no preview', async ({ page }) => {
    await boot(page);
    await seedTsxProject(page);
    await openPanel(page, 'Preview');

    const frame = await previewFrame(page, 'ola-mundo');

    // <App /> vira createElement e o React monta a arvore de verdade
    await expect(frame.locator('#root h1')).toBeVisible({ timeout: 30_000 });
    await expect(frame.locator('#root h1')).toHaveAttribute('class', 'titulo');
    await expect(frame.locator('#root h1')).toHaveText('ola-mundo');
  });

  test('bridge de DOM responde comandos do agente', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'Preview');
    await previewFrame(page, 'Testar');

    const snap = await bridgeCommand<{ title: string; interactive: number; buttons: unknown[] }>(page, 'snapshot');
    expect(snap.title).toContain('Meu projeto');
    expect(snap.buttons.length).toBeGreaterThan(0);
  });

  test('clicar no preview muda o DOM e o agente ve', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'Preview');
    const frame = await previewFrame(page, 'Testar');
    await expect(frame.getByRole('button', { name: 'Testar' })).toBeVisible({ timeout: 15_000 });

    // browser_click: exatamente o caminho que o agente usa
    await bridgeCommand(page, 'click', { selector: 'button' });

    // o botao troca o proprio texto ao clicar
    await expect(frame.getByRole('button', { name: 'funcionando' })).toBeVisible({ timeout: 10_000 });
  });

  test('query encontra elementos e click por seletor funciona', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'Preview');
    await previewFrame(page, 'Testar');

    const found = await bridgeCommand<{ matches: Array<{ selector: string; text: string }> }>(page, 'query', {
      selector: 'button',
    });
    expect(found.matches.length).toBeGreaterThan(0);
    expect(found.matches[0]?.selector).toContain('button');
  });
});