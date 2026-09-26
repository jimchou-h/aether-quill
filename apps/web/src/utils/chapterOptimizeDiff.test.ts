import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildInlineDiffViews, shouldRenderOptimizeDiff } from './chapterOptimizeDiff';

describe('shouldRenderOptimizeDiff', () => {
  it('hides the diff while a stream or loop is still writing', () => {
    assert.equal(shouldRenderOptimizeDiff(true), false);
    assert.equal(shouldRenderOptimizeDiff(false), true);
  });
});

describe('buildInlineDiffViews', () => {
  it('marks new draft words as added on the right after an edit', () => {
    const views = buildInlineDiffViews('夜色深沉。', '夜色深沉，风更冷。');
    assert.ok(views.draftSegments.some((seg) => seg.added && seg.text.includes('风更冷')));
    assert.ok(views.originalSegments.every((seg) => !seg.added));
  });
});
