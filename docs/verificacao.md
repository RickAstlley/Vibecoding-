# Verificação do Arcanum Weaver

Registro do que foi **executado de verdade** e do que foi encontrado.
Data: 04/10/2026 · commit `9246529`

---

## Estado

| Camada | Quantidade | Resultado |
|---|---|---|
| Testes unitários (vitest) | 395 | 395 passando |
| Testes E2E (Playwright, Chromium) | 19 | 19 passando |
| `npm run typecheck` | — | limpo |
| `npm run lint` | — | 0 erros, 1 warning |
| `npm run build` | — | `out/` gerado |

```bash
npm ci
npm run typecheck && npm run lint && npm test
npx playwright install --with-deps chromium
npx playwright test tests/e2e/
```

---

## Cobertura E2E

Cada teste roda o app em Chromium real, com IndexedDB, Service Worker,
iframe e WebCM — nada é mockado exceto o provider de IA.

### `shell.spec.ts` — 4 testes
Carga com projeto inicial, abertura de arquivo, gravação via `Ctrl+S`
(confirmando no IndexedDB, não no toast) e navegação nos 8 painéis.

### `preview.spec.ts` — 7 testes
- HTML estático renderiza e o smoke test fecha em `ok`
- `console.log` da página chega ao painel do IDE
- auto-reload com debounce após salvar
- **bundle TSX**: React compilado e montado, com `class` e texto corretos
- bridge de DOM responde `snapshot`
- `click` do agente muda o DOM de verdade
- `query` por seletor encontra elementos

### `agent.spec.ts` — 8 testes
Loop completo com provider simulado, incluindo a verificação de que
**um arquivo alterado não encosta nos outros**.

| Cenário | Verifica |
|---|---|
| `edit_line` | só a linha pedida muda |
| patch com sintaxe quebrada | é revertido ao original |
| dois arquivos | o segundo fica intacto |
| histórico unificado | entrada do agente com caminho no rótulo |
| criação de arquivo | arquivo novo no VFS |
| patch TSX válido | passa pela verificação de sintaxe |
| provider retorna 500 | interface continua utilizável |
| sem chave de API | botão de envio desabilitado |

---

## Bugs encontrados pelo E2E

Sete defeitos passaram por 395 testes unitários e só apareceram no navegador.

### Críticos

1. **Service Worker servia lixo como JavaScript.**
   `new Response(r.text, ...)` passava o *método*, não a chamada
   (`r.text()`). O `Response` serializava a própria função e entregava
   `function text() { [native code] }` ao preview. **Toda página
   renderizada morria** com `Unexpected identifier 'code'`.

2. **Prefixo do bundle nunca removido.** URLs emitidas pelo bundler
   carregavam `__arcanum_`, que o cache não desfazia — o grafo de
   módulos não resolvia e o preview não montava.

3. **Atributos JSX descartados.** A transformação emitia
   `createElement("h1", null, { className: "titulo" })`: props no lugar
   errado viravam filho. O atributo sumia do elemento. O teste unitário
   afirmava a forma quebrada.

### Importantes

4. **Preview em 404 permanente ao abrir.** O auto-reload disparava antes
   da sincronização com o Service Worker; o iframe pedia os arquivos cedo
   demais e nunca recuperava. Agora depende de `syncToken`.

5. **`rewrite()` duplicava o prefixo**, produzindo
   `/__preview__/__preview__/__arcanum_...`.

6. **Ternários corrompidos.** `f(c ? "a" : b)` virava `f(c ? "a" , b)`
   porque o `:` era tratado como anotação de tipo.

7. **Rótulo do histórico sem caminho.** Mostrava `line-edit: replace`
   sem indicar qual arquivo mudou — inútil em projeto grande.

### Ajustes de infraestrutura

8. **O iframe precisa de `allow-same-origin`.** Sem isso o frame tem
   origem opaca e o Service Worker não o controla — o preview fica sempre
   em 404. O preço é que o código do preview passa a alcançar o
   `localStorage`; por isso existe a opção **"lembrar chaves"**, que
   mantém a chave apenas na memória da aba.

9. **Falhas de sincronização sumiam em silêncio.** O `catch` foi
   adicionado; sem ele um erro de IndexedDB deixava o preview em 404 sem
   nenhuma pista.

---

## Fragilidade conhecida

**Resposta vazia passa despercebida.** Se o provider responder `200` mas
não entregar nem texto nem tool call, o agente encerra com "execução
concluída sem resposta textual" — sem aviso. Foi exatamente o que
escondeu o mock quebrado por três rodadas de teste.

Mitigação em aberto: registrar um aviso quando a resposta chegou sem
conteúdo utilizável.

---

## Não verificado

Cobertura de lógica existe; execução real não foi exercitada.

- **Agentes paralelos** — 16 testes de lógica do scheduler, mas dois
  `AgentRuntime` simultâneos nunca rodaram juntos.
- **Runtime de execução** — `run_command` testado com `fetch` simulado.
  WebContainers exige COOP/COEP, que só valem após o deploy.
- **MCP e RAG** — lógica coberta; nenhuma chamada HTTP real.
- **Undo global na UI** — semântica testada; `Ctrl+Z` real não testado.

---

## Dois falsos positivos que o processo deixou passar

Registrados porque quase validaram trabalho inexistente:

1. **"patch quebrado é revertido"** passou na primeira rodada. O teste
   só afirmava que o arquivo *não* mudou — e o agente não estava
   executando nada. Passava por acidente.
2. **"erro do provider não quebra a UI"** passou sem exercitar caminho
   nenhum.

Corrigidos: o primeiro passou a exigir o conteúdo exato do arquivo, e
ambos passaram a verificar efeito real.

**Lição aplicada:** um teste que passa não prova que o sistema faz o que
o nome diz. Assertar ausência de mudança é diferente de assertar mudança
correta.

---

## Ambiente

Este workspace apaga com frequência arquivos não versionados,
`node_modules` e o cache do Playwright. Commitar antes de executar não é
exagero aqui — é o que impediu a perda do trabalho.

Se `npx playwright test` falhar com `MODULE_NOT_FOUND` ou
`Executable doesn't exist`, é o ambiente: `npm ci` e
`npx playwright install --with-deps chromium`.