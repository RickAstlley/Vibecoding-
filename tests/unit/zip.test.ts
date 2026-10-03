import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createZip, detectRootPrefix, extractZip, scanZip } from '@/core/zip/unzip';
import { ZipGuardError } from '@/core/zip/guards';

function makeZip(files: Record<string, string>): Uint8Array {
  const payload: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) payload[k] = strToU8(v);
  return zipSync(payload, { level: 6 });
}

describe('scanZip', () => {
  it('extrai entradas e normaliza caminhos', async () => {
    const data = makeZip({ 'src/index.ts': 'export const a = 1;', 'README.md': '# ola' });
    const scan = await scanZip(data);
    expect(scan.stats.files).toBe(2);
    expect(scan.entries.map((e) => e.path).sort()).toEqual(['README.md', 'src/index.ts']);
  });

  it('remove prefixo de pasta raiz do github', async () => {
    const data = makeZip({ 'meu-projeto-main/src/App.tsx': 'x', 'meu-projeto-main/package.json': '{}' });
    const scan = await scanZip(data);
    expect(scan.rootPrefix).toBe('meu-projeto-main');
    expect(scan.entries.map((e) => e.path).sort()).toEqual(['package.json', 'src/App.tsx']);
  });

  it('nao remove prefixo quando a raiz e src ou public', async () => {
    const data = makeZip({ 'src/index.ts': 'x', 'src/other.ts': 'y' });
    const scan = await scanZip(data);
    expect(scan.rootPrefix).toBe('');
    expect(scan.entries[0]?.path).toBe('src/index.ts');
  });

  it('bloqueia path traversal (zip-slip)', async () => {
    const data = makeZip({ '../../etc/passwd': 'root' });
    const scan = await scanZip(data);
    expect(scan.entries).toHaveLength(0);
    expect(scan.stats.skipped).toContain('../../etc/passwd');
  });

  it('pula node_modules e .git', async () => {
    const data = makeZip({
      'node_modules/react/index.js': 'x',
      '.git/config': 'y',
      'src/app.ts': 'z',
    });
    const scan = await scanZip(data);
    expect(scan.entries.map((e) => e.path)).toEqual(['src/app.ts']);
  });

  it('rejeita zip acima do limite de arquivos', async () => {
    const data = makeZip(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}.txt`, 'x'])));
    await expect(
      scanZip(data, { maxTotalBytes: 1e9, maxFiles: 5, maxSingleFileBytes: 1e9, maxCompressionRatio: 200 }),
    ).rejects.toBeInstanceOf(ZipGuardError);
  });
});

describe('extractZip', () => {
  it('devolve bytes com conteudo correto', async () => {
    const data = makeZip({ 'a.txt': 'primeiro', 'sub/b.txt': 'segundo' });
    const { entries } = await extractZip(data);
    const map = new Map(entries.map((e) => [e.path, new TextDecoder().decode(e.bytes)]));
    expect(map.get('a.txt')).toBe('primeiro');
    expect(map.get('sub/b.txt')).toBe('segundo');
  });
});

describe('createZip', () => {
  it('reempacota e pode ser lido de volta', async () => {
    const original = makeZip({ 'x/y.ts': 'conteudo' });
    const { entries } = await extractZip(original);
    const round = await createZip(entries);
    const again = await extractZip(round);
    expect(again.entries).toHaveLength(1);
    expect(new TextDecoder().decode(again.entries[0]?.bytes)).toBe('conteudo');
  });
});

describe('detectRootPrefix', () => {
  it('detecta prefixo comum', () => {
    expect(detectRootPrefix(['proj/src/a.ts', 'proj/src/b.ts'])).toBe('proj/src');
    expect(detectRootPrefix(['a.ts', 'b.ts'])).toBe('');
  });
});
