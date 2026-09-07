import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampChapterSummaryPromptCount,
  clampContextExcerptMaxChars,
  clampGenerationTemperature,
  clampOutlineMaxChars,
  clampPersonaProfileMaxChars,
  clampPriorChapterTailChars,
  clampRelationMemoMaxChars,
  DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
  DEFAULT_CONTEXT_EXCERPT_MAX_CHARS,
  DEFAULT_GENERATION_TEMPERATURE,
  DEFAULT_OUTLINE_MAX_CHARS,
  DEFAULT_PERSONA_PROFILE_MAX_CHARS,
  DEFAULT_PRIOR_CHAPTER_TAIL_CHARS,
  DEFAULT_RELATION_MEMO_MAX_CHARS,
  sliceContentTail,
} from './project-settings.util';

test('clampChapterSummaryPromptCount uses default for invalid', () => {
  assert.equal(clampChapterSummaryPromptCount(undefined), DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT);
  assert.equal(clampChapterSummaryPromptCount('x'), DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT);
});

test('clampChapterSummaryPromptCount clamps to 0~10', () => {
  assert.equal(clampChapterSummaryPromptCount(-1), 0);
  assert.equal(clampChapterSummaryPromptCount(0), 0);
  assert.equal(clampChapterSummaryPromptCount(5.9), 5);
  assert.equal(clampChapterSummaryPromptCount(21), 10);
});

test('clampGenerationTemperature uses default for invalid', () => {
  assert.equal(clampGenerationTemperature(undefined), DEFAULT_GENERATION_TEMPERATURE);
  assert.equal(clampGenerationTemperature(NaN), DEFAULT_GENERATION_TEMPERATURE);
});

test('clampGenerationTemperature clamps to 0~2', () => {
  assert.equal(clampGenerationTemperature(-0.1), 0);
  assert.equal(clampGenerationTemperature(2.5), 2);
  assert.equal(clampGenerationTemperature(0.35), 0.35);
});

test('clampPriorChapterTailChars uses default and clamps 0~2000', () => {
  assert.equal(clampPriorChapterTailChars(undefined), DEFAULT_PRIOR_CHAPTER_TAIL_CHARS);
  assert.equal(clampPriorChapterTailChars(-1), 0);
  assert.equal(clampPriorChapterTailChars(3000), 2000);
});

test('clampContextExcerptMaxChars uses default and clamps 200~800', () => {
  assert.equal(clampContextExcerptMaxChars(undefined), DEFAULT_CONTEXT_EXCERPT_MAX_CHARS);
  assert.equal(clampContextExcerptMaxChars(100), 200);
  assert.equal(clampContextExcerptMaxChars(900), 800);
});

test('clampOutlineMaxChars uses default and clamps 0~8000', () => {
  assert.equal(clampOutlineMaxChars(undefined), DEFAULT_OUTLINE_MAX_CHARS);
  assert.equal(clampOutlineMaxChars(-1), 0);
  assert.equal(clampOutlineMaxChars(99999), 8000);
});

test('clampPersonaProfileMaxChars and clampRelationMemoMaxChars', () => {
  assert.equal(clampPersonaProfileMaxChars(undefined), DEFAULT_PERSONA_PROFILE_MAX_CHARS);
  assert.equal(clampRelationMemoMaxChars(undefined), DEFAULT_RELATION_MEMO_MAX_CHARS);
  assert.equal(clampPersonaProfileMaxChars(0), 0);
  assert.equal(clampRelationMemoMaxChars(9000), 8000);
});

test('sliceContentTail returns tail segment', () => {
  const content = 'x'.repeat(100) + 'END';
  assert.ok(sliceContentTail(content, 10).endsWith('END'));
});
