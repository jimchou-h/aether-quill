import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampChapterSummaryPromptCount,
  clampGenerationTemperature,
  DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
  DEFAULT_GENERATION_TEMPERATURE,
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
