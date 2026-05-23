import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFallbackChapterSummary,
  resolveChapterSummaryOnContentWrite,
} from './chapter-summary.util';

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

test('resolveChapterSummaryOnContentWrite preserves llm summary when content changes', () => {
  const updatedAt = new Date('2026-05-01T00:00:00.000Z');
  const result = resolveChapterSummaryOnContentWrite({
    content: '新的正文'.repeat(50),
    existing: {
      summary: '语义摘要保留',
      summarySource: 'llm',
      summaryUpdatedAt: updatedAt,
    },
  });
  assert.equal(result.summary, '语义摘要保留');
  assert.equal(result.summarySource, 'llm');
  assert.equal(result.summaryUpdatedAt, updatedAt);
});

test('resolveChapterSummaryOnContentWrite refreshes fallback summary when not llm', () => {
  const result = resolveChapterSummaryOnContentWrite({
    content: '新的短正文',
    existing: {
      summary: '旧规则摘要',
      summarySource: 'fallback',
    },
  });
  assert.equal(result.summary, '新的短正文');
  assert.equal(result.summarySource, 'fallback');
});

test('resolveChapterSummaryOnContentWrite uses fallback for new chapter', () => {
  const result = resolveChapterSummaryOnContentWrite({
    content: '首章正文',
    existing: null,
  });
  assert.equal(result.summary, '首章正文');
  assert.equal(result.summarySource, 'fallback');
});
