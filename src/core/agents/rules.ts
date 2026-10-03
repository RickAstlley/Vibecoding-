import { basename } from '../vfs/paths';

export interface RulesDoc {
  path: string;
  content: string;
  bytes: number;
}

const RULES_FILES = ['AGENTS.md', 'CLAUDE.md', '.weaver/rules.md', 'CONVENTIONS.md'];
const MAX_RULES_BYTES = 12000;

/**
 * Coleta as instrucoes do projeto (rules files) para entrar no system prompt.
 * Prioridade: quanto mais perto da raiz, mais especifico.
 */
export async function loadRules(
  read: (path: string) => Promise<string | null>,
  root: string,
): Promise<RulesDoc[]> {
  const found: RulesDoc[] = [];

  for (const name of RULES_FILES) {
    const path = name.startsWith('.') || name.includes('/') ? name : `${name}`;
    const content = await read(path);
    if (content && content.trim().length > 0) {
      found.push({ path, content: content.slice(0, MAX_RULES_BYTES), bytes: content.length });
    }
  }

  if (root) {
    for (const name of RULES_FILES) {
      const path = `${root}/${name}`;
      const content = await read(path);
      if (content && content.trim().length > 0) {
        found.push({ path, content: content.slice(0, MAX_RULES_BYTES), bytes: content.length });
      }
    }
  }

  return found;
}

export function renderRules(docs: RulesDoc[]): string {
  if (docs.length === 0) return '';
  const parts = docs.map((doc) => {
    const truncated = doc.bytes > MAX_RULES_BYTES ? '\n<!-- truncado -->' : '';
    return `<project-rules source="${basename(doc.path)}">\n${doc.content}${truncated}\n</project-rules>`;
  });
  return parts.join('\n\n');
}

export const RULES_TEMPLATE = `# Instrucoes do projeto

Este arquivo e lido pelo agente a cada execucao. Use para ditar convencoes
de codigo, padroes de arquitetura, comandos de teste e regras de negocio.

## Convencoes
- (ex.: usar \`function\` em vez de arrow em componentes)
- (ex.: nunca usar \`any\`, preferir \`unknown\`)

## Arquitetura
- (ex.: estado global fica em \`src/stores\`, nunca em Context)

## Comandos
- Instalar: \`npm install\`
- Testar: \`npm test\`
- Build: \`npm run build\`

## O que nunca fazer
- (ex.: nao editar arquivos de \`node_modules\`)
- (ex.: nao remover migracoes existentes)
`;