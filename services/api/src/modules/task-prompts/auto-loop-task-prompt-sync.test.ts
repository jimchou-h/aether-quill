/**
 * 守卫「三处同步」：自动优化循环的两个 task prompt 默认文本必须在
 * util 运行时种子、API 白名单、orchestrator 兜底三处一致。
 *
 * orchestrator 是独立服务、文本为字面复制，无法跨包 import，
 * 因此这里读取其源文件做文本比对——漏改一处会当场红灯，
 * 而不是等到 context sync 失败时静默用错 prompt。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CHAPTER_AUTO_LOOP_DRAFT_SYSTEM_PROMPT,
  CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
  CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT,
  CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
} from '../projects/chapter-auto-loop.util';
import { TASK_PROMPT_DEFINITIONS, getWarehouseDefaultTaskPromptText } from './task-prompt-defaults';

const ORCHESTRATOR_DEFAULTS_PATH = path.resolve(
  __dirname,
  '../../../../rag-orchestrator/src/generation/task-prompt-defaults.ts'
);

function readOrchestratorDefaults(): string {
  return readFileSync(ORCHESTRATOR_DEFAULTS_PATH, 'utf8');
}

test('两个循环 prompt 已进入 Settings 可配置白名单', () => {
  const keys = TASK_PROMPT_DEFINITIONS.map((definition) => definition.templateKey);
  assert.ok(keys.includes(CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY));
  assert.ok(keys.includes(CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY));
});

test('白名单默认文本与 util 运行时种子一致', () => {
  assert.equal(
    getWarehouseDefaultTaskPromptText(CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY),
    CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT
  );
  assert.equal(
    getWarehouseDefaultTaskPromptText(CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY),
    CHAPTER_AUTO_LOOP_DRAFT_SYSTEM_PROMPT
  );
});

test('orchestrator 兜底登记了两个循环 key', () => {
  const source = readOrchestratorDefaults();
  assert.ok(source.includes(`'${CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY}'`));
  assert.ok(source.includes(`'${CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY}'`));
});

test('orchestrator 兜底逐行文本与 util 运行时种子一致', () => {
  const source = readOrchestratorDefaults();
  const lines = [
    ...CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT.split('\n'),
    ...CHAPTER_AUTO_LOOP_DRAFT_SYSTEM_PROMPT.split('\n'),
  ];
  const missing = lines.filter((line) => !source.includes(line));
  assert.deepEqual(missing, [], `orchestrator 兜底缺少以下行：\n${missing.join('\n')}`);
});

test('循环 prompt 使用 chapter.optimize 命名空间以复用现有 Settings 分组', () => {
  assert.ok(CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY.startsWith('chapter.optimize.'));
  assert.ok(CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY.startsWith('chapter.optimize.'));
});
