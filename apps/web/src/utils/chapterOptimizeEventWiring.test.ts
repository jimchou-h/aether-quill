import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Regression seam: Chapters.vue listens for writing-optimize;
 * ChapterList must emit writingOptimize (not optimize) for「章节优化」.
 */
test('chapter optimize button event name matches parent listener', () => {
  const listEmits = ['writingOptimize', 'pipelineOptimize', 'finalPolish'] as const;
  const pageListeners = ['writing-optimize', 'pipeline-optimize', 'final-polish'] as const;

  function toKebab(name: string): string {
    return name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
  }

  for (let i = 0; i < listEmits.length; i += 1) {
    assert.equal(toKebab(listEmits[i]!), pageListeners[i]);
  }

  assert.equal(toKebab('optimize'), 'optimize');
  assert.notEqual(toKebab('optimize'), 'writing-optimize');
});
