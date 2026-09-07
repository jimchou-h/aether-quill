import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWritingStyleSampleRecord,
  sanitizeWritingStyleSamples,
  validateWritingStyleSampleInput,
  WRITING_STYLE_SAMPLE_MIN_CHARS,
} from './writing-style-samples.util';

test('validateWritingStyleSampleInput rejects short text and invalid scene type', () => {
  const short = validateWritingStyleSampleInput({
    text: '太短',
    sceneType: 'dialogue',
  });
  assert.equal(short.ok, false);

  const invalidScene = validateWritingStyleSampleInput({
    text: 'a'.repeat(WRITING_STYLE_SAMPLE_MIN_CHARS),
    sceneType: 'unknown',
  });
  assert.equal(invalidScene.ok, false);
});

test('sanitizeWritingStyleSamples keeps valid rows only', () => {
  const text =
    '这是一段足够长的文风样本，用于测试清洗逻辑是否保留合法记录。强调句长节奏与用词密度，不复用具体情节意象，只学语感。';
  const samples = sanitizeWritingStyleSamples([
    {
      id: 's1',
      text,
      sceneType: 'intimate',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    { id: 's2', text: '短', sceneType: 'dialogue' },
    { id: '', text, sceneType: 'action' },
  ]);
  assert.equal(samples.length, 1);
  assert.equal(samples[0]?.id, 's1');
  assert.equal(samples[0]?.sceneType, 'intimate');
});

test('createWritingStyleSampleRecord assigns id and timestamps', () => {
  const sample = createWritingStyleSampleRecord({
    text: '这是一段足够长的文风样本，强调对白节奏与句长变化，不复用具体情节意象。',
    sceneType: 'dialogue',
    sourceChapterNo: 3,
    label: '对白参考',
  });
  assert.ok(sample.id.length > 8);
  assert.equal(sample.sourceChapterNo, 3);
  assert.equal(sample.label, '对白参考');
  assert.ok(sample.createdAt);
  assert.ok(sample.updatedAt);
});
