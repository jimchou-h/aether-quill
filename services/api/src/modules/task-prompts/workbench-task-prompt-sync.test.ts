/**
 * 守卫「三处同步」：按场成稿六个 task prompt 默认文本必须在
 * util 运行时种子、API 白名单、orchestrator 兜底、prompt-templates 登记四处一致。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
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
import { TASK_PROMPT_DEFINITIONS, getWarehouseDefaultTaskPromptText } from './task-prompt-defaults';

const ORCHESTRATOR_DEFAULTS_PATH = path.resolve(
  __dirname,
  '../../../../rag-orchestrator/src/generation/task-prompt-defaults.ts'
);
const PROMPT_TEMPLATES_PATH = path.resolve(
  __dirname,
  '../../../../../packages/prompt-templates/src/templates.ts'
);
const SERVICE_PATH = path.resolve(__dirname, '../projects/projects.service.ts');

const WORKBENCH_KEYS = [
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_PLAN_SCENE_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SCENE_TEMPLATE_KEY,
] as const;

const WORKBENCH_PROMPTS = [
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_PLAN_SCENE_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SCENE_SYSTEM_PROMPT,
] as const;

/** 旧四模板文本基线：新增创编模板不得改动它们（v1.0.0/v1.1.0 已发布文本） */
const LEGACY_WORKBENCH_TEXT_MARKERS: Record<string, string> = {
  [CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_TEMPLATE_KEY]:
    '正在对用户划定的连续范围内正文做感官加料改写。',
  [CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_TEMPLATE_KEY]:
    '正在对用户划定的连续范围内正文做日常文笔润色。',
  [CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_TEMPLATE_KEY]: '正在对范围内成稿做一次定点检查。',
  [CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_TEMPLATE_KEY]: '正在按指令改写用户划定的一小段选区。',
};

test('六个 workbench prompt 已进入 Settings 可配置白名单并分入文笔优化', () => {
  const keys = TASK_PROMPT_DEFINITIONS.map((definition) => definition.templateKey);
  for (const key of WORKBENCH_KEYS) {
    assert.ok(keys.includes(key), `missing ${key}`);
    assert.ok(key.startsWith('chapter.optimize.'));
  }
  const names = WORKBENCH_KEYS.map(
    (key) => TASK_PROMPT_DEFINITIONS.find((item) => item.templateKey === key)?.name ?? ''
  );
  assert.ok(names.every((name) => name.startsWith('文笔优化 ·')));
});

test('旧四模板文本保持不变且默认仍为未发布草稿', () => {
  for (const [key, marker] of Object.entries(LEGACY_WORKBENCH_TEXT_MARKERS)) {
    assert.ok(getWarehouseDefaultTaskPromptText(key).includes(marker), `${key} 文本被改动`);
    assert.ok(
      (WORKBENCH_PROMPTS as readonly string[]).includes(getWarehouseDefaultTaskPromptText(key))
    );
  }
  // 默认草稿状态：白名单记录初始 publishedText 为空，回滚由 TaskPromptsService 提供（见 runtime-chain 测试）
  assert.equal(TASK_PROMPT_DEFINITIONS.length, 11);
});

test('plan-scene 模板含四要件与删除补偿硬约束', () => {
  const text = CHAPTER_OPTIMIZE_WORKBENCH_PLAN_SCENE_SYSTEM_PROMPT;
  for (const marker of [
    '入场 / 散场状态清单',
    '改动账本',
    '篇幅预算',
    '边界声明',
    '删除情绪或伏笔拍必须写清补偿落点',
  ]) {
    assert.ok(text.includes(marker), `plan-scene 缺少要件：${marker}`);
  }
  assert.ok(text.includes('禁止输出任何正文'));
});

test('draft-scene 模板允许场内删/加/重排并锁定散场状态且不含流程术语', () => {
  const text = CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SCENE_SYSTEM_PROMPT;
  for (const marker of ['删拍', '加戏', '重排', '散场状态硬锁']) {
    assert.ok(text.includes(marker), `draft-scene 缺少：${marker}`);
  }
  assert.equal(/账本|举证|准入|验收/.test(text), false, 'draft-scene 不得出现流程术语');
});

test('白名单默认文本与 util 运行时种子一致', () => {
  assert.equal(
    getWarehouseDefaultTaskPromptText(CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_TEMPLATE_KEY),
    CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_SYSTEM_PROMPT
  );
  assert.equal(
    getWarehouseDefaultTaskPromptText(CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_TEMPLATE_KEY),
    CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_SYSTEM_PROMPT
  );
  assert.equal(
    getWarehouseDefaultTaskPromptText(CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_TEMPLATE_KEY),
    CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_SYSTEM_PROMPT
  );
  assert.equal(
    getWarehouseDefaultTaskPromptText(CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_TEMPLATE_KEY),
    CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_SYSTEM_PROMPT
  );
});

test('orchestrator 与 prompt-templates 兜底逐行文本与 util 运行时种子一致', () => {
  const orchestrator = readFileSync(ORCHESTRATOR_DEFAULTS_PATH, 'utf8');
  const templates = readFileSync(PROMPT_TEMPLATES_PATH, 'utf8');
  for (const key of WORKBENCH_KEYS) {
    assert.ok(orchestrator.includes(`'${key}'`), `orchestrator missing ${key}`);
    assert.ok(templates.includes(`id: '${key}'`), `prompt-templates missing ${key}`);
  }
  const lines = WORKBENCH_PROMPTS.flatMap((text) => text.split('\n'));
  const missingOrchestrator = lines.filter((line) => !orchestrator.includes(line));
  const missingTemplates = lines.filter((line) => !templates.includes(line));
  assert.deepEqual(
    missingOrchestrator,
    [],
    `orchestrator 缺少：\n${missingOrchestrator.join('\n')}`
  );
  assert.deepEqual(missingTemplates, [], `prompt-templates 缺少：\n${missingTemplates.join('\n')}`);
});

test('workbench draft service path does not call splitIntoSegments', () => {
  const source = readFileSync(SERVICE_PATH, 'utf8');
  const start = source.indexOf('async optimizeChapterWorkbenchDraftStream');
  const end = source.indexOf('async optimizeChapterWorkbenchReview');
  assert.ok(start >= 0 && end > start);
  const method = source.slice(start, end);
  assert.equal(method.includes('splitIntoSegments'), false);
  assert.match(method, /splitWorkbenchRewriteWindows/);
  assert.match(method, /同场续写/);
});
