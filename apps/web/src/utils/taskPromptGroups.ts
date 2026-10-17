import type { TaskPromptListItem } from '../services/api';

export type TaskPromptGroupId = 'writing' | 'refinement';

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
    id: 'refinement',
    title: '智能精修',
    hint: '五个固定职责模板：诊断 / 规划 / 正文 / 检查 / 补修；发布只影响新运行',
    defaultOpen: true,
  },
];

/**
 * 智能精修五个模板的职责与档位（B5 / R12）。
 *
 * `tier` 决定编排器是否注入项目长文风与文风样本：
 * 只有 writing 档（rewrite / repair）注入，utility 档（inspect / plan / review）不注入。
 */
export type RefinementTaskTier = 'utility' | 'writing';

export interface RefinementTaskRole {
  templateKey: string;
  /** 一句话职责，展示在设置页上 */
  duty: string;
  tier: RefinementTaskTier;
}

export const REFINEMENT_TASK_ROLES: RefinementTaskRole[] = [
  {
    templateKey: 'chapter.refinement.inspect',
    duty: '逐窗诊断（场景与事实 / 问题）',
    tier: 'utility',
  },
  {
    templateKey: 'chapter.refinement.plan',
    duty: '整章规划（场景 brief 与首尾事实）',
    tier: 'utility',
  },
  { templateKey: 'chapter.refinement.rewrite', duty: '范围正文改写', tier: 'writing' },
  {
    templateKey: 'chapter.refinement.review',
    duty: '检查（有证据问题与末态状态）',
    tier: 'utility',
  },
  { templateKey: 'chapter.refinement.repair', duty: '定点补修具体缺口', tier: 'writing' },
];

const REFINEMENT_ROLE_BY_KEY = new Map(
  REFINEMENT_TASK_ROLES.map((role) => [role.templateKey, role])
);

export const REFINEMENT_TASK_TEMPLATE_KEYS: string[] = REFINEMENT_TASK_ROLES.map(
  (role) => role.templateKey
);

/** 取模板的职责与档位；非精修模板返回 null。 */
export function resolveRefinementTaskRole(templateKey: string): RefinementTaskRole | null {
  return REFINEMENT_ROLE_BY_KEY.get(templateKey.trim()) ?? null;
}

export function resolveTaskPromptGroupId(templateKey: string): TaskPromptGroupId | null {
  const key = templateKey.trim();
  if (key.startsWith('chapter.optimize.')) {
    return 'writing';
  }
  if (key.startsWith('chapter.refinement.')) {
    return 'refinement';
  }
  return null;
}

export function groupTaskPromptItems(
  items: TaskPromptListItem[]
): Record<TaskPromptGroupId, TaskPromptListItem[]> {
  const grouped: Record<TaskPromptGroupId, TaskPromptListItem[]> = {
    writing: [],
    refinement: [],
  };
  for (const item of items) {
    const groupId = resolveTaskPromptGroupId(item.templateKey);
    if (groupId) {
      grouped[groupId].push(item);
    }
  }
  return grouped;
}

/** 档位显示文本；非精修模板返回 null。 */
export function describeRefinementTier(templateKey: string): string | null {
  const role = resolveRefinementTaskRole(templateKey);
  if (!role) {
    return null;
  }
  return role.tier === 'writing' ? '写作档（注入文风）' : '工具档（不注入文风）';
}
