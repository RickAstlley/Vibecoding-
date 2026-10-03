# Arcanum Weaver — Plano Atualizado

> Status: **MVP construído e verificado.** Este documento reflete o estado real
> do código em 03/10/2026, incluindo as decisões tomadas depois da construção.

---

## 1. Estado atual: o que está pronto e verificado

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | limpo |
| `npm run lint` | 0 erros, 1 warning |
| `npm test` | **81/81 passando** |
| `npm run build` | `out/` estático gerado, 408 kB First Load JS |

**Escopo entregue:** 45 arquivos, ~7.700 linhas, 100% client-side.

### Requisitos e onde foram implementados

| Pedido | Implementação | Verificado por |
|---|---|---|
| Ler ZIP inteiros | `src/core/zip/unzip.ts` | 9 testes (round-trip, prefixo de raiz, zip-slip, limites) |
| Escrever código completo | `src/core/ia/client.ts` (9 providers, streaming, tool calling) | typecheck |
| Comprimir prompts | `src/core/compress/pipeline.ts` (5 camadas) | 23 testes |
| Mexer só em 1 linha | `src/core/patch/line-edit.ts` | 23 testes |
| Não tocar nos demais | `assertSingleFile()` em `surgical.ts:80` | teste "edita 1 linha sem tocar nos demais arquivos" |
| Preview do site | `public/sw.js` + iframe sandbox | build |
| Modos agentes | `src/core/agents/modes.ts` (6 modos) | typecheck |
| Ping contínuo sem perdas | `journal.ts` (hash chain) + `runtime.ts` (backoff) | typecheck |
| NVIDIA NIM | `providers.ts` — primeiro provider, 8 modelos | typecheck |

### Garantias do runtime (invioláveis, no código)

1. **Um patch = um arquivo.** `assertSingleFile()` rejeita 2+ arquivos *antes* de escrever.
2. **Patch quebrado volta.** `verifySource()` roda pós-patch e reverte — **com uma ressalva, ver seção 3.1**.
3. **Path traversal bloqueado na normalização**, não só na leitura do ZIP.
4. **Journal é a fonte da verdade.** Hash encadeado, `verifyChain()` detecta corrupção.

---

## 2. Decisões tomadas após a construção

### 2.1 Android nativo → Capacitor (não PWA)

Escolhido porque reusa 100% do código existente: o `out/` vira app sem reescrever linha nenhuma.

**Ganhos reais vs PWA:**
- Evicção de IndexedDB **resolvida** (era o maior problema do PWA)
- Share sheet nativo para exportar ZIP
- Acesso real a arquivos via Storage Access Framework
- Mais memória (2–4GB de heap vs limite de aba)
- Offline por padrão

**Configuração obrigatória:** `androidScheme: 'https'` no `capacitor.config.ts` — sem isso o Service Worker do preview não registra e o preview quebra dentro do app.

**Plugins:** `@capacitor/filesystem`, `@capacitor/share`, `@capacitor/preferences`, `@capacitor/haptics`.

**Requer:** JDK 17 + Android Studio + Android SDK. Custo: ~1–2 dias.

**Descartado:** Tauri 2 (exigiria reescrever o VFS em Rust, 3–4 semanas), React Native/Flutter (zero reuso, 2+ meses).

### 2.2 Vite → viável, com esbuild-wasm

O preview atual serve arquivos estáticos. Para rodar Vite falta só a etapa de build:

| Componente | Onde | Custo |
|---|---|---|
| `esbuild-wasm` (bundle + transpile) | Web Worker | ~10MB no bundle |
| Resolver de imports (`exports`, `browser`, `react/jsx-dev-runtime`) | `core/build/resolver.ts` | novo |
| Import map no preview | `sw.js` | reescrever specifiers |
| Carregar `node_modules` do ZIP | VFS | 40–80MB — o gargalo real |

**Não se ganha:** HMR (dá reload completo). **Pré-requisito:** o ZIP precisa vir com `node_modules` dentro.

**No celular:** roda, mas lento. Mais viável que no browser, ainda travando em projeto grande.

Estimativa: 3–5 dias.

### 2.3 Next.js → fora do escopo

Não é transpilação, é runtime de Server Components + SSR + build completo. Service Worker não serve, e WebView de app Android também não.

Caminhos avaliados e suas consequências:

| Opção | Veredicto |
|---|---|
| WebContainers | **Descartado.** Exige COOP/COEP, ~1GB de RAM, imagem de `webcontainers.io`. Quebra a premissa de site estático. |
| Build remoto (endpoint que builda o zip) | Viável, mas tira a independência do projeto. **Único caminho se Next for obrigatório.** |
| Next fora do preview | Aceitável. Você edita aqui, builda e deploya separado. |

**Decisão:** Next só entra via build remoto opcional, se e quando for realmente necessário.

---

## 3. Déficits encontrados na revisão (não estão corrigidos)

### 3.1 `verify.ts` não cobre `.tsx`, `.jsx`, `.yaml`, `.shell` — **prioridade alta**

O switch em `verify.ts:198-216` tem casos para `typescript`, `javascript`, `json`, `html`, `python`, `css`, `text`, `markdown`, `binary`. Mas `detectLanguage()` também retorna `jsx`, `tsx`, `yaml` e `shell` — e **esses não têm caso**.

Consequência: para arquivo `.tsx`, `verifySource()` retorna `{ok: true}` sem checar nada. **Um patch que quebra um `.tsx` não é revertido.** A garantia vale para `.ts`, `.js`, `.json`, `.html`, `.css`, `.py` — não vale para React/Next, que é o caso principal.

Correção: 4 linhas no switch, `.tsx` no mesmo caminho de `.ts`. LIMITADO: continua sendo contador de chaves + heurísticas, não um parser real. Pega `{` faltando; não pega erro de tipo nem import inexistente.

### 3.2 Preview não recarrega sozinho

Depois de um patch, o cache do SW é atualizado (arquivos sempre frescos), mas o iframe só re-renderiza ao clicar em Recarregar (`Preview.tsx:113`). Correção: bump no nonce junto com `previewToken`. ~2 linhas em `page.tsx`.

### 3.3 Painel de console não está conectado

`Preview.tsx:103` escuta `postMessage` `{type:'console'}`, mas o `sw.js` nunca injeta o hook que envia essas mensagens — o `rewrite()` só reescreve URLs. O painel fica vazio mesmo com erros na tela.

Correção: injetar `<script>` no HTML servido, fazendo monkey-patch de `console.*` e `window.onerror`, postando para o parent. ~30 linhas no `sw.js`.

**Impacto combinado:** o loop "agente edita → você vê → agente lê o erro → corrige" não fecha. O modo Debugger fica sem entrada.

---

## 4. Ordem de execução recomendada

### Curto prazo (1 dia) — fecha o loop de feedback
1. Corrigir switch do `verify.ts` para `.tsx`/`.jsx`/`.yaml`/`.shell` + testes
2. Auto-reload do preview com debounce
3. Injeção do hook de console no `sw.js` + teste de ponta a ponta
4. Smoke test pós-patch: carregar `index.html` no preview e checar erro fatal

### Médio prazo (3–5 dias) — suporte a Vite
5. `esbuild-wasm` em Web Worker
6. Resolver de imports (`exports` maps, campo `browser`, jsx-runtime)
7. Import map + limites de memória
8. Fallback de erro claro quando `node_modules` não vier no ZIP

### Curto/médio (1–2 dias) — Android
9. `npx cap add android` + `androidScheme: 'https'`
10. Plugins: filesystem, share, preferences
11. Layout mobile (3 painéis → abas)
12. Share target no manifest (aceitar ZIP do Files/WhatsApp)

### Backlog
13. Testes E2E (Playwright) — hoje só há unitários
14. CRDT multiusuário (Yjs) — não implementado
15. Build remoto opcional, se Next for obrigatório
16. Migração IndexedDB → OPFS (durabilidade no Safari)

---

## 5. Riscos abertos

| Risco | Impacto | Mitigação atual |
|---|---|---|
| Sem feedback visual, o agente erra e não sabe | Alto | Correções 2, 3 e 4 da seção 4 |
| Verificação estrutural ≠ funcional | Médio | Aceito; smoke test é o mitigation real |
| `node_modules` de 40–80MB no VFS | Médio | Limites já existem em `guards.ts` |
| Consumo de memória no preview | Médio | Limite de 2MB por arquivo já aplicado no `Preview.tsx:91` |
| Sem HMR, ciclo de feedback lento | Baixo | Reload completo é aceitável para HTML/CSS/JS |

---

## 6. Como validar o MVP hoje

```bash
npm install && npm run dev
```

1. Abrir → projeto inicial com `index.html` gerado
2. Preview mostra a página estática
3. Importar um ZIP → árvore populada, `node_modules` ignorado
4. Pedir "mude a linha 42 de X" ao agente → só aquela linha muda
5. Pedir um patch que quebre a sintaxe em `.ts` → revertido automaticamente
6. (Falta) o mesmo em `.tsx` → **hoje não reverte** — déficit 3.1
7. `npm test` → 81/81

---

## 7. Referência rápida

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor local em :3000 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint 9 flat config |
| `npm test` | 81 testes unitários |
| `npm run build` | gera `out/` para upload no Hostinger |

**Deploy:** `npm run build && rsync -avz out/ user@ftp.seudominio.com:/public_html/`
O `public/.htaccess` já vai no build com rewrite SPA, cache correto do SW e gzip.