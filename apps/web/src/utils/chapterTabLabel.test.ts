import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatChapterTabTitle } from './chapterTabLabel';

describe('formatChapterTabTitle', () => {
  it('hides a title that only repeats the chapter label', () => {
    assert.equal(formatChapterTabTitle(1, '第1章'), '');
    assert.equal(formatChapterTabTitle(2, '第 2 章'), '');
  });

  it('strips a leading chapter label from a longer title', () => {
    assert.equal(formatChapterTabTitle(1, '第1章 香蕉皮的代价'), '香蕉皮的代价');
  });

  it('keeps unrelated titles', () => {
    assert.equal(formatChapterTabTitle(2, 'q'), 'q');
  });
});
