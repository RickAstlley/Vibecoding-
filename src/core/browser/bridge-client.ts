export type BrowserOp = 'snapshot' | 'query' | 'read' | 'click' | 'type' | 'wait' | 'scroll';

export interface ElementInfo {
  index: number;
  selector: string;
  tag: string;
  text: string;
  visible: boolean;
  disabled: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

export interface Snapshot {
  title: string;
  url: string;
  readyState: string;
  interactive: number;
  headings: Array<{ level: string; text: string }>;
  buttons: ElementInfo[];
  inputs: Array<ElementInfo & { type: string; name: string; placeholder: string; value: string }>;
  text: string;
}

export interface BrowserResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}

interface PendingCommand {
  resolve(value: BrowserResult): void;
  timer: number;
}

const BRIDGE_NS = '__arcanum';
const DEFAULT_TIMEOUT_MS = 8000;

let counter = 0;
let pending = new Map<string, PendingCommand>();
let frameRef: HTMLIFrameElement | null = null;
let readySince: number | null = null;
const listeners = new Set<(state: BrowserBridgeState) => void>();

export interface BrowserBridgeState {
  attached: boolean;
  lastError: string | null;
}

/**
 * Cliente do driver de DOM que roda dentro do iframe de preview.
 * Todo comando e correlacionado por id; a resposta chega por postMessage.
 */
export class BrowserBridge {
  private ready = false;

  attach(frame: HTMLIFrameElement | null): void {
    if (frameRef === frame) return;
    frameRef = frame;
    this.ready = false;
    readySince = null;
    if (typeof window === 'undefined') return;

    window.removeEventListener('message', this.onMessage);
    window.addEventListener('message', this.onMessage);
  }

  detach(): void {
    window.removeEventListener('message', this.onMessage);
    for (const [, entry] of pending) window.clearTimeout(entry.timer);
    pending = new Map();
    this.ready = false;
    readySince = null;
    frameRef = null;
    this.emit({ attached: false, lastError: null });
  }

  private emit(state: BrowserBridgeState): void {
    for (const fn of listeners) fn(state);
  }

  private onMessage = (e: MessageEvent): void => {
    const data = e.data as { ns?: string; type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
    if (data?.ns !== BRIDGE_NS) return;

    if (data.type === 'ready') {
      this.ready = true;
      readySince = Date.now();
      this.emit({ attached: true, lastError: null });
      return;
    }

    if (data.type === 'result' && data.id) {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      window.clearTimeout(entry.timer);
      entry.resolve({ ok: Boolean(data.ok), ...(data.result !== undefined ? { result: data.result } : {}), ...(data.error ? { error: data.error } : {}) });
    }
  };

  isReady(): boolean {
    return this.ready;
  }

  secondsSinceReady(): number | null {
    if (!readySince) return null;
    return Math.round((Date.now() - readySince) / 1000);
  }

  async send<T = unknown>(op: BrowserOp, args: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<BrowserResult<T>> {
    const frame = frameRef;
    if (!frame?.contentWindow) {
      return { ok: false, error: 'Preview nao esta montado' };
    }
    if (!this.ready) {
      return { ok: false, error: 'Preview ainda nao terminou de carregar. Recarregue e tente de novo.' };
    }

    counter = (counter + 1) % 1e6;
    const id = `${BRIDGE_NS}_${Date.now().toString(36)}${counter.toString(36)}`;

    return new Promise<BrowserResult<T>>((resolve) => {
      const timer = window.setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: `Comando "${op}" nao respondeu em ${Math.round(timeoutMs / 1000)}s` });
      }, timeoutMs);

      pending.set(id, { resolve: resolve as (v: BrowserResult) => void, timer });

      try {
        frame.contentWindow?.postMessage({ ns: BRIDGE_NS, kind: 'cmd', id, op, args }, '*');
      } catch (e) {
        pending.delete(id);
        window.clearTimeout(timer);
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  snapshot(): Promise<BrowserResult<Snapshot>> {
    return this.send<Snapshot>('snapshot');
  }
}

let instance: BrowserBridge | null = null;

export function browserBridge(): BrowserBridge {
  if (!instance) instance = new BrowserBridge();
  return instance;
}

export function onBridgeState(fn: (state: BrowserBridgeState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Texto curto e legivel de um snapshot, para caber no contexto do modelo. */
export function renderSnapshot(snap: Snapshot, maxChars = 1800): string {
  const lines: string[] = [];
  lines.push(`titulo: ${snap.title || '(sem titulo)'}`);
  lines.push(`url: ${snap.url} | readyState: ${snap.readyState} | interativos: ${snap.interactive}`);

  if (snap.headings.length > 0) {
    lines.push('\nheadings:');
    for (const h of snap.headings.slice(0, 10)) lines.push(`  ${h.level}: ${h.text}`);
  }

  if (snap.buttons.length > 0) {
    lines.push('\nbotoes:');
    for (const b of snap.buttons.slice(0, 12)) {
      lines.push(`  [${b.index}] ${b.selector} "${b.text}"${b.disabled ? ' (desabilitado)' : ''}`);
    }
  }

  if (snap.inputs.length > 0) {
    lines.push('\ncampos:');
    for (const i of snap.inputs.slice(0, 12)) {
      lines.push(`  [${i.index}] ${i.selector} type=${i.type} placeholder="${i.placeholder}" valor="${i.value}"`);
    }
  }

  lines.push('\ntexto visivel:');
  lines.push(snap.text.slice(0, maxChars));

  return lines.join('\n');
}