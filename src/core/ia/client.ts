import { contextWindow, getProvider, type ModelInfo, type ProviderInfo } from './providers';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface CompletionRequest {
  providerId: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  baseUrlOverride?: string;
  apiKey: string;
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  promptTokens: number;
  completionTokens: number;
  model: string;
  provider: string;
  finishReason: string | null;
}

export class IaError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number) {
    super(message);
    this.name = 'IaError';
  }
}

let idCounter = 0;
export function nextId(prefix = 'call'): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function resolveBaseUrl(providerId: string, override?: string): string {
  if (override) return override.replace(/\/$/, '');
  const provider = getProvider(providerId);
  if (!provider) throw new IaError(`Provider desconhecido: ${providerId}`, 'unknown-provider');
  return provider.baseUrl.replace(/\/$/, '');
}

export function resolveModel(providerId: string, modelId: string): ModelInfo | undefined {
  return getProvider(providerId)?.models.find((m) => m.id === modelId);
}

export function windowFor(providerId: string, modelId: string): number {
  return contextWindow(providerId, modelId);
}

function authHeaders(provider: ProviderInfo, apiKey: string): Record<string, string> {
  if (provider.kind === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  }
  if (provider.kind === 'google') {
    return { 'x-goog-api-key': apiKey, 'content-type': 'application/json' };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey && apiKey !== 'ollama' && apiKey !== 'lm-studio') {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function toOpenAIMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toAnthropicMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const last = out[out.length - 1];
      if (last && Array.isArray(last.content)) {
        (last.content as unknown[]).push({ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content });
      }
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const parts: unknown[] = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        parts.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
      }
      out.push({ role: 'assistant', content: parts });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function toGoogleContents(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const last = out[out.length - 1];
      if (last && Array.isArray(last.parts)) {
        (last.parts as unknown[]).push({ functionResponse: { name: m.name ?? 'tool', response: { content: m.content } } });
      }
      continue;
    }
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts: unknown[] = [{ text: m.content || ' ' }];
    if (m.toolCalls?.length) {
      for (const tc of m.toolCalls) parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
    }
    const last = out[out.length - 1];
    if (last && last.role === role) {
      (last.parts as unknown[]).push(...parts);
    } else {
      out.push({ role, parts });
    }
  }
  return out;
}

function openaiTools(tools: ToolDef[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function buildOpenAIBody(req: CompletionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toOpenAIMessages(req.messages),
    stream: req.stream ?? false,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.tools?.length) {
    body.tools = openaiTools(req.tools);
    body.tool_choice = 'auto';
  }
  return body;
}

function buildAnthropicBody(req: CompletionRequest): Record<string, unknown> {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toAnthropicMessages(req.messages),
    max_tokens: req.maxTokens ?? 8192,
    stream: req.stream ?? false,
  };
  if (system) body.system = system;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  return body;
}

function buildGoogleBody(req: CompletionRequest): Record<string, unknown> {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const body: Record<string, unknown> = {
    contents: toGoogleContents(req.messages),
    generationConfig: {
      temperature: req.temperature ?? 0.2,
      maxOutputTokens: req.maxTokens ?? 8192,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (req.tools?.length) {
    body.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: stripSchema(t.parameters),
        })),
      },
    ];
  }
  return body;
}

function stripSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema' || k === 'additionalProperties') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = stripSchema(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  const provider = getProvider(req.providerId);
  if (!provider) throw new IaError(`Provider desconhecido: ${req.providerId}`, 'unknown-provider');
  const base = resolveBaseUrl(req.providerId, req.baseUrlOverride);

  let url: string;
  let body: Record<string, unknown>;
  if (provider.kind === 'anthropic') {
    url = `${base}/messages`;
    body = buildAnthropicBody(req);
  } else if (provider.kind === 'google') {
    url = `${base}/models/${req.model}:generateContent`;
    body = buildGoogleBody(req);
  } else {
    url = `${base}/chat/completions`;
    body = buildOpenAIBody(req);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(provider, req.apiKey),
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IaError(`HTTP ${res.status} em ${provider.label}: ${text.slice(0, 400) || res.statusText}`, 'http-error', res.status);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return normalizeResponse(json, provider, req);
}

function normalizeResponse(json: Record<string, unknown>, provider: ProviderInfo, req: CompletionRequest): CompletionResult {
  const usage = (json.usage ?? {}) as Record<string, number>;
  let content = '';
  const toolCalls: ToolCall[] = [];
  let finishReason: string | null = null;

  if (provider.kind === 'anthropic') {
    const blocks = (json.content ?? []) as Array<Record<string, unknown>>;
    for (const b of blocks) {
      if (b.type === 'text') content += String(b.text ?? '');
      if (b.type === 'tool_use') {
        toolCalls.push({ id: String(b.id ?? nextId()), name: String(b.name), arguments: (b.input as Record<string, unknown>) ?? {} });
      }
    }
    finishReason = String(json.stop_reason ?? '') || null;
    return {
      content,
      toolCalls,
      promptTokens: usage.input_tokens ?? 0,
      completionTokens: usage.output_tokens ?? 0,
      model: req.model,
      provider: provider.id,
      finishReason,
    };
  }

  if (provider.kind === 'google') {
    const cands = (json.candidates ?? []) as Array<Record<string, unknown>>;
    const cand = cands[0];
    const parts = ((cand?.content as Record<string, unknown>)?.parts ?? []) as Array<Record<string, unknown>>;
    for (const p of parts) {
      if (typeof p.text === 'string') content += p.text;
      const fc = p.functionCall as Record<string, unknown> | undefined;
      if (fc) toolCalls.push({ id: nextId(), name: String(fc.name), arguments: (fc.args as Record<string, unknown>) ?? {} });
    }
    finishReason = String(cand?.finishReason ?? '') || null;
    return {
      content,
      toolCalls,
      promptTokens: usage.promptTokenCount ?? 0,
      completionTokens: usage.candidatesTokenCount ?? 0,
      model: req.model,
      provider: provider.id,
      finishReason,
    };
  }

  const choices = (json.choices ?? []) as Array<Record<string, unknown>>;
  const choice = choices[0];
  const message = (choice?.message ?? {}) as Record<string, unknown>;
  content = String(message.content ?? '');
  const rawCalls = (message.tool_calls ?? []) as Array<Record<string, unknown>>;
  for (const c of rawCalls) {
    const fn = (c.function ?? {}) as Record<string, unknown>;
    toolCalls.push({
      id: String(c.id ?? nextId()),
      name: String(fn.name ?? ''),
      arguments: safeParseArgs(String(fn.arguments ?? '{}')),
    });
  }
  finishReason = String(choice?.finish_reason ?? '') || null;
  return {
    content,
    toolCalls,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    model: req.model,
    provider: provider.id,
    finishReason,
  };
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { _raw: raw };
  }
}

export interface StreamHandlers {
  onDelta(chunk: string): void;
  onToolCall?(call: ToolCall): void;
  onDone?(result: CompletionResult): void;
  onError?(error: Error): void;
}

export async function stream(req: CompletionRequest, handlers: StreamHandlers): Promise<void> {
  const provider = getProvider(req.providerId);
  if (!provider) throw new IaError(`Provider desconhecido: ${req.providerId}`, 'unknown-provider');
  const base = resolveBaseUrl(req.providerId, req.baseUrlOverride);

  let url: string;
  let body: Record<string, unknown>;
  if (provider.kind === 'anthropic') {
    url = `${base}/messages`;
    body = buildAnthropicBody({ ...req, stream: true });
  } else if (provider.kind === 'google') {
    url = `${base}/models/${req.model}:streamGenerateContent?alt=sse`;
    body = buildGoogleBody(req);
  } else {
    url = `${base}/chat/completions`;
    body = buildOpenAIBody({ ...req, stream: true });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(provider, req.apiKey),
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    handlers.onError?.(err);
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new IaError(`HTTP ${res.status} em ${provider.label}: ${text.slice(0, 400)}`, 'http-error', res.status);
    handlers.onError?.(err);
    return;
  }

  if (!res.body) {
    const json = (await res.json()) as Record<string, unknown>;
    const normalized = normalizeResponse(json, provider, req);
    handlers.onDelta(normalized.content);
    for (const tc of normalized.toolCalls) handlers.onToolCall?.(tc);
    handlers.onDone?.(normalized);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let promptTokens = 0;
  let completionTokens = 0;
  const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | null = null;

  const flushLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    consumeStreamEvent(evt, provider, handlers, (chunk) => {
      content += chunk;
    }, pendingCalls, (t) => {
      promptTokens = t;
    }, (t) => {
      completionTokens = t;
    }, (f) => {
      finishReason = f;
    });
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        flushLine(line);
      }
    }
    if (buffer) flushLine(buffer);
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
    return;
  }

  for (const call of pendingCalls.values()) {
    handlers.onToolCall?.({ id: call.id, name: call.name, arguments: safeParseArgs(call.args) });
  }

  handlers.onDone?.({
    content,
    toolCalls: [],
    promptTokens,
    completionTokens,
    model: req.model,
    provider: provider.id,
    finishReason,
  });
}

function consumeStreamEvent(
  evt: Record<string, unknown>,
  provider: ProviderInfo,
  handlers: StreamHandlers,
  append: (chunk: string) => void,
  pending: Map<number, { id: string; name: string; args: string }>,
  setPrompt: (tokens: number) => void,
  setCompletion: (tokens: number) => void,
  setFinish: (reason: string) => void,
): void {
  if (provider.kind === 'anthropic') {
    const type = String(evt.type ?? '');
    if (type === 'content_block_delta') {
      const delta = (evt.delta ?? {}) as Record<string, unknown>;
      if (typeof delta.text === 'string') {
        append(delta.text);
        handlers.onDelta(delta.text);
      }
    }
    if (type === 'message_delta') {
      const delta = (evt.delta ?? {}) as Record<string, unknown>;
      if (typeof delta.stop_reason === 'string') setFinish(delta.stop_reason);
      const usage = (evt.usage ?? {}) as Record<string, number>;
      if (usage.output_tokens) setCompletion(usage.output_tokens);
    }
    if (type === 'message_start') {
      const msg = (evt.message ?? {}) as Record<string, unknown>;
      const usage = (msg.usage ?? {}) as Record<string, number>;
      if (usage.input_tokens) setPrompt(usage.input_tokens);
    }
    return;
  }

  if (provider.kind === 'google') {
    const cands = (evt.candidates ?? []) as Array<Record<string, unknown>>;
    const parts = ((cands[0]?.content as Record<string, unknown>)?.parts ?? []) as Array<Record<string, unknown>>;
    for (const p of parts) {
      if (typeof p.text === 'string') {
        append(p.text);
        handlers.onDelta(p.text);
      }
      const fc = p.functionCall as Record<string, unknown> | undefined;
      if (fc) handlers.onToolCall?.({ id: nextId(), name: String(fc.name), arguments: (fc.args as Record<string, unknown>) ?? {} });
    }
    const usage = (evt.usageMetadata ?? {}) as Record<string, number>;
    if (usage.promptTokenCount) setPrompt(usage.promptTokenCount);
    if (usage.candidatesTokenCount) setCompletion(usage.candidatesTokenCount);
    if (cands[0]?.finishReason) setFinish(String(cands[0].finishReason));
    return;
  }

  const usage = (evt.usage ?? {}) as Record<string, number>;
  if (usage.prompt_tokens) setPrompt(usage.prompt_tokens);
  if (usage.completion_tokens) setCompletion(usage.completion_tokens);

  const choices = (evt.choices ?? []) as Array<Record<string, unknown>>;
  const choice = choices[0];
  if (!choice) return;
  if (choice.finish_reason) setFinish(String(choice.finish_reason));
  const delta = (choice.delta ?? {}) as Record<string, unknown>;
  if (typeof delta.content === 'string' && delta.content) {
    append(delta.content);
    handlers.onDelta(delta.content);
  }
  const toolCalls = (delta.tool_calls ?? []) as Array<Record<string, unknown>>;
  for (const tc of toolCalls) {
    const index = typeof tc.index === 'number' ? tc.index : 0;
    const fn = (tc.function ?? {}) as Record<string, unknown>;
    const current = pending.get(index) ?? { id: String(tc.id ?? nextId()), name: '', args: '' };
    if (typeof tc.id === 'string') current.id = tc.id;
    if (typeof fn.name === 'string') current.name = fn.name;
    if (typeof fn.arguments === 'string') current.args += fn.arguments;
    pending.set(index, current);
  }
}

export async function listModels(baseUrlOverride: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseUrlOverride.replace(/\/$/, '')}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new IaError(`Falha ao listar modelos: HTTP ${res.status}`, 'http-error', res.status);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? []).map((m) => m.id ?? '').filter(Boolean);
}