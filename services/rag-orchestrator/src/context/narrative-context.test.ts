import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNarrativeContextText } from './narrative-context';

test('buildNarrativeContextText includes prior tail and excerpt fallback meta', async () => {
  const result = await buildNarrativeContextText({
    projectId: 'p1',
    personaProfile: '未配置人物设定',
    outlineSummary: '',
    chapters: [
      { chapterNo: 1, title: '一', summary: '', content: '第一章很长'.repeat(50) },
      {
        chapterNo: 2,
        title: '二',
        summary: '',
        content: 'y'.repeat(500) + '上一章结尾',
        contentTail: '上一章结尾',
      },
    ],
    chapterSummaryPromptCount: 3,
    chapterSummaryMemoryCount: 0,
    priorChapterTailChars: 800,
    contextExcerptMaxChars: 400,
    currentChapterNo: 3,
  });

  assert.ok(result.text.includes('【前章衔接】'));
  assert.ok(result.text.includes('上一章结尾'));
  assert.equal(result.meta.prior_chapter_tail_injected, true);
  assert.ok(result.meta.excerpt_fallback_chapter_nos.length >= 1);
});

test('buildNarrativeContextText includes next chapter head when optimize flag set', async () => {
  const result = await buildNarrativeContextText({
    projectId: 'p1',
    personaProfile: '未配置人物设定',
    outlineSummary: '',
    chapters: [
      { chapterNo: 1, title: '一', summary: '', content: '第一章。' },
      { chapterNo: 2, title: '二', summary: '', content: '第二章正文很长。' + 'x'.repeat(100) },
      { chapterNo: 3, title: '三', summary: '', content: '第三章开头锚点。后续内容。' },
    ],
    chapterSummaryPromptCount: 0,
    chapterSummaryMemoryCount: 0,
    priorChapterTailChars: 800,
    contextExcerptMaxChars: 400,
    currentChapterNo: 2,
    includeNextChapterHead: true,
  });

  assert.ok(result.text.includes('【下章衔接】'));
  assert.ok(result.text.includes('第三章开头锚点'));
  assert.equal(result.meta.next_chapter_head_injected, true);
});

test('buildNarrativeContextText omits next chapter head without optimize flag', async () => {
  const result = await buildNarrativeContextText({
    projectId: 'p1',
    personaProfile: '未配置人物设定',
    outlineSummary: '',
    chapters: [
      { chapterNo: 1, title: '一', summary: '', content: 'a' },
      { chapterNo: 2, title: '二', summary: '', content: 'b' },
    ],
    chapterSummaryPromptCount: 0,
    chapterSummaryMemoryCount: 0,
    priorChapterTailChars: 800,
    contextExcerptMaxChars: 400,
    currentChapterNo: 1,
    includeNextChapterHead: false,
  });

  assert.equal(result.text.includes('【下章衔接】'), false);
  assert.equal(result.meta.next_chapter_head_injected, false);
});
