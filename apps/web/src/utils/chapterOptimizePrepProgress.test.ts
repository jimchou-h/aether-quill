import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveChapterOptimizePrepProgress } from './chapterOptimizePrepProgress';

describe('resolveChapterOptimizePrepProgress', () => {
  it('advances steps from syncing to waiting_llm', () => {
    const sync = resolveChapterOptimizePrepProgress('syncing_context');
    const retrieve = resolveChapterOptimizePrepProgress('retrieving');
    const wait = resolveChapterOptimizePrepProgress('waiting_llm');

    assert.equal(sync.currentStep, 1);
    assert.equal(retrieve.currentStep, 2);
    assert.equal(wait.currentStep, 3);
    assert.ok(sync.percent < retrieve.percent);
    assert.ok(retrieve.percent <= wait.percent);
  });
});
