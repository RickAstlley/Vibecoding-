export type ProviderKind = 'openai-compatible' | 'anthropic' | 'google';

export interface ModelInfo {
  id: string;
  label: string;
  contextWindow: number;
  maxOutput?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  tier?: 'flagship' | 'balanced' | 'fast' | 'local';
  note?: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  keyHint: string;
  docsUrl?: string;
  featured?: boolean;
  models: ModelInfo[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'nvidia-nim',
    label: 'NVIDIA NIM',
    kind: 'openai-compatible',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyHint: 'NVIDIA_API_KEY (build.nvidia.com)',
    docsUrl: 'https://build.nvidia.com/explore/discover',
    featured: true,
    models: [
      { id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', label: 'Nemotron Super 49B', contextWindow: 131072, supportsTools: true, tier: 'flagship', note: 'Melhor custo/qualidade no NIM para codigo' },
      { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', contextWindow: 131072, supportsTools: true, tier: 'flagship' },
      { id: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B', contextWindow: 131072, supportsTools: true, tier: 'flagship' },
      { id: 'qwen/qwen2.5-coder-32b-instruct', label: 'Qwen2.5 Coder 32B', contextWindow: 32768, supportsTools: true, tier: 'balanced', note: 'Especializado em codigo' },
      { id: 'deepseek-ai/deepseek-coder-33b-instruct', label: 'DeepSeek Coder 33B', contextWindow: 32768, supportsTools: true, tier: 'balanced' },
      { id: 'mistralai/mistral-large-2411', label: 'Mistral Large 24B', contextWindow: 131072, supportsTools: true, tier: 'balanced' },
      { id: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', contextWindow: 131072, tier: 'fast', note: 'Rapido e barato para tarefas simples' },
      { id: 'nvidia/nv-embed-v1', label: 'NV Embed v1', contextWindow: 0, tier: 'local', note: 'Embeddings para RAG' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    featured: true,
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1', contextWindow: 1047576, supportsTools: true, supportsVision: true, tier: 'flagship' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', contextWindow: 1047576, supportsTools: true, tier: 'balanced' },
      { id: 'o3-mini', label: 'o3-mini', contextWindow: 200000, supportsTools: true, tier: 'flagship', note: 'Raciocinio longo' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', contextWindow: 128000, supportsTools: true, tier: 'fast' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyHint: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    featured: true,
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', contextWindow: 200000, supportsTools: true, supportsVision: true, tier: 'flagship' },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', contextWindow: 200000, supportsTools: true, supportsVision: true, tier: 'flagship' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', contextWindow: 200000, supportsTools: true, tier: 'fast' },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyHint: 'AIza...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    featured: true,
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', contextWindow: 1048576, supportsTools: true, supportsVision: true, tier: 'balanced' },
      { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', contextWindow: 1048576, tier: 'fast' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyHint: 'sk-or-...',
    docsUrl: 'https://openrouter.ai/keys',
    models: [
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (OR)', contextWindow: 200000, supportsTools: true, tier: 'flagship' },
      { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1 (OR)', contextWindow: 163840, tier: 'balanced' },
      { id: 'qwen/qwen-2.5-coder-32b-instruct', label: 'Qwen2.5 Coder 32B (OR)', contextWindow: 32768, supportsTools: true, tier: 'balanced' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyHint: 'gsk_...',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', contextWindow: 131072, supportsTools: true, tier: 'flagship' },
      { id: 'qwen-2.5-coder-32b', label: 'Qwen2.5 Coder 32B (Groq)', contextWindow: 32768, supportsTools: true, tier: 'balanced' },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    keyHint: 'qualquer string (ex: ollama)',
    featured: true,
    models: [
      { id: 'qwen2.5-coder:14b', label: 'Qwen2.5 Coder 14B', contextWindow: 32768, supportsTools: true, tier: 'local' },
      { id: 'llama3.3:70b', label: 'Llama 3.3 70B', contextWindow: 131072, tier: 'local' },
      { id: 'deepseek-r1:14b', label: 'DeepSeek R1 14B', contextWindow: 32768, tier: 'local' },
    ],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    keyHint: 'qualquer string (ex: lm-studio)',
    models: [
      { id: 'local-model', label: 'Modelo carregado no LM Studio', contextWindow: 32768, tier: 'local' },
    ],
  },
  {
    id: 'custom',
    label: 'OpenAI-compatible custom',
    kind: 'openai-compatible',
    baseUrl: '',
    keyHint: 'chave do seu servico',
    models: [{ id: 'custom-model', label: 'Modelo custom', contextWindow: 32768, tier: 'local' }],
  },
];

export const DEFAULT_MODELS: Record<string, string> = {
  'nvidia-nim': 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.0-flash',
  openrouter: 'anthropic/claude-sonnet-4',
  groq: 'llama-3.3-70b-versatile',
  ollama: 'qwen2.5-coder:14b',
  lmstudio: 'local-model',
  custom: 'custom-model',
};

export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function getModel(providerId: string, modelId: string): ModelInfo | undefined {
  return getProvider(providerId)?.models.find((m) => m.id === modelId);
}

export function contextWindow(providerId: string, modelId: string): number {
  return getModel(providerId, modelId)?.contextWindow ?? 32768;
}
