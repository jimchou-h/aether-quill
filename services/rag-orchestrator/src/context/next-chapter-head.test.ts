import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNextChapterHead } from './next-chapter-head';

test('injects next chapter head for chapter N when N+1 has content', () => {
  const chapters = [
    { chapterNo: 1, title: '一', summary: '', content: '第一章正文。' },
    { chapterNo: 2, title: '二', summary: '', content: '第二章开头。后续很长。' },
    { chapterNo: 3, title: '三', summary: '', content: '第三章开头是锚点。后面更多内容。' },
  ];
  const result = resolveNextChapterHead(chapters, 2, 800);
  assert.equal(result.skipped, false);
  assert.equal(result.chapterNo, 3);
  assert.ok(result.text.startsWith('第三章开头是锚点'));
});

test('skips when next chapter missing or empty', () => {
  const chapters = [{ chapterNo: 1, title: '一', summary: '', content: '只有一章。' }];
  assert.equal(resolveNextChapterHead(chapters, 1, 800).skipped, true);
  assert.equal(
    resolveNextChapterHead(
      [{ chapterNo: 1, title: '一', summary: '', content: 'a' }, { chapterNo: 2, title: '二', summary: '' }],
      1,
      800
    ).skipped,
    true
  );
});

test('truncates to headChars', () => {
  const long = '起'.repeat(100);
  const chapters = [
    { chapterNo: 1, title: '一', summary: '', content: 'a' },
    { chapterNo: 2, title: '二', summary: '', content: long },
  ];
  const result = resolveNextChapterHead(chapters, 1, 10);
  assert.equal(result.chars, 10);
  assert.equal(result.text, long.slice(0, 10));
});
