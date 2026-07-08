import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterPipelineConfig, ChapterPipelineSessionView } from '../services/api';
import {
  resolveManualContinueAction,
  resolvePipelineBootstrapAction,
} from './chapterPipelineOptimizeFlow';

function buildConfig(overrides: Partial<ChapterPipelineConfig> = {}): ChapterPipelineConfig {
  return {
    pipelinePreset: 'creative_refine',
    pipelineSkipSensoryOutlineReview: false,
    pipelineSkipCharacterOutlineReview: false,
    pipelineSkipCharacterTraitsOutlineReview: false,
    pipelineCharacterAdjustmentEnabled: true,
    pipelineCharacterTraitsEnabled: true,
    pipelineRulesFixMode: 'auto',
    pipelineHomogenizationEnabled: false,
    pipelineHomogenizationPriorChapterCount: 0,
    pipelineEnabledModules: [1, 2],
    ...overrides,
  };
}

function buildSession(
  overrides: Partial<ChapterPipelineSessionView> = {}
): ChapterPipelineSessionView {
  return {
    sessionId: 'session-1',
    chapterNo: 1,
    config: buildConfig(),
    currentModule: 0,
    versions: { original: '原文' },
    sourceUpdatedAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  };
}

test('分步启动落在首个大纲 gate，且不自动调用 outline module', () => {
  const action = resolvePipelineBootstrapAction(false, buildConfig(), buildSession());
  assert.deepEqual(action, {
    step: 'character-outline',
    module: null,
    autoRun: false,
  });
});

test('全自动启动仍直接运行 run-all', () => {
  const action = resolvePipelineBootstrapAction(true, buildConfig(), buildSession());
  assert.deepEqual(action, {
    step: 'character-outline',
    module: 'run-all',
    autoRun: true,
  });
});

test('分步启动若 session 已有未确认角色大纲，则直接展示缓存 gate 且不重生成', () => {
  const session = buildSession({
    characterOutline: {
      required: [{ id: 'r1', text: '保留既有大纲', priority: 'required' }],
      suggested: [],
      userConfirmed: false,
      revisionRound: 1,
    },
  });
  const action = resolvePipelineBootstrapAction(false, buildConfig(), session);
  assert.deepEqual(action, {
    step: 'character-outline',
    module: null,
    autoRun: false,
  });
});

test('角色调整后继续下一步时，若下一模块无缓存大纲，则只进入 gate', () => {
  const action = resolveManualContinueAction('character', buildConfig(), buildSession());
  assert.deepEqual(action, {
    step: 'character-traits-outline',
    module: null,
    autoRun: false,
  });
});

test('角色调整后若特征大纲已确认，则直接运行特征润色正文', () => {
  const session = buildSession({
    characterTraitsOutline: {
      required: [],
      suggested: [],
      userConfirmed: true,
      revisionRound: 1,
    },
  });
  const action = resolveManualContinueAction('character', buildConfig(), session);
  assert.deepEqual(action, {
    step: 'character-traits',
    module: 'character-traits',
    autoRun: true,
  });
});

test('特征润色后继续下一步时，感官模块也遵循懒生成', () => {
  const session = buildSession({
    versions: {
      original: '原文',
      afterCharacter: '角色调整后',
      afterCharacterTraits: '特征润色后',
    },
  });
  const action = resolveManualContinueAction('character-traits', buildConfig(), session);
  assert.deepEqual(action, {
    step: 'sensory-outline',
    module: null,
    autoRun: false,
  });
});

test('特征润色后若感官大纲已缓存但未确认，则直接展示缓存 gate', () => {
  const session = buildSession({
    versions: {
      original: '原文',
      afterCharacter: '角色调整后',
      afterCharacterTraits: '特征润色后',
    },
    sensoryOutline: {
      required: [{ id: 's1', text: '已有感官项', priority: 'required' }],
      suggested: [],
      userConfirmed: false,
      revisionRound: 2,
    },
  });
  const action = resolveManualContinueAction('character-traits', buildConfig(), session);
  assert.deepEqual(action, {
    step: 'sensory-outline',
    module: null,
    autoRun: false,
  });
});
