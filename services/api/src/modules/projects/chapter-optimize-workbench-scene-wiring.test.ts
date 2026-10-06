/**
 * #33 服务编排守卫：workbench plan 路由 + draft from-plan 分支。
 *
 * 沿用仓库既有的「源码结构守卫」口径（见 task-prompts/workbench-task-prompt-sync.test.ts）：
 * 纯函数与契约分别由 util.test / openapi.test 覆盖，这里只钉住编排接线。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const CONTROLLER_PATH = path.resolve(__dirname, 'projects.controller.ts');
const SERVICE_PATH = path.resolve(__dirname, 'projects.service.ts');

test('plan 路由挂在 workbench/plan 且入参 400 校验后转交服务', () => {
  const controller = readFileSync(CONTROLLER_PATH, 'utf8');
  assert.match(
    controller,
    /@Post\(':id\/knowledge\/chapters\/:chapterNo\/optimize\/workbench\/plan'\)/
  );
  assert.match(controller, /assertWorkbenchPlanRequest\(data\)/);
  assert.match(controller, /optimizeChapterWorkbenchPlanStream\(/);
});

test('plan 服务方法走方案模板并复用 SSE 转发', () => {
  const service = readFileSync(SERVICE_PATH, 'utf8');
  const start = service.indexOf('async optimizeChapterWorkbenchPlanStream');
  const end = service.indexOf('async optimizeChapterWorkbenchDraftStream');
  assert.ok(start >= 0 && end > start, 'optimizeChapterWorkbenchPlanStream 未定义或顺序异常');
  const method = service.slice(start, end);
  assert.match(method, /assertWorkbenchPlanRequest/);
  assert.match(method, /buildWorkbenchPlanUserPrompt/);
  assert.match(method, /CHAPTER_OPTIMIZE_WORKBENCH_PLAN_SCENE_TEMPLATE_KEY/);
  assert.match(method, /streamOrchestratorPlanGeneration/);
});

test('streamOrchestratorPlanGeneration 支持 templateKey 覆盖且默认旧方案模板', () => {
  const service = readFileSync(SERVICE_PATH, 'utf8');
  const start = service.indexOf('private async streamOrchestratorPlanGeneration');
  const end = service.indexOf('private async generateOptimizeDraftSegment');
  assert.ok(start >= 0 && end > start, 'streamOrchestratorPlanGeneration 未定义或顺序异常');
  const method = service.slice(start, end);
  assert.match(method, /input\.templateKey \?\? CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY/);
});

test('draft from-plan 分支用 scene 模板，direct 分支保持原两档', () => {
  const service = readFileSync(SERVICE_PATH, 'utf8');
  const start = service.indexOf('async optimizeChapterWorkbenchDraftStream');
  const end = service.indexOf('async optimizeChapterWorkbenchReview');
  assert.ok(start >= 0 && end > start, 'optimizeChapterWorkbenchDraftStream 未定义或顺序异常');
  const method = service.slice(start, end);
  assert.match(method, /mode === 'from-plan'/);
  assert.match(method, /buildWorkbenchSceneDraftUserPrompt/);
  assert.match(method, /CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SCENE_TEMPLATE_KEY/);
  assert.match(method, /resolveWorkbenchDraftTemplateKey/);
  assert.match(method, /buildWorkbenchDraftUserPrompt/);
  assert.match(method, /splitWorkbenchRewriteWindows/);
});
