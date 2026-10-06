import {
  CHAPTER_OPTIMIZE_DIRECT_DRAFT_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_DIRECT_DRAFT_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_DRAFT_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
} from '../projects/chapter-optimize.util';
import {
  CHAPTER_AUTO_LOOP_DRAFT_SYSTEM_PROMPT,
  CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
  CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT,
  CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
} from '../projects/chapter-auto-loop.util';
import {
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SCENE_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SCENE_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_PLAN_SCENE_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_PLAN_SCENE_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_TEMPLATE_KEY,
} from '../projects/chapter-optimize-workbench.util';

export interface TaskPromptDefinition {
  templateKey: string;
  name: string;
  defaultText: string;
}

/** 项目 task prompt 白名单（文笔优化三模式 + 按场成稿） */
export const TASK_PROMPT_DEFINITIONS: TaskPromptDefinition[] = [
  {
    templateKey: CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
    name: '文笔优化 · 方案',
    defaultText: CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
    name: '文笔优化 · 正文',
    defaultText: CHAPTER_OPTIMIZE_DRAFT_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_DIRECT_DRAFT_TEMPLATE_KEY,
    name: '文笔优化 · 直接正文',
    defaultText: CHAPTER_OPTIMIZE_DIRECT_DRAFT_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
    name: '文笔优化 · 自动循环复诊',
    defaultText: CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
    name: '文笔优化 · 自动循环段落改写',
    defaultText: CHAPTER_AUTO_LOOP_DRAFT_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_TEMPLATE_KEY,
    name: '文笔优化 · 按场成稿（感官加料）',
    defaultText: CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_TEMPLATE_KEY,
    name: '文笔优化 · 按场成稿（日常文笔）',
    defaultText: CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_TEMPLATE_KEY,
    name: '文笔优化 · 按场成稿检查',
    defaultText: CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_TEMPLATE_KEY,
    name: '文笔优化 · 按场成稿点句修复',
    defaultText: CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_WORKBENCH_PLAN_SCENE_TEMPLATE_KEY,
    name: '文笔优化 · 按场创编方案',
    defaultText: CHAPTER_OPTIMIZE_WORKBENCH_PLAN_SCENE_SYSTEM_PROMPT,
  },
  {
    templateKey: CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SCENE_TEMPLATE_KEY,
    name: '文笔优化 · 按场创编成稿',
    defaultText: CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SCENE_SYSTEM_PROMPT,
  },
];

export function listTaskPromptTemplateKeys(): string[] {
  return TASK_PROMPT_DEFINITIONS.map((item) => item.templateKey);
}

export function isAllowedTaskPromptKey(templateKey: string): boolean {
  return TASK_PROMPT_DEFINITIONS.some((item) => item.templateKey === templateKey);
}

export function getTaskPromptDefinition(templateKey: string): TaskPromptDefinition | undefined {
  return TASK_PROMPT_DEFINITIONS.find((item) => item.templateKey === templateKey);
}

export function getWarehouseDefaultTaskPromptText(templateKey: string): string {
  const found = getTaskPromptDefinition(templateKey);
  if (!found) {
    throw new Error(`Unknown task prompt templateKey: ${templateKey}`);
  }
  return found.defaultText;
}
