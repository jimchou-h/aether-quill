import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePriorChapterTail } from './prior-chapter-tail';

const chapters = [
  { chapterNo: 1, title: '一', summary: 's1', content: '第一章正文' },
  {
    chapterNo: 2,
    title: '二',
    summary: 's2',
    content: 'x'.repeat(1000) + '章末钩子',
    contentTail: '章末钩子',
  },
];

test('injects prior chapter tail for chapter N>1', () => {
  const r = resolvePriorChapterTail(chapters, 3, 800);
  assert.equal(r.skipped, false);
  assert.equal(r.chapterNo, 2);
  assert.ok(r.text.includes('章末钩子'));
});

test('skips when tail chars is 0 or chapter is first', () => {
  assert.equal(resolvePriorChapterTail(chapters, 1, 800).skipped, true);
  assert.equal(resolvePriorChapterTail(chapters, 2, 0).skipped, true);
});

test('skips when prior chapter missing', () => {
  const r = resolvePriorChapterTail(chapters, 5, 800);
  assert.equal(r.skipped, true);
  assert.equal(r.text, '');
});
