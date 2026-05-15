import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPriorChapterSummariesForPrompt } from './prior-chapter-summaries';

const chapters = [
  { chapterNo: 1, title: '一', summary: 's1' },
  { chapterNo: 2, title: '二', summary: 's2' },
  { chapterNo: 3, title: '三', summary: 's3' },
  { chapterNo: 4, title: '四', summary: '' },
];

test('picks strictly before current chapter, newest first, capped by maxCount', () => {
  const got = pickPriorChapterSummariesForPrompt(chapters, { currentChapterNo: 4, maxCount: 2 });
  assert.deepEqual(
    got.map((c) => c.chapterNo),
    [3, 2]
  );
});

test('maxCount 0 returns empty', () => {
  assert.equal(
    pickPriorChapterSummariesForPrompt(chapters, { currentChapterNo: 4, maxCount: 0 }).length,
    0
  );
});

test('without currentChapterNo uses max chapterNo + 1 as implicit target', () => {
  const got = pickPriorChapterSummariesForPrompt(chapters, { maxCount: 10 });
  assert.deepEqual(
    got.map((c) => c.chapterNo),
    [3, 2, 1]
  );
});

test('skips chapters with empty summary', () => {
  const got = pickPriorChapterSummariesForPrompt(chapters, { currentChapterNo: 99, maxCount: 10 });
  assert.deepEqual(
    got.map((c) => c.chapterNo),
    [3, 2, 1]
  );
});
