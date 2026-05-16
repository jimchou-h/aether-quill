import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseNovelContent,
  previewChapterImport,
  validateImportChapters,
} from './chapter-import.util';

test('parseNovelContent returns empty array for empty input', () => {
  assert.equal(parseNovelContent('').length, 0);
  assert.equal(parseNovelContent('   ').length, 0);
});

test('parseNovelContent parses Chinese chapter titles', () => {
  const text = [
    '第1章 启程',
    '',
    '这是第一章的正文内容，主角踏上了旅程。前方是未知的大海与风暴。',
    '',
    '第2章 试炼',
    '',
    '这是第二章的正文内容，主角面对试炼与内心的挣扎。',
    '',
    '第3章 真相',
    '',
    '这是第三章的正文内容，真相浮出水面，一切皆有因果。',
  ].join('\n');

  const segments = parseNovelContent(text);
  assert.equal(segments.length, 3);
  assert.equal(segments[0]!.chapterNo, 1);
  assert.equal(segments[0]!.title, '第1章 启程');
  assert.match(segments[0]!.content, /第一章的正文/);
  assert.equal(segments[1]!.chapterNo, 2);
  assert.equal(segments[1]!.title, '第2章 试炼');
  assert.equal(segments[2]!.chapterNo, 3);
  assert.equal(segments[2]!.title, '第3章 真相');
});

test('parseNovelContent parses Markdown chapter titles', () => {
  const text = [
    '## 第1章 启程',
    '',
    '第一章正文内容较长，足够超过最小阈值以通过内容检查。',
    '',
    '## 第2章 试炼',
    '',
    '第二章正文内容也足够长，确保不会因内容过短被跳过。',
  ].join('\n');

  const segments = parseNovelContent(text);
  assert.equal(segments.length, 2);
  assert.equal(segments[0]!.chapterNo, 1);
  assert.equal(segments[0]!.title, '第1章 启程');
  assert.equal(segments[1]!.chapterNo, 2);
  assert.equal(segments[1]!.title, '第2章 试炼');
});

test('parseNovelContent parses Chinese numeral chapter titles', () => {
  const text = [
    '第一章：觉醒之夜',
    '',
    '这是第一章的正文内容，描述了主角在深夜中的觉醒。',
    '',
    '第二章：清晨的臣服',
    '',
    '这是第二章的正文内容，主角在清晨面对命运。',
    '',
    '第三章 真相大白',
    '',
    '这是第三章的正文内容，真相最终浮出水面，一切皆有定数。',
  ].join('\n');

  const segments = parseNovelContent(text);
  assert.equal(segments.length, 3);
  assert.equal(segments[0]!.chapterNo, 1);
  assert.equal(segments[0]!.title, '第一章：觉醒之夜');
  assert.match(segments[0]!.content, /第一章的正文/);
  assert.equal(segments[1]!.chapterNo, 2);
  assert.equal(segments[1]!.title, '第二章：清晨的臣服');
  assert.equal(segments[2]!.chapterNo, 3);
  assert.equal(segments[2]!.title, '第三章 真相大白');
});

test('parseNovelContent parses Chapter English titles', () => {
  const text = [
    'Chapter 1: The Beginning',
    '',
    'This is the content of chapter one.',
    '',
    'Chapter 2: The Adventure',
    '',
    'This is the content of chapter two.',
  ].join('\n');

  const segments = parseNovelContent(text);
  assert.equal(segments.length, 2);
  assert.equal(segments[0]!.chapterNo, 1);
  assert.match(segments[0]!.title, /Chapter 1/i);
  assert.match(segments[0]!.content, /chapter one/);
});

test('parseNovelContent falls back to length-based segmentation when no titles found', () => {
  const text = '这是一段没有章节标题的连续文本。'.repeat(1000);
  const segments = parseNovelContent(text);
  assert.ok(segments.length >= 1);
  assert.equal(segments[0]!.chapterNo, 1);
  assert.equal(segments[0]!.title, '第1章');
  if (segments.length > 1) {
    assert.equal(segments[1]!.chapterNo, 2);
    assert.equal(segments[1]!.title, '第2章');
  }
});

test('parseNovelContent skips empty chapters', () => {
  const text = [
    '第1章 启程',
    '',
    '正文内容足够长以确保通过最小内容阈值检查。',
    '',
    '第2章 试炼',
  ].join('\n');

  const segments = parseNovelContent(text);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.chapterNo, 1);
});

test('previewChapterImport returns preview structure', () => {
  const text = [
    '第1章 启程',
    '',
    '这是第一章的正文内容，用于测试预览功能，长度足够满足最小阈值。',
  ].join('\n');

  const result = previewChapterImport(text);
  assert.equal(result.totalChars, text.length);
  assert.equal(result.detectedCount, 1);
  assert.equal(result.chapters.length, 1);
  assert.equal(result.chapters[0]!.chapterNo, 1);
  assert.equal(result.chapters[0]!.title, '第1章 启程');
  assert.ok(result.chapters[0]!.contentLength > 0);
  assert.ok(result.chapters[0]!.contentPreview.length > 0);
});

test('previewChapterImport throws on oversized content', () => {
  const oversized = 'x'.repeat(5_242_881);
  assert.throws(() => previewChapterImport(oversized), { code: 1317 });
});

test('validateImportChapters accepts valid chapters', () => {
  const chapters = [
    { chapterNo: 1, title: '第1章 启程', content: '正文内容' },
    { chapterNo: 2, title: '第2章 试炼', content: '更多正文内容' },
  ];
  assert.doesNotThrow(() => validateImportChapters(chapters));
});

test('validateImportChapters rejects empty array', () => {
  assert.throws(() => validateImportChapters([]), { code: 1318 });
});

test('validateImportChapters rejects chapters with missing title', () => {
  const chapters = [{ chapterNo: 1, title: '', content: '正文内容' }];
  assert.throws(() => validateImportChapters(chapters), { code: 1319 });
});

test('validateImportChapters rejects chapters with missing content', () => {
  const chapters = [{ chapterNo: 1, title: '第1章', content: '' }];
  assert.throws(() => validateImportChapters(chapters), { code: 1319 });
});

test('validateImportChapters rejects invalid chapter number', () => {
  const chapters = [{ chapterNo: 0, title: '第1章', content: '正文内容' }];
  assert.throws(() => validateImportChapters(chapters), { code: 1319 });
});
