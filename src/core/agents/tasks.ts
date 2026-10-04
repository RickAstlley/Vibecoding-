export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

export interface Task {
  id: string;
  runId: string;
  text: string;
  status: TaskStatus;
  targetPath: string | null;
  createdAt: number;
  updatedAt: number;
}

const STATUS_ICON: Record<TaskStatus, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  done: '[x]',
  cancelled: '[-]',
};

const STATUS_LINE = /^\s*(?:[-*+]|\d+[.)])?\s*(\[[ x~-]\])\s*(.+?)\s*$/i;

/**
 * Extrai checklist do texto do agente. Aceita markdown de GFM
 * (`- [ ] tarefa`) e o formato numerado do modo Planejador.
 */
export function parseTasks(text: string, runId: string, now = Date.now()): Task[] {
  const out: Task[] = [];
  const lines = text.split('\n');
  let counter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const m = STATUS_LINE.exec(line);
    if (!m) continue;

    const mark = (m[1] as string).toLowerCase();
    const body = m[2] as string;
    if (body.length < 3) continue;

    const status: TaskStatus = mark.includes('x') ? 'done' : mark.includes('~') ? 'in_progress' : mark.includes('-') ? 'cancelled' : 'pending';
    const targetPath = extractPath(body);
    out.push({
      id: `t${now.toString(36)}${counter++}`,
      runId,
      text: body,
      status,
      targetPath,
      createdAt: now + counter,
      updatedAt: now + counter,
    });
  }

  return out;
}

function extractPath(text: string): string | null {
  const explicit = text.match(/`([^`]+\.[a-z0-9]{1,6})`/i) ?? text.match(/\b((?:[\w.-]+\/)*[\w.-]+\.[a-z0-9]{1,6})\b/i);
  return explicit?.[1] ?? null;
}

/**
 * Mescla o texto do agente na lista, sem duplicar. Itens que reapareceram
 * com `[x]` sobem para concluidos; novos entram como pendentes.
 */
export function mergeTasks(existing: Task[], incoming: Task[]): Task[] {
  const byText = new Map(existing.map((t) => [normalize(t.text), t]));
  const order: Task[] = [];

  for (const task of incoming) {
    const key = normalize(task.text);
    const prev = byText.get(key);
    if (prev) {
      // Nunca reabre uma tarefa ja concluida por atualizacao de status.
      const status = prev.status === 'done' ? 'done' : task.status;
      const merged: Task = { ...prev, status, targetPath: task.targetPath ?? prev.targetPath, updatedAt: task.updatedAt };
      byText.set(key, merged);
    } else {
      byText.set(key, task);
    }
  }

  for (const t of existing) {
    const key = normalize(t.text);
    const next = byText.get(key);
    if (next) order.push(next);
  }
  return order;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function renderTasks(tasks: Task[]): string {
  if (tasks.length === 0) return '';
  return tasks.map((t) => `- ${STATUS_ICON[t.status]} ${t.text}`).join('\n');
}

export function progressOf(tasks: Task[]): { done: number; total: number; percent: number } {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'cancelled').length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Ferramenta que o agente usa para marcar progresso. */
export const TASK_TOOL = {
  name: 'update_tasks',
  description:
    'Atualiza a lista de tarefas. Envie a lista INTEIRA no formato "- [ ] texto", marcando concluidas com "- [x]".',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'Lista completa de tarefas com status',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Descricao curta da tarefa' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'done', 'cancelled'],
              description: 'Status da tarefa',
            },
          },
          required: ['text', 'status'],
        },
      },
    },
    required: ['tasks'],
  },
} as const;

export function tasksToToolArgs(tasks: Task[]): Record<string, unknown> {
  return {
    tasks: tasks.map((t) => ({ text: t.text, status: t.status })),
  };
}