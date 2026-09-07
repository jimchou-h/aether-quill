import type { TaskPromptListItem } from '../services/api';

export type TaskPromptGroupId = 'writing' | 'pipeline' | 'compliance';

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
  {
    id: 'pipeline',
    title: '创作精修',
    hint: '特征润色、感官优化、同质化与意向书等各模块 Prompt',
    defaultOpen: true,
  },
  {
    id: 'compliance',
    title: '终稿合规',
    hint: '发布前硬规则：大纲、改写、残留修复与落实验收',
    defaultOpen: true,
  },
];

export function resolveTaskPromptGroupId(templateKey: string): TaskPromptGroupId {
  const key = templateKey.trim();
  if (key.startsWith('chapter.optimize.')) {
    return 'writing';
  }
  if (key.startsWith('chapter.compliance.') || key === 'chapter.pipeline.rules.fix') {
    return 'compliance';
  }
  return 'pipeline';
}

export function groupTaskPromptItems(
  items: TaskPromptListItem[]
): Record<TaskPromptGroupId, TaskPromptListItem[]> {
  const grouped: Record<TaskPromptGroupId, TaskPromptListItem[]> = {
    writing: [],
    pipeline: [],
    compliance: [],
  };
  for (const item of items) {
    grouped[resolveTaskPromptGroupId(item.templateKey)].push(item);
  }
  return grouped;
}
