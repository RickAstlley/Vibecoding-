# Arcanum Weaver

IDE de vibecoding que roda como **site estático** — funciona em Hostinger (ou qualquer hospedagem compartilhada) **sem VPS**.

## O que ele faz

| Recurso | Como funciona |
|---|---|
| **Lê ZIP inteiros** | `fflate` (WASM) no navegador. Detecta e remove prefixo de pasta raiz (`projeto-main/`), bloqueia path traversal, symlinks e zip bombs |
| **Escreve código completo** | Geração por tool-calling em streaming, com 9 provedores BYOK (NVIDIA NIM em primeiro lugar) |
| **Comprime prompts** | Pipeline de 5 camadas com medição de tokens antes/depois, orçamento por janela de contexto e ranqueamento de arquivos |
| **Edita 1 linha / 1 arquivo** | 3 níveis: `edit_line` (uma linha), `edit_anchor` (bloco por símbolo), `write_file` (arquivo). **Um patch = um arquivo**, garantido pelo runtime |
| **Preview do site** | iframe `sandbox` servido por Service Worker sobre o VFS. Viewports, console capturado, recarregar |
| **Agentes com ping** | Journal append-only com hash chain, loop com backoff exponencial, retomada após fechar a aba |

## Garantias do runtime

Estas regras são invioláveis — estão no código, não só na documentação:

1. **Um patch altera exatamente um arquivo.** `assertSingleFile()` rejeita antes de qualquer escrita.
2. **Patch que quebra sintaxe é revertido automaticamente.** `verifySource()` roda após aplicar; se falhar, o arquivo volta ao estado anterior e o erro retorna ao agente.
3. **Path traversal é bloqueado na normalização de caminho**, não só na leitura do ZIP.
4. **O journal é a fonte da verdade.** Cada evento tem hash encadeado; `verifyChain()` detecta corrupção. Fechar a aba não perde passos.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript, `output: 'export'`
- CodeMirror 6, Zustand, Dexie (IndexedDB), fflate, diff-match-patch
- Tailwind CSS, Vitest, ESLint 9

## Desenvolvimento

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # 81 testes unitarios
npm run build      # gera out/ (estatico)
```

## Deploy no Hostinger (sem VPS)

```bash
npm run build
```

O build gera `out/` com o site 100% estático. Suba para `public_html`:

```bash
# FileZilla / hPanel File Manager: arraste out/ para public_html/
rsync -avz out/ user@ftp.seudominio.com:/public_html/
```

O `public/.htaccess` já vem no build com:
- rewrite SPA para `index.html`
- `sw.js` sempre sem cache
- cache longo para assets com hash
- compressão gzip e cabeçalhos de segurança

Depois, no hPanel: **Sites → Performance** e ative **HTTPS** (Let's Encrypt, grátis).

**Nada roda no servidor do Hostinger** — não precisa de Node, Python ou banco de dados.

## Provedores de IA (BYOK)

Configure a chave em **Config** no próprio app. Nada é enviado a servidores nossos.

| Provider | Base URL | Observação |
|---|---|---|
| **NVIDIA NIM** | `https://integrate.api.nvidia.com/v1` | Principal. Llama 3.3, Qwen2.5 Coder, DeepSeek Coder, Mistral |
| OpenAI | `https://api.openai.com/v1` | GPT-4.1, o3-mini |
| Anthropic | `https://api.anthropic.com/v1` | Claude Sonnet 4 / Opus 4 / Haiku |
| Google | `https://generativelanguage.googleapis.com/v1beta` | Gemini 2.0 Flash |
| OpenRouter | `https://openrouter.ai/api/v1` | Agregador |
| Groq | `https://api.groq.com/openai/v1` | Baixa latência |
| Ollama | `http://localhost:11434/v1` | Local (para testar em `localhost`) |
| LM Studio | `http://localhost:1234/v1` | Local |
| Custom | qualquer `baseUrl` | Qualquer serviço compatível com a API da OpenAI |

As chaves ficam em `localStorage` no seu navegador.

## Como o agente edita arquivos

O sistema de prompts define o contrato com ferramentas:

| Ferramenta | Alcance | Quando usar |
|---|---|---|
| `read_file` | leitura | sempre antes de editar |
| `search_code` | leitura | localizar por termo |
| `edit_line` | **1 linha** | ajuste pontual |
| `edit_anchor` | **1 bloco** (função, classe, const, método) | corrigir um método |
| `write_file` | **1 arquivo** | arquivo pequeno ou mudança estrutural |
| `finish` | — | encerrar o run |

Exemplo de patch que **não** quebra seu projeto: pedir para mudar a linha 42 de `src/App.tsx` executa `edit_line` — as outras 41 linhas e todos os outros arquivos ficam byte a byte idênticos (verificado por SHA-256 no journal).

## Compressão de prompt

Camadas aplicadas em ordem, cada uma medindo tokens:

1. **strip** — comentários de bloco, espaço final, linhas vazias (com parser que respeita strings)
2. **dedupe** — imports e blocos idênticos repetidos
3. **structure** — boilerplate repetido vira `{bp0:4}` com legenda
4. **window** — recorta para a janela em torno das linhas citadas na pergunta
5. **sketch** — substitui corpos por assinaturas quando o arquivo estoura o orçamento

O orçamento divide a janela de contexto do modelo (ex.: 15% sistema, 20% pergunta, 50% código, 10% histórico, 5% reserva de saída). A UI mostra o antes/depois por arquivo.

## Testes

81 testes unitários cobrindo:

- normalização de caminho e bloqueio de traversal
- extração/reancoragem de âncoras
- verificação de sintaxe com respeito a strings e comentários
- aplicação e reversão de patches (incluindo o teste "edita 1 linha sem tocar nos demais arquivos")
- ZIP: round-trip, prefixo de raiz, zip-slip, limites
- cada camada de compressão e a garantia de nunca aumentar o tamanho
- ranqueamento de arquivos, grafo de imports e construção de contexto

## Estrutura

```
src/
├─ app/            página do IDE
├─ core/
│  ├─ vfs/         sistema de arquivos virtual (IndexedDB + snapshots)
│  ├─ zip/         unzip/zip com guards
│  ├─ patch/       line-edit, anchors, verify, surgical
│  ├─ compress/    pipeline de compressão
│  ├─ context/     ranqueamento + construção de contexto
│  ├─ agents/      journal, runtime, modos, ferramentas
│  └─ ia/          cliente unificado + registro de providers
├─ components/     editor, explorer, preview, chat, settings
└─ stores/         Zustand (arquivos, UI, settings)
public/
├─ sw.js           Service Worker do preview
└─ .htaccess       configuração Apache/Hostinger
```

## Limitações conhecidas

- Preview serve arquivos estáticos; projetos que precisam de build (Vite/Next) não são compilados no navegador — são servidos os arquivos como estão.
- Providers locais (Ollama/LM Studio) só funcionam em `localhost` por causa das restrições de CORS do navegador.
- Collaborative editing multiusuário (CRDT) está planejado, não implementado.