/**
 * 守卫智能精修五个 task prompt 的「多处同步」：
 * util 运行时种子、API 白名单默认文本、orchestrator 兜底、prompt-templates 登记必须逐行一致。
 *
 * 动机：AQ-383 期间「信息量与感官密度」保真守卫只落到 util，另两处镜像漏改，
 * 直到真实样章复跑才被发现。此测试把三处镜像纳入自动化门禁。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CHAPTER_REFINEMENT_INSPECT_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_PLAN_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REPAIR_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REVIEW_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REWRITE_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_TEMPLATE_KEYS,
} from '../projects/chapter-refinement.util';
import { getWarehouseDefaultTaskPromptText } from './task-prompt-defaults';

const ORCHESTRATOR_DEFAULTS_PATH = path.resolve(
  __dirname,
  '../../../../rag-orchestrator/src/generation/task-prompt-defaults.ts'
);
const PROMPT_TEMPLATES_PATH = path.resolve(
  __dirname,
  '../../../../../packages/prompt-templates/src/templates.ts'
);

// 顺序与 CHAPTER_REFINEMENT_TEMPLATE_KEYS 一致：utility（inspect/plan/review）+ writing（rewrite/repair）
const REFINEMENT_PROMPTS: ReadonlyArray<readonly [string, string]> = [
  [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY, CHAPTER_REFINEMENT_INSPECT_SYSTEM_PROMPT],
  [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY, CHAPTER_REFINEMENT_PLAN_SYSTEM_PROMPT],
  [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY, CHAPTER_REFINEMENT_REVIEW_SYSTEM_PROMPT],
  [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY, CHAPTER_REFINEMENT_REWRITE_SYSTEM_PROMPT],
  [CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY, CHAPTER_REFINEMENT_REPAIR_SYSTEM_PROMPT],
];

test('五个精修模板 key 齐备且顺序稳定', () => {
  assert.deepEqual(
    [...CHAPTER_REFINEMENT_TEMPLATE_KEYS],
    REFINEMENT_PROMPTS.map(([key]) => key)
  );
});

test('API 白名单默认文本与 util 运行时种子一致', () => {
  for (const [key, seed] of REFINEMENT_PROMPTS) {
    assert.equal(getWarehouseDefaultTaskPromptText(key), seed, `${key} 白名单与 util 种子不一致`);
  }
});

test('orchestrator 与 prompt-templates 镜像逐行与 util 种子一致', () => {
  const orchestrator = readFileSync(ORCHESTRATOR_DEFAULTS_PATH, 'utf8');
  const templates = readFileSync(PROMPT_TEMPLATES_PATH, 'utf8');
  for (const [key, seed] of REFINEMENT_PROMPTS) {
    assert.ok(orchestrator.includes(`'${key}'`), `orchestrator 缺少模板 ${key}`);
    assert.ok(templates.includes(`id: '${key}'`), `prompt-templates 缺少模板 ${key}`);
    const missingOrchestrator = seed.split('\n').filter((line) => !orchestrator.includes(line));
    const missingTemplates = seed.split('\n').filter((line) => !templates.includes(line));
    assert.deepEqual(
      missingOrchestrator,
      [],
      `orchestrator ${key} 缺少行：\n${missingOrchestrator.join('\n')}`
    );
    assert.deepEqual(
      missingTemplates,
      [],
      `prompt-templates ${key} 缺少行：\n${missingTemplates.join('\n')}`
    );
  }
});

test('rewrite 保真守卫（信息量／感官密度）在三处镜像均存在', () => {
  const guard = '重写后本范围的信息量与感官密度不得低于原文对应部分';
  assert.ok(CHAPTER_REFINEMENT_REWRITE_SYSTEM_PROMPT.includes(guard), 'util 种子缺保真守卫');
  assert.ok(
    readFileSync(ORCHESTRATOR_DEFAULTS_PATH, 'utf8').includes(guard),
    'orchestrator 镜像缺保真守卫'
  );
  assert.ok(
    readFileSync(PROMPT_TEMPLATES_PATH, 'utf8').includes(guard),
    'prompt-templates 镜像缺保真守卫'
  );
});
