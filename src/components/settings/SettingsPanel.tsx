'use client';

import { useState } from 'react';
import { Check, Eye, EyeOff, Key, Package, RefreshCw, Server, ShieldAlert, Terminal as TerminalIcon, Trash2, Zap } from 'lucide-react';
import { PROVIDERS, getProvider } from '@/core/ia/providers';
import { useSettings } from '@/stores/settings';
import { crossOriginIsolated } from '@/core/runtime/adapter';

export function SettingsPanel() {
  const settings = useSettings();
  const isolated = typeof crossOriginIsolated === 'function' ? crossOriginIsolated() : false;
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const test = async (providerId: string): Promise<void> => {
    const provider = getProvider(providerId);
    const cfg = settings.providers[providerId];
    if (!provider || !cfg) return;
    setTesting(providerId);
    setTestResult((r) => ({ ...r, [providerId]: '' }));
    try {
      const url = `${(cfg.baseUrl || provider.baseUrl).replace(/\/$/, '')}/models`;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (provider.kind === 'anthropic') {
        headers['x-api-key'] = cfg.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else if (provider.kind === 'google') {
        headers['x-goog-api-key'] = cfg.apiKey;
      } else if (cfg.apiKey && cfg.apiKey !== 'ollama' && cfg.apiKey !== 'lm-studio') {
        headers.authorization = `Bearer ${cfg.apiKey}`;
      }
      const res = await fetch(url, { headers });
      if (res.ok) {
        setTestResult((r) => ({ ...r, [providerId]: 'OK - endpoint respondeu' }));
      } else {
        const body = await res.text().catch(() => '');
        setTestResult((r) => ({ ...r, [providerId]: `HTTP ${res.status}: ${body.slice(0, 120)}` }));
      }
    } catch (e) {
      setTestResult((r) => ({ ...r, [providerId]: `Falha de rede: ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="scrollbar-thin h-full overflow-auto p-3">
      <div className="mb-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <Key className="h-4 w-4 text-arc" />
          Provedores e chaves (BYOK)
        </h3>
        <p className="text-[11px] text-muted-foreground">
          As chaves ficam no seu navegador (localStorage). Nenhum dado e enviado a servidores nossos.
        </p>
      </div>

      <div className="space-y-2">
        {PROVIDERS.map((provider) => {
          const cfg = settings.providers[provider.id] ?? { apiKey: '', baseUrl: provider.baseUrl, enabled: false };
          const isActive = settings.activeProvider === provider.id;
          const visible = showKeys[provider.id] ?? false;
          const result = testResult[provider.id];

          return (
            <div
              key={provider.id}
              className={`rounded-lg border p-3 transition-colors ${
                isActive ? 'border-arc/60 bg-arc/5' : 'border-border bg-card/40'
              }`}
            >
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => settings.setActiveProvider(provider.id)}
                  className={`flex items-center gap-1.5 text-sm font-medium ${isActive ? 'text-arc' : ''}`}
                >
                  {isActive && <Check className="h-3.5 w-3.5" />}
                  {provider.label}
                  {provider.featured && (
                    <span className="rounded bg-arc/20 px-1 py-0.5 text-[9px] uppercase text-arc-fg">principal</span>
                  )}
                </button>
                {provider.docsUrl && (
                  <a
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto text-[10px] text-muted-foreground underline hover:text-foreground"
                  >
                    obter chave
                  </a>
                )}
              </div>

              <div className="mb-2 flex items-center gap-1.5">
                <input
                  type={visible ? 'text' : 'password'}
                  value={cfg.apiKey}
                  placeholder={provider.keyHint}
                  onChange={(e) => settings.setApiKey(provider.id, e.target.value)}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-arc/60"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKeys((s) => ({ ...s, [provider.id]: !visible }))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={visible ? 'Ocultar' : 'Mostrar'}
                >
                  {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => test(provider.id)}
                  disabled={testing === provider.id}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  title="Testar endpoint"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${testing === provider.id ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {(provider.id === 'custom' || provider.id === 'ollama' || provider.id === 'lmstudio') && (
                <div className="mb-2 flex items-center gap-1.5">
                  <Server className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <input
                    value={cfg.baseUrl}
                    placeholder="https://servidor/v1"
                    onChange={(e) => settings.setBaseUrl(provider.id, e.target.value)}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-arc/60"
                    spellCheck={false}
                  />
                </div>
              )}

              {result && (
                <p className={`font-mono text-[10px] ${result.startsWith('OK') ? 'text-emerald-400' : 'text-destructive'}`}>
                  {result}
                </p>
              )}

              {isActive && provider.models.length > 0 && (
                <div className="mt-2">
                  <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Modelo ativo</label>
                  <select
                    value={settings.activeModel}
                    onChange={(e) => settings.setActiveModel(e.target.value)}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-arc/60"
                  >
                    {provider.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} · {Math.round(m.contextWindow / 1000)}k ctx{m.note ? ` · ${m.note}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 mb-1 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Zap className="h-4 w-4 text-arc" />
          Agente
        </h3>
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3">
        <NumField label="Maximo de passos" value={settings.agent.maxSteps} onChange={(v) => settings.setAgent({ maxSteps: v })} />
        <NumField
          label="Maximo de tokens"
          value={settings.agent.maxTokens}
          step={50000}
          onChange={(v) => settings.setAgent({ maxTokens: v })}
        />
        <NumField
          label="Maximo de linhas por patch sem aprovacao"
          value={settings.agent.maxPatchLines}
          onChange={(v) => settings.setAgent({ maxPatchLines: v })}
        />
        <NumField
          label="Orcamento da sessao (US$, 0 = sem limite)"
          value={settings.agent.sessionBudgetUsd}
          step={0.5}
          onChange={(v) => settings.setAgent({ sessionBudgetUsd: v })}
        />
        <div className="space-y-1.5 border-t border-border pt-2">
          <Switch
            label="Fast apply"
            hint="Patch pequeno e nao destrutivo entra direto, sem diff para revisao"
            checked={settings.agent.fastApply}
            onChange={(v) => settings.setAgent({ fastApply: v })}
          />
          <Switch
            label="Checkpoints"
            hint="Salva o estado do projeto antes de cada passo, permitindo voltar o agente"
            checked={settings.agent.checkpoints}
            onChange={(v) => settings.setAgent({ checkpoints: v })}
          />
          <Switch
            label="Ferramentas de browser"
            hint="Da ao agente acesso ao DOM do preview: ver, clicar e digitar no proprio resultado"
            checked={settings.agent.browserTools}
            onChange={(v) => settings.setAgent({ browserTools: v })}
          />
          <Switch
            label="Usar AGENTS.md do projeto"
            hint="Le as regras do projeto como instrucao permanente do agente"
            checked={settings.agent.useProjectRules}
            onChange={(v) => settings.setAgent({ useProjectRules: v })}
          />
        </div>
      </div>

      <div className="mt-5 mb-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Package className="h-4 w-4 text-arc" />
          Preview e build
        </h3>
      </div>
      <div className="space-y-1.5 rounded-lg border border-border bg-card/40 p-3">
        <Switch
          label="Compilar TSX/JSX no preview"
          hint="Transpila e monta os modulos do projeto para rodar React/Next sem servidor"
          checked={settings.build.bundlerEnabled}
          onChange={(v) => settings.setBuild({ bundlerEnabled: v })}
        />
        <Switch
          label="Fallback para CDN"
          hint="Se o ZIP nao trouxer node_modules, busca pacotes em esm.sh"
          checked={settings.build.cdnFallback}
          onChange={(v) => settings.setBuild({ cdnFallback: v })}
        />
        <p className="pt-1 text-[10px] text-muted-foreground">
          Sem node_modules no ZIP, pacotes vem da CDN. Para controle total, importe o projeto com as
          dependencias instalada.
        </p>
      </div>

      <div className="mt-5 mb-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <TerminalIcon className="h-4 w-4 text-arc" />
          Execucao de codigo
        </h3>
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3">
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              { id: 'none' as const, label: 'Desativado' },
              { id: 'local' as const, label: 'Local (WebContainer)' },
              { id: 'remote' as const, label: 'Endpoint remoto' },
            ]
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => settings.setRuntime({ kind: opt.id })}
              className={`rounded px-2 py-1 text-[10px] transition-colors ${
                settings.runtime.kind === opt.id
                  ? 'bg-arc/20 text-arc-fg'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {settings.runtime.kind === 'local' && (
          <div className="rounded border border-border bg-background/50 p-2 text-[10px] text-muted-foreground">
            <p className="mb-1 text-foreground">Requer isolamento de origem.</p>
            <p>
              O .htaccess deste projeto ja define COOP/COEP. Se o preview reclamar de isolamento, recarregue a
              pagina depois do deploy - os cabecalhos so valem apos o upload.
            </p>
            {!isolated && (
              <p className="mt-1 text-yellow-400">
                Esta aba ainda nao esta isolada (provavelmente rodando em localhost sem os cabecalhos).
              </p>
            )}
          </div>
        )}

        {settings.runtime.kind === 'remote' && (
          <>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-muted-foreground">URL do executor</span>
              <input
                value={settings.runtime.remoteBaseUrl}
                onChange={(e) => settings.setRuntime({ remoteBaseUrl: e.target.value })}
                placeholder="https://meu-executor.dev"
                className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-arc/60"
                spellCheck={false}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-muted-foreground">Token (opcional)</span>
              <input
                type="password"
                value={settings.runtime.remoteToken}
                onChange={(e) => settings.setRuntime({ remoteToken: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-arc/60"
                autoComplete="off"
              />
            </label>
            <p className="text-[10px] text-muted-foreground">
              Contrato minimo: <code className="font-mono">POST /exec</code> e <code className="font-mono">POST /sync</code>.
            </p>
          </>
        )}

        {settings.runtime.kind !== 'none' && (
          <NumField
            label="Timeout de execucao (ms)"
            value={settings.runtime.timeoutMs}
            step={5000}
            onChange={(v) => settings.setRuntime({ timeoutMs: v })}
          />
        )}

        {settings.runtime.kind === 'none' && (
          <p className="text-[10px] text-muted-foreground">
            Sem execucao, o agente nao roda testes nem build. O preview estatico continua funcionando normalmente.
          </p>
        )}
      </div>

      <div className="mt-5 mb-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4 text-arc" />
          Seguranca
        </h3>
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3 text-[11px] text-muted-foreground">
        <p>
          Um patch altera <strong className="text-foreground">exatamente um arquivo</strong>. Se a IA tentar varios, o runtime
          rejeita antes de escrever.
        </p>
        <p>
          Cada patch passa por verificacao de sintaxe; se quebrar o arquivo, ele e revertido automaticamente.
        </p>
        <p>
          Importacao de ZIP bloqueia path traversal, symlinks e arquivos acima do limite.
        </p>
        <button
          type="button"
          onClick={() => settings.resetKeys()}
          className="mt-1 flex items-center gap-1.5 rounded bg-destructive/80 px-2 py-1 text-[11px] text-white hover:bg-destructive"
        >
          <Trash2 className="h-3 w-3" />
          apagar todas as chaves
        </button>
      </div>
    </div>
  );
}

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[hsl(var(--arc))]"
      />
      <span className="min-w-0">
        <span className="block text-[11px] font-medium">{label}</span>
        <span className="block text-[10px] text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange(v: number): void;
  step?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="min-w-0 flex-1 text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-arc/60"
      />
    </label>
  );
}