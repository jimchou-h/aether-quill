import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMemoryChapterSummariesFromSearchRows } from './chapter-summary-memory';

function row(chapterNo: number, summary = `s${chapterNo}`) {
  return {
    payload: {
      chapter_no: chapterNo,
      docTitle: `第${chapterNo}章`,
      content: summary,
    },
  };
}

test('pickMemoryChapterSummariesFromSearchRows excludes recent pool chapter numbers', () => {
  const got = pickMemoryChapterSummariesFromSearchRows(
    [row(99), row(98), row(95), row(90)],
    { currentChapterNo: 100, maxCount: 3, excludeChapterNos: [99, 98] }
  );
  assert.deepEqual(
    got.map((c) => c.chapterNo),
    [95, 90]
  );
});

test('pickMemoryChapterSummariesFromSearchRows deduplicates within search rows', () => {
  const got = pickMemoryChapterSummariesFromSearchRows([row(5), row(5), row(4)], {
    currentChapterNo: 10,
    maxCount: 5,
  });
  assert.deepEqual(
    got.map((c) => c.chapterNo),
    [5, 4]
  );
});

test('pickMemoryChapterSummariesFromSearchRows skips current and future chapters', () => {
  const got = pickMemoryChapterSummariesFromSearchRows([row(10), row(9), row(8)], {
    currentChapterNo: 10,
    maxCount: 5,
  });
  assert.deepEqual(
    got.map((c) => c.chapterNo),
    [9, 8]
  );
});
