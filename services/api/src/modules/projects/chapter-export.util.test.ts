import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChaptersExportFilename, buildChaptersTxtExport } from './chapter-export.util';

test('buildChaptersTxtExport orders chapters and formats title/content blocks', () => {
  const text = buildChaptersTxtExport([
    { chapterNo: 2, title: '试炼', content: '第二章正文' },
    { chapterNo: 1, title: '启程', content: '第一章正文' },
  ]);

  assert.match(text, /^第1章 启程/);
  assert.match(text, /第一章正文/);
  assert.match(text, /第2章 试炼/);
  assert.match(text, /第二章正文/);
  const firstIndex = text.indexOf('第1章');
  const secondIndex = text.indexOf('第2章');
  assert.ok(firstIndex >= 0 && secondIndex > firstIndex);
});

test('buildChaptersExportFilename sanitizes project id', () => {
  const filename = buildChaptersExportFilename('proj/demo#1');
  assert.match(filename, /^chapters-proj_demo_1-\d{4}-\d{2}-\d{2}\.txt$/);
});
