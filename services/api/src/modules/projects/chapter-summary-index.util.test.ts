import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRetryableChapterSummaryIndexError,
  resolveChapterSummaryIndexDelayMs,
  resolveChapterSummaryIndexRetryDelayMs,
} from './chapter-summary-index.util';

test('resolveChapterSummaryIndexDelayMs defaults and clamps', () => {
  assert.equal(resolveChapterSummaryIndexDelayMs(undefined), 350);
  assert.equal(resolveChapterSummaryIndexDelayMs('0'), 0);
  assert.equal(resolveChapterSummaryIndexDelayMs('500'), 500);
  assert.equal(resolveChapterSummaryIndexDelayMs('99999'), 10_000);
});

test('isRetryableChapterSummaryIndexError detects axios-like failures', () => {
  assert.equal(isRetryableChapterSummaryIndexError({ response: { status: 429 } }), true);
  assert.equal(isRetryableChapterSummaryIndexError({ response: { status: 400 } }), true);
  assert.equal(
    isRetryableChapterSummaryIndexError({ message: 'Request failed with status code 400' }),
    true
  );
  assert.equal(isRetryableChapterSummaryIndexError({ code: 'EMBEDDING_PROVIDER_UNAVAILABLE' }), true);
  assert.equal(isRetryableChapterSummaryIndexError({ response: { status: 404 } }), false);
});

test('resolveChapterSummaryIndexRetryDelayMs exponential backoff', () => {
  assert.equal(resolveChapterSummaryIndexRetryDelayMs(0, 600), 600);
  assert.equal(resolveChapterSummaryIndexRetryDelayMs(1, 600), 1200);
  assert.equal(resolveChapterSummaryIndexRetryDelayMs(6, 600), 30_000);
});
