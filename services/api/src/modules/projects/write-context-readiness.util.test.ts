import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWriteContextReadiness } from './write-context-readiness.util';

test('lists prior chapters missing summary', () => {
  const r = buildWriteContextReadiness(4, [
    { chapterNo: 1, summary: 's1', content: 'c1' },
    { chapterNo: 2, summary: '', content: 'c2' },
    { chapterNo: 3, summary: 's3', content: 'c3' },
  ]);
  assert.equal(r.chapterNo, 4);
  assert.equal(r.priorChapterExists, true);
  assert.deepEqual(r.priorChaptersMissingSummary, [2]);
  assert.deepEqual(r.recommendedActions, ['batch_summarize']);
});

test('no recommended actions when all priors have summaries', () => {
  const r = buildWriteContextReadiness(3, [
    { chapterNo: 1, summary: 's1', content: 'c1' },
    { chapterNo: 2, summary: 's2', content: 'c2' },
  ]);
  assert.deepEqual(r.priorChaptersMissingSummary, []);
  assert.deepEqual(r.recommendedActions, []);
});
