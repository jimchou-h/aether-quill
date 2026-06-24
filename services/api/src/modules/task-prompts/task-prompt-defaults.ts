import {
  CHAPTER_OPTIMIZE_DRAFT_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_TYPO_CHECK_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_TYPO_CHECK_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_TYPO_FIX_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_TYPO_FIX_TEMPLATE_KEY,
} from '../projects/chapter-optimize.util';

export interface TaskPromptDefinition {
  templateKey: string;
  name: string;
  defaultText: string;
}

/** 首期 task prompt 白名单（与需求 AQ-250 一致） */
export const TASK_PROMPT_DEFINITIONS: TaskPromptDefinition[] = [
  {
    templateKey: CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
    name: '章节优化 · 方案',
    defaultText: CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
    name: '章节优化 · 正文',
    defaultText: CHAPTER_OPTIMIZE_DRAFT_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_TYPO_CHECK_TEMPLATE_KEY,
    name: '章节优化 · 错字检查',
    defaultText: CHAPTER_OPTIMIZE_TYPO_CHECK_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_TYPO_FIX_TEMPLATE_KEY,
    name: '章节优化 · 错字修正',
    defaultText: CHAPTER_OPTIMIZE_TYPO_FIX_SYSTEM_PROMPT,
  },
];

const DEFINITION_BY_KEY = new Map(
  TASK_PROMPT_DEFINITIONS.map((item) => [item.templateKey, item] as const)
);

export function isAllowedTaskPromptKey(templateKey: string): boolean {
  return DEFINITION_BY_KEY.has(templateKey.trim());
}

export function getTaskPromptDefinition(templateKey: string): TaskPromptDefinition {
  const key = templateKey.trim();
  const def = DEFINITION_BY_KEY.get(key);
  if (!def) {
    throw new Error(`不支持的 task prompt templateKey: ${templateKey}`);
  }
  return def;
}

export function getWarehouseDefaultTaskPromptText(templateKey: string): string {
  return getTaskPromptDefinition(templateKey).defaultText;
}
