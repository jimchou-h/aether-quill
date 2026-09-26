/**
 * 守卫「三处同步」：按场成稿四个 task prompt 默认文本必须在
 * util 运行时种子、API 白名单、orchestrator 兜底、prompt-templates 登记四处一致。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_TEMPLATE_KEY,
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
] as const;

const WORKBENCH_PROMPTS = [
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_SYSTEM_PROMPT,
] as const;

test('四个 workbench prompt 已进入 Settings 可配置白名单并分入文笔优化', () => {
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
