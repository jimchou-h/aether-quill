import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWritingStyleInjectionTemplateKey,
  resolveWritingStyleSampleBlock,
  selectWritingStyleSamplesForTask,
} from './writing-style-samples.util';

const sampleText =
  '这是一段足够长的文风样本，强调对白节奏与句长变化，不复用具体情节意象，只学语感与用词密度。';

test('cut pipeline template keys are not eligible for style injection', () => {
  assert.equal(
    isWritingStyleInjectionTemplateKey('chapter.pipeline.sensory.rewrite.fix-items'),
    false
  );
  assert.equal(
    isWritingStyleInjectionTemplateKey('chapter.pipeline.sensory.coverage.verify'),
    false
  );
  assert.equal(isWritingStyleInjectionTemplateKey('chapter.optimize.draft'), true);
});

test('selectWritingStyleSamplesForTask degrades when no scene match', () => {
  const samples = [
    {
      id: 'only-action',
      text: sampleText,
      sceneType: 'action' as const,
      sourceChapterNo: 9,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const picked = selectWritingStyleSamplesForTask({
    samples,
    templateKey: 'chapter.optimize.draft',
    chapterNo: 1,
  });
  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.id, 'only-action');
});

test('resolveWritingStyleSampleBlock returns prompt block for draft tasks', () => {
  const block = resolveWritingStyleSampleBlock({
    samples: [
      {
        id: 'd1',
        text: sampleText,
        sceneType: 'atmosphere',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    templateKey: 'chapter.optimize.draft',
    chapterNo: 2,
  });
  assert.ok(block?.includes('【文风参照】'));
  assert.ok(block?.includes('<style-sample'));
});
