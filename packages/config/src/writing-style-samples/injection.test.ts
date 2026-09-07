import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStyleSamplePromptBlock,
  isWritingStyleInjectionTemplateKey,
  resolveWritingStyleSampleBlock,
  selectWritingStyleSamplesForTask,
  type WritingStyleSample,
} from './index';

const baseSample = (overrides: Partial<WritingStyleSample>): WritingStyleSample => ({
  id: 's1',
  text: '这是一段足够长的文风样本，强调对白节奏与句长变化，不复用具体情节意象，只学语感与用词密度。',
  sceneType: 'dialogue',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

test('isWritingStyleInjectionTemplateKey whitelists writing tasks only', () => {
  assert.equal(isWritingStyleInjectionTemplateKey('write.chapter'), true);
  assert.equal(isWritingStyleInjectionTemplateKey('chapter.optimize.draft'), true);
  assert.equal(isWritingStyleInjectionTemplateKey('chapter.optimize.direct-draft'), true);
  assert.equal(isWritingStyleInjectionTemplateKey('chapter.pipeline.sensory.rewrite'), true);
  assert.equal(isWritingStyleInjectionTemplateKey('chapter.pipeline.sensory.rewrite.revise'), true);
  assert.equal(isWritingStyleInjectionTemplateKey('chapter.pipeline.sensory.outline'), false);
  assert.equal(
    isWritingStyleInjectionTemplateKey('chapter.pipeline.sensory.coverage.verify'),
    false
  );
  assert.equal(isWritingStyleInjectionTemplateKey('chapter.pipeline.brief.synthesize'), false);
});

test('auto-loop injects into segment rewrite but not into diagnosis', () => {
  assert.equal(isWritingStyleInjectionTemplateKey('chapter.optimize.loop.draft'), true);
  assert.equal(isWritingStyleInjectionTemplateKey('chapter.optimize.loop.plan'), false);
});

test('selectWritingStyleSamplesForTask excludes current chapter and prefers scene match', () => {
  const samples = [
    baseSample({
      id: 'a',
      sceneType: 'action',
      sourceChapterNo: 2,
      updatedAt: '2026-01-02T00:00:00.000Z',
    }),
    baseSample({
      id: 'b',
      sceneType: 'dialogue',
      sourceChapterNo: 5,
      updatedAt: '2026-01-03T00:00:00.000Z',
    }),
    baseSample({ id: 'c', sceneType: 'intimate', sourceChapterNo: 3 }),
  ];
  const picked = selectWritingStyleSamplesForTask({
    samples,
    templateKey: 'chapter.pipeline.character',
    chapterNo: 3,
    limit: 2,
  });
  assert.equal(picked.length, 2);
  assert.ok(picked.every((item) => item.sourceChapterNo !== 3));
  assert.equal(picked[0]?.sceneType, 'dialogue');
});

test('resolveWritingStyleSampleBlock returns undefined for non-writing tasks', () => {
  const block = resolveWritingStyleSampleBlock({
    samples: [baseSample({})],
    templateKey: 'chapter.pipeline.sensory.outline',
    chapterNo: 1,
  });
  assert.equal(block, undefined);
});

test('buildStyleSamplePromptBlock includes guard instruction and style-sample tags', () => {
  const block = buildStyleSamplePromptBlock([
    baseSample({ sceneType: 'atmosphere', label: '氛围' }),
  ]);
  assert.match(block, /【文风参照】/);
  assert.match(block, /勿复用其中情节/);
  assert.match(block, /<style-sample scene="atmosphere"/);
});
