import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE_HINT } from './generationPreferencesCopy';

describe('CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE_HINT', () => {
  it('mentions auto-loop so authors know the setting applies beyond from-plan', () => {
    assert.match(CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE_HINT, /自动优化循环/);
  });
});
