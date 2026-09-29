import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyAiTaskProgressEvent,
  cancelAiTaskProgress,
  completeAiTaskProgress,
  createAiTaskProgressState,
  dismissIdleAiTaskProgress,
  failAiTaskProgress,
  resolveAiTaskProgressMessage,
  tryStartAiTaskProgress,
} from '../composables/useAiTaskProgress';

describe('resolveAiTaskProgressMessage', () => {
  it('has activity-bar copy for the auto-loop task key', () => {
    assert.equal(resolveAiTaskProgressMessage('chapter.optimize.auto-loop'), '自动优化循环执行中…');
  });

  it('keeps the existing optimize copy untouched', () => {
    assert.equal(resolveAiTaskProgressMessage('chapter.optimize.plan'), '正在生成优化方案…');
    assert.equal(resolveAiTaskProgressMessage('chapter.optimize.draft'), '正在生成优化正文…');
  });

  it('falls back for an unmapped key', () => {
    assert.equal(resolveAiTaskProgressMessage('nope.unknown', '兜底文案'), '兜底文案');
    assert.equal(resolveAiTaskProgressMessage('nope.unknown'), '正在处理…');
  });
});

describe('tryStartAiTaskProgress', () => {
  it('starts an idle activity with chapter and source fields', () => {
    const state = createAiTaskProgressState();
    const result = tryStartAiTaskProgress(state, {
      taskKey: 'chapter.summarize',
      message: '正在生成第 3 章摘要…',
      source: 'page',
      chapterNo: 3,
      interruptible: false,
    });

    assert.equal(result.ok, true);
    assert.equal(state.value.active, true);
    assert.equal(state.value.taskKey, 'chapter.summarize');
    assert.equal(state.value.message, '正在生成第 3 章摘要…');
    assert.equal(state.value.source, 'page');
    assert.equal(state.value.chapterNo, 3);
    assert.equal(state.value.stage, 'running');
    assert.equal(state.value.interruptible, false);
  });

  it('rejects a second start while active without force (no silent overwrite)', () => {
    const state = createAiTaskProgressState();
    tryStartAiTaskProgress(state, {
      taskKey: 'chapter.summarize',
      message: '正在生成第 1 章摘要…',
      source: 'page',
      chapterNo: 1,
    });

    const result = tryStartAiTaskProgress(state, {
      taskKey: 'chapter.relation-events',
      message: '正在抽取第 2 章关系事件…',
      source: 'page',
      chapterNo: 2,
    });

    assert.equal(result.ok, false);
    if (result.ok) {
      assert.fail('expected busy');
    }
    assert.equal(result.reason, 'busy');
    assert.equal(state.value.taskKey, 'chapter.summarize');
    assert.equal(state.value.chapterNo, 1);
    assert.equal(state.value.message, '正在生成第 1 章摘要…');
  });

  it('allows force start to replace an active activity after user confirms interrupt', () => {
    const state = createAiTaskProgressState();
    tryStartAiTaskProgress(state, {
      taskKey: 'chapter.summarize',
      message: '正在生成第 1 章摘要…',
      source: 'page',
      chapterNo: 1,
    });

    const result = tryStartAiTaskProgress(state, {
      taskKey: 'chapter.relation-events',
      message: '正在抽取第 2 章关系事件…',
      source: 'page',
      chapterNo: 2,
      force: true,
    });

    assert.equal(result.ok, true);
    assert.equal(state.value.taskKey, 'chapter.relation-events');
    assert.equal(state.value.chapterNo, 2);
  });

  it('tracks progress steps and completes without staying active', () => {
    const state = createAiTaskProgressState();
    tryStartAiTaskProgress(state, {
      taskKey: 'chapter.summarize',
      message: '正在生成第 3 章摘要…',
      source: 'page',
      chapterNo: 3,
    });
    applyAiTaskProgressEvent(state, {
      taskKey: 'chapter.summarize',
      stage: 'processing',
      message: '正在生成章节摘要（1/1）…',
      currentStep: 1,
      totalSteps: 1,
    });
    completeAiTaskProgress(state, '第 3 章摘要已完成');

    assert.equal(state.value.active, false);
    assert.equal(state.value.stage, 'completed');
    assert.equal(state.value.message, '第 3 章摘要已完成');
    assert.equal(state.value.currentStep, 1);
    assert.equal(state.value.totalSteps, 1);
  });

  it('records failed and cancelled terminal states', () => {
    const failed = createAiTaskProgressState();
    tryStartAiTaskProgress(failed, {
      taskKey: 'chapter.summarize',
      message: '正在生成第 1 章摘要…',
      source: 'page',
      chapterNo: 1,
    });
    failAiTaskProgress(failed, '摘要失败');
    assert.equal(failed.value.active, false);
    assert.equal(failed.value.stage, 'failed');
    assert.equal(failed.value.error, '摘要失败');

    const cancelled = createAiTaskProgressState();
    tryStartAiTaskProgress(cancelled, {
      taskKey: 'chapter.summarize',
      message: '正在生成第 1 章摘要…',
      source: 'page',
      chapterNo: 1,
      interruptible: true,
    });
    cancelAiTaskProgress(cancelled);
    assert.equal(cancelled.value.active, false);
    assert.equal(cancelled.value.cancelled, true);
    assert.equal(cancelled.value.stage, 'cancelled');
  });

  it('dismissIdleAiTaskProgress clears completed banners but keeps active work', () => {
    const idle = createAiTaskProgressState();
    tryStartAiTaskProgress(idle, {
      taskKey: 'chapter.optimize.plan',
      message: '正在生成优化方案…',
      source: 'dialog:optimize',
      chapterNo: 1,
    });
    completeAiTaskProgress(idle, '优化方案已生成');
    dismissIdleAiTaskProgress(idle);
    assert.equal(idle.value.message, null);
    assert.equal(idle.value.stage, null);

    const active = createAiTaskProgressState();
    tryStartAiTaskProgress(active, {
      taskKey: 'chapter.optimize.plan',
      message: '正在生成优化方案…',
      source: 'dialog:optimize',
      chapterNo: 1,
    });
    dismissIdleAiTaskProgress(active);
    assert.equal(active.value.active, true);
    assert.equal(active.value.message, '正在生成优化方案…');
  });
});
