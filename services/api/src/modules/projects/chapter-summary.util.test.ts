import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFallbackChapterSummary,
  resolveChapterSummaryOnContentWrite,
  resolveChapterSummaryOnOptimizeApply,
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

test('resolveChapterSummaryOnContentWrite preserves non-empty llm summary', () => {
  const updatedAt = new Date('2026-05-01T00:00:00.000Z');
  const content = '新的正文'.repeat(50);
  const result = resolveChapterSummaryOnContentWrite({
    content,
    existing: {
      summary: '旧语义摘要',
      summarySource: 'llm',
      summaryUpdatedAt: updatedAt,
    },
  });
  assert.equal(result.summary, '旧语义摘要');
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

test('resolveChapterSummaryOnOptimizeApply preserves llm summary by default', () => {
  const updatedAt = new Date('2026-05-01T00:00:00.000Z');
  const content = '新的正文'.repeat(50);
  const result = resolveChapterSummaryOnOptimizeApply({
    content,
    existing: {
      summary: '旧语义摘要',
      summarySource: 'llm',
      summaryUpdatedAt: updatedAt,
    },
  });
  assert.equal(result.summary, '旧语义摘要');
  assert.equal(result.summarySource, 'llm');
  assert.equal(result.summaryUpdatedAt, updatedAt);
  assert.equal(result.reindexSummaryVector, false);
});

test('resolveChapterSummaryOnOptimizeApply preserves fallback summary by default', () => {
  const updatedAt = new Date('2026-06-01T00:00:00.000Z');
  const result = resolveChapterSummaryOnOptimizeApply({
    content: '完全不同的新正文内容',
    existing: {
      summary: '旧规则摘要',
      summarySource: 'fallback',
      summaryUpdatedAt: updatedAt,
    },
  });
  assert.equal(result.summary, '旧规则摘要');
  assert.equal(result.summarySource, 'fallback');
  assert.equal(result.summaryUpdatedAt, updatedAt);
  assert.equal(result.reindexSummaryVector, false);
});

test('resolveChapterSummaryOnOptimizeApply refreshes fallback when preserveSummary is false', () => {
  const content = '新的短正文';
  const result = resolveChapterSummaryOnOptimizeApply({
    preserveSummary: false,
    content,
    existing: {
      summary: '旧语义摘要',
      summarySource: 'llm',
      summaryUpdatedAt: new Date('2026-05-01T00:00:00.000Z'),
    },
  });
  assert.equal(result.summary, content);
  assert.equal(result.summarySource, 'fallback');
  assert.equal(result.reindexSummaryVector, true);
});

test('resolveChapterSummaryOnContentWrite uses fallback for new chapter', () => {
  const result = resolveChapterSummaryOnContentWrite({
    content: '首章正文',
    existing: null,
  });
  assert.equal(result.summary, '首章正文');
  assert.equal(result.summarySource, 'fallback');
});
