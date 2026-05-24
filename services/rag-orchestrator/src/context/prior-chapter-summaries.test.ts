import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChapterExcerpt,
  pickPriorChapterSummariesForPrompt,
} from './prior-chapter-summaries';

const chapters = [
  { chapterNo: 1, title: '一', summary: 's1', content: 'c1' },
  { chapterNo: 2, title: '二', summary: 's2', content: 'c2' },
  { chapterNo: 3, title: '三', summary: 's3', content: 'c3' },
  { chapterNo: 4, title: '四', summary: '', content: '末尾悬念内容' },
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
    [4, 3, 2, 1]
  );
});

test('uses excerpt fallback when summary empty but content exists', () => {
  const got = pickPriorChapterSummariesForPrompt(chapters, { currentChapterNo: 99, maxCount: 10 });
  const ch4 = got.find((c) => c.chapterNo === 4);
  assert.ok(ch4);
  assert.equal(ch4?.usedExcerptFallback, true);
  assert.ok(ch4?.summary.includes('末尾悬念'));
});

test('buildChapterExcerpt takes content tail', () => {
  const long = 'a'.repeat(100) + 'END';
  const excerpt = buildChapterExcerpt({ chapterNo: 1, title: 't', summary: '', content: long }, 10);
  assert.equal(excerpt, 'a'.repeat(7) + 'END');
});
