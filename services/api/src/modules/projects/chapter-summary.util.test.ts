import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFallbackChapterSummary } from './chapter-summary.util';

test('buildFallbackChapterSummary returns placeholder for empty content', () => {
  assert.equal(buildFallbackChapterSummary('   \n\t'), '暂无摘要（章节内容为空）');
});

test('buildFallbackChapterSummary keeps short content intact', () => {
  assert.equal(buildFallbackChapterSummary('短摘要'), '短摘要');
});

test('buildFallbackChapterSummary truncates long content to 160 characters', () => {
  const content = '章'.repeat(200);
  const summary = buildFallbackChapterSummary(content);
  assert.equal(summary.length, 163);
  assert.ok(summary.endsWith('...'));
});
