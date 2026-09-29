import type { TaskPromptListItem } from '../services/api';

export type TaskPromptGroupId = 'writing';

export interface TaskPromptGroupDefinition {
  id: TaskPromptGroupId;
  title: string;
  hint: string;
  defaultOpen: boolean;
}

export const TASK_PROMPT_GROUP_DEFINITIONS: TaskPromptGroupDefinition[] = [
  {
    id: 'writing',
    title: '文笔优化',
    hint: '自由优化要求：方案改写、直接改写与正文 Prompt',
    defaultOpen: true,
  },
];

export function resolveTaskPromptGroupId(templateKey: string): TaskPromptGroupId | null {
  const key = templateKey.trim();
  if (key.startsWith('chapter.optimize.')) {
    return 'writing';
  }
  return null;
}

export function groupTaskPromptItems(
  items: TaskPromptListItem[]
): Record<TaskPromptGroupId, TaskPromptListItem[]> {
  const grouped: Record<TaskPromptGroupId, TaskPromptListItem[]> = {
    writing: [],
  };
  for (const item of items) {
    const groupId = resolveTaskPromptGroupId(item.templateKey);
    if (groupId) {
      grouped[groupId].push(item);
    }
  }
  return grouped;
}
