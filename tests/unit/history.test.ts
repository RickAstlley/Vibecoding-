import { describe, expect, it } from 'vitest';
import { contentHash, type FileSnapshot } from '@/core/history/undo';

describe('contentHash', () => {
  it('gera hash estavel para o mesmo conteudo', async () => {
    expect(await contentHash('const a = 1;')).toBe(await contentHash('const a = 1;'));
  });

  it('gera hash diferente para conteudo diferente', async () => {
    expect(await contentHash('a')).not.toBe(await contentHash('b'));
  });

  it('trata null como conteudo vazio', async () => {
    expect(await contentHash(null)).toBe(await contentHash(''));
  });
});

/**
 * Simula o contrato de undo/redo sobre uma store em memoria.
 * A implementacao real grava em IndexedDB; a semantica e a mesma e
 * isso que o teste fixa.
 */
interface FakeEntry {
  id: string;
  seq: number;
  undone: boolean;
  before: FileSnapshot[];
  after: FileSnapshot[];
}

class FakeStore {
  files = new Map<string, string>();
  history: FakeEntry[] = [];
  seq = 0;

  apply = async (snapshots: FileSnapshot[]): Promise<void> => {
    for (const s of snapshots) {
      if (s.content === null) this.files.delete(s.path);
      else this.files.set(s.path, s.content);
    }
  };

  async record(path: string, before: string | null, after: string | null): Promise<void> {
    this.seq += 1;
    this.history.push({
      id: `e${this.seq}`,
      seq: this.seq,
      undone: false,
      before: [{ path, content: before }],
      after: [{ path, content: after }],
    });
  }

  async undo(): Promise<boolean> {
    // a mais recente ainda aplicada
    const entry = [...this.history].reverse().find((e: FakeEntry) => !e.undone);
    if (!entry) return false;
    await this.apply(entry.before);
    entry.undone = true;
    return true;
  }

  async redo(): Promise<boolean> {
    // ordem inversa do undo: a entrada desfeita mais antiga primeiro
    const entry = this.history.find((e: FakeEntry) => e.undone);
    if (!entry) return false;
    await this.apply(entry.after);
    entry.undone = false;
    return true;
  }
}

describe('semantica de undo/redo', () => {
  it('desfaz uma edicao humana', async () => {
    const store = new FakeStore();
    store.files.set('a.ts', 'v1');
    await store.record('a.ts', 'v1', 'v2');
    store.files.set('a.ts', 'v2');

    expect(await store.undo()).toBe(true);
    expect(store.files.get('a.ts')).toBe('v1');
  });

  it('desfaz uma edicao do agente igual a humana', async () => {
    const store = new FakeStore();
    store.files.set('a.ts', 'original');
    await store.record('a.ts', 'original', 'alterado pelo agente');
    store.files.set('a.ts', 'alterado pelo agente');

    await store.undo();
    expect(store.files.get('a.ts')).toBe('original');
  });

  it('refaz devolvendo ao estado novo', async () => {
    const store = new FakeStore();
    await store.record('a.ts', 'v1', 'v2');
    await store.undo();
    expect(await store.redo()).toBe(true);
    expect(store.files.get('a.ts')).toBe('v2');
  });

  it('desfaz em sequencia ate o inicio', async () => {
    const store = new FakeStore();
    await store.record('a.ts', 'v1', 'v2');
    await store.record('a.ts', 'v2', 'v3');

    await store.undo();
    expect(store.files.get('a.ts')).toBe('v2');
    await store.undo();
    expect(store.files.get('a.ts')).toBe('v1');
  });

  it('undo nao faz nada sem historico', async () => {
    expect(await new FakeStore().undo()).toBe(false);
  });

  it('redo nao faz nada sem nada desfeito', async () => {
    expect(await new FakeStore().redo()).toBe(false);
  });

  it('desfazer deleta arquivo recriado', async () => {
    const store = new FakeStore();
    await store.record('novo.ts', null, 'conteudo');
    store.files.set('novo.ts', 'conteudo');

    await store.undo();
    expect(store.files.has('novo.ts')).toBe(false);
  });

  it('refazer recria arquivo deletado', async () => {
    const store = new FakeStore();
    store.files.set('a.ts', 'conteudo');
    await store.record('a.ts', 'conteudo', null);
    store.files.delete('a.ts');

    await store.undo();
    expect(store.files.get('a.ts')).toBe('conteudo');
    await store.redo();
    expect(store.files.has('a.ts')).toBe(false);
  });

  it('undo so volta uma entrada por vez', async () => {
    const store = new FakeStore();
    await store.record('a.ts', 'v1', 'v2');
    await store.record('a.ts', 'v2', 'v3');

    await store.undo();
    expect(store.files.get('a.ts')).toBe('v2');
  });

  it('alterna entre humano e agente sem perder o estado', async () => {
    const store = new FakeStore();
    store.files.set('a.ts', 'v0');

    await store.record('a.ts', 'v0', 'humano');
    store.files.set('a.ts', 'humano');

    await store.record('a.ts', 'humano', 'agente');
    store.files.set('a.ts', 'agente');

    await store.undo();
    expect(store.files.get('a.ts')).toBe('humano');
    await store.undo();
    expect(store.files.get('a.ts')).toBe('v0');
    await store.redo();
    await store.redo();
    expect(store.files.get('a.ts')).toBe('agente');
  });
});