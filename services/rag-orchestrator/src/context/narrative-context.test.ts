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

test('buildNarrativeContextText includes persona snapshot section', async () => {
  const result = await buildNarrativeContextText({
    projectId: 'p1',
    personaProfile: '主角设定',
    outlineSummary: '',
    chapters: [
      { chapterNo: 1, title: '一', summary: 's1', content: 'c1' },
      { chapterNo: 2, title: '二', summary: 's2', content: 'c2' },
    ],
    chapterSummaryPromptCount: 0,
    chapterSummaryMemoryCount: 0,
    priorChapterTailChars: 0,
    contextExcerptMaxChars: 400,
    currentChapterNo: 3,
    personas: [
      {
        name: '张三',
        profile: '商人',
        state: '待更新',
        status: 'published',
        chapterStates: [
          {
            chapterNo: 2,
            appeared: true,
            snapshot: { clothing: '深灰西装', status: '冷静' },
            summaryLine: '着装：深灰西装；状态：冷静',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      },
    ],
  });

  assert.ok(result.text.includes('【人物当前快照】'));
  assert.ok(result.text.includes('深灰西装'));
  assert.equal(result.meta.persona_snapshot_injected_count, 1);
  assert.equal(result.meta.persona_snapshot_as_of_chapter, 2);
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

test('buildNarrativeContextText includes identity relation memory block', async () => {
  const result = await buildNarrativeContextText({
    projectId: 'p1',
    personaProfile: '未配置人物设定',
    outlineSummary: '',
    chapters: [{ chapterNo: 1, title: '一', summary: 's1', content: 'c1' }],
    chapterSummaryPromptCount: 0,
    chapterSummaryMemoryCount: 0,
    priorChapterTailChars: 0,
    contextExcerptMaxChars: 400,
    currentChapterNo: 2,
    identityRelationMemory: '【人物身份关系】\n- 沈镜川 → 叶清歌：师父',
  });

  assert.ok(result.text.includes('【人物身份关系】'));
  assert.ok(result.text.includes('沈镜川 → 叶清歌：师父'));
});
