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
