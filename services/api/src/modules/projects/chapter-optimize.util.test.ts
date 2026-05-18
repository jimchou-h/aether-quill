import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChapterVersionConflictError,
  assertDraftText,
  assertInstruction,
  assertPlanText,
  buildDraftUserPrompt,
  buildPlanUserPrompt,
  ensureChapterVersionMatches,
  makeOptimizationId,
  normalizeInstruction,
  parseExpectedUpdatedAt,
  parseTypoCheckIssues,
  buildTypoCheckUserPrompt,
  buildTypoFixUserPrompt,
  buildSegmentBoundaryAnchors,
  calculateSegmentMaxTokensForIndex,
  extractFirstSentence,
  extractLastSentence,
  extractSegmentLeadText,
  extractSegmentTailText,
  resolveOptimizeSegmentCount,
  shouldRetrySegmentForLength,
  splitIntoSegments,
  buildSegmentPrompt,
  parseSegmentOutput,
  calculateSegmentMaxTokens,
  type Segment,
  type ChapterOptimizeChapterRef,
} from './chapter-optimize.util';

const sampleChapter = {
  chapterNo: 3,
  title: '试炼之夜',
  content: '原章节正文内容，主角在地下城遇袭，姐姐尤里乌丝赶到救援。',
  updatedAt: new Date('2026-05-13T01:00:00.000Z'),
};

test('normalizeInstruction trims whitespace and tolerates non-string', () => {
  assert.equal(normalizeInstruction('  增加心理描写  '), '增加心理描写');
  assert.equal(normalizeInstruction(undefined), '');
  assert.equal(normalizeInstruction(123), '');
});

test('assertInstruction rejects empty and overly long strings', () => {
  assert.throws(() => assertInstruction(''), /不能为空/);
  assert.throws(() => assertInstruction('x'.repeat(2001)), /2000/);
  assert.doesNotThrow(() => assertInstruction('增加心理描写'));
});

test('assertPlanText rejects empty plan', () => {
  assert.throws(() => assertPlanText(''), /planText/);
  assert.throws(() => assertPlanText('   '), /planText/);
  assert.doesNotThrow(() => assertPlanText('1. 改写第一段；2. 调整节奏'));
});

test('assertDraftText rejects empty draft', () => {
  assert.throws(() => assertDraftText(''), /draftText/);
  assert.doesNotThrow(() => assertDraftText('优化后的正文'));
});

test('buildPlanUserPrompt always wraps original chapter in <chapter-original> tag', () => {
  const prompt = buildPlanUserPrompt({
    chapter: sampleChapter,
    instruction: '增加心理描写',
  });

  assert.match(prompt, /<chapter-original chapter-no="3">/);
  assert.match(prompt, /<\/chapter-original>/);
  assert.match(prompt, /原章节正文内容，主角在地下城遇袭/);
  assert.match(prompt, /【用户优化要求】[\s\S]*增加心理描写/);
  assert.match(prompt, /禁止直接输出新的正文/);
});

test('buildPlanUserPrompt includes appearing characters and relation events when provided', () => {
  const prompt = buildPlanUserPrompt({
    chapter: sampleChapter,
    instruction: '增加心理描写',
    appearingCharacters: ['菲伦', '尤里乌丝'],
    selectedRelationEvents: [
      {
        id: 'evt-1',
        protagonist: '菲伦',
        counterparty: '尤里乌丝',
        summary: '尤里乌丝救下菲伦',
        chapterNo: 3,
      },
    ],
  });

  assert.match(prompt, /菲伦、尤里乌丝/);
  assert.match(prompt, /菲伦 ↔ 尤里乌丝（第3章）：尤里乌丝救下菲伦/);
});

test('buildDraftUserPrompt enforces both <chapter-original> and <optimization-plan> blocks', () => {
  const prompt = buildDraftUserPrompt({
    chapter: sampleChapter,
    instruction: '让节奏更紧凑',
    planText: '1. 删去重复内心独白\n2. 把战斗场面拆为短句',
  });

  assert.match(prompt, /<optimization-plan chapter-no="3">/);
  assert.match(prompt, /1\. 删去重复内心独白/);
  assert.match(prompt, /<chapter-original chapter-no="3">/);
  assert.match(prompt, /原章节正文内容/);
  assert.match(prompt, /请直接输出「优化后的章节正文」纯文本/);
});

test('parseExpectedUpdatedAt validates ISO timestamps', () => {
  assert.throws(() => parseExpectedUpdatedAt(undefined), /必须为 ISO 时间字符串/);
  assert.throws(() => parseExpectedUpdatedAt('not-a-date'), /合法的 ISO/);
  const parsed = parseExpectedUpdatedAt('2026-05-13T01:00:00.000Z');
  assert.equal(parsed.toISOString(), '2026-05-13T01:00:00.000Z');
});

test('ensureChapterVersionMatches throws ChapterVersionConflictError on mismatch', () => {
  const expected = new Date('2026-05-13T01:00:00.000Z');
  const actual = new Date('2026-05-13T02:00:00.000Z');

  assert.throws(
    () => ensureChapterVersionMatches(3, expected, actual),
    (error: unknown) =>
      error instanceof ChapterVersionConflictError &&
      error.chapterNo === 3 &&
      error.expected === expected.toISOString() &&
      error.actual === actual.toISOString()
  );
});

test('ensureChapterVersionMatches passes when timestamps match exactly', () => {
  const ts = new Date('2026-05-13T01:00:00.000Z');
  assert.doesNotThrow(() => ensureChapterVersionMatches(3, ts, new Date(ts.getTime())));
});

test('makeOptimizationId generates prefixed ids', () => {
  const planId = makeOptimizationId('plan');
  const draftId = makeOptimizationId('draft');
  assert.match(planId, /^plan-/);
  assert.match(draftId, /^draft-/);
  assert.notEqual(planId, draftId);
});

test('parseTypoCheckIssues parses fenced JSON and filters invalid items', () => {
  const raw =
    '```json\n{"issues":[{"id":"issue-1","original":"错字","suggestion":"错字改","reason":"同音"}]}\n```';
  const issues = parseTypoCheckIssues(raw);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.original, '错字');
  assert.equal(issues[0]?.suggestion, '错字改');
});

test('buildTypoCheckUserPrompt wraps draft in draft-text tag', () => {
  const prompt = buildTypoCheckUserPrompt('待检查正文');
  assert.match(prompt, /<draft-text>[\s\S]*待检查正文[\s\S]*<\/draft-text>/);
});

test('buildTypoFixUserPrompt lists all issues', () => {
  const prompt = buildTypoFixUserPrompt('正文', [
    { id: 'issue-1', original: 'A', suggestion: 'B', reason: '错字' },
  ]);
  assert.match(prompt, /<typo-issues>/);
  assert.match(prompt, /「A」→「B」/);
});

test('splitIntoSegments splits 4000-char content into 3 segments', () => {
  const paragraphs: string[] = [];
  for (let i = 0; i < 15; i++) {
    paragraphs.push(
      `这是第${i + 1}段的正文内容。包含了一些描写和对白。段落长度大约在两百到三百字之间。`.repeat(3)
    );
  }
  const content = paragraphs.join('\n\n');
  const segments = splitIntoSegments(content, '1. 调整节奏\n2. 润色对白');
  assert.equal(segments.length, 3);
  for (const seg of segments) {
    assert.ok(seg.originalText.length >= 200);
    assert.ok(seg.index >= 0 && seg.index < 3);
    assert.ok(seg.startParagraph <= seg.endParagraph);
    assert.ok(seg.planExcerpt.length > 0);
  }
});

test('splitIntoSegments handles empty content', () => {
  const segments = splitIntoSegments('', 'test plan');
  assert.equal(segments.length, 0);
});

test('splitIntoSegments handles content with fewer paragraphs than maxSegments', () => {
  const segments = splitIntoSegments('一段内容\n\n二段内容', 'plan');
  assert.equal(segments.length, 2);
  assert.equal(segments[0]!.originalText, '一段内容');
  assert.equal(segments[1]!.originalText, '二段内容');
});

test('buildSegmentPrompt includes segment index info and required sections', () => {
  const segment: Segment = {
    index: 1,
    originalText: '第二段原文内容',
    planExcerpt: '修改第二段节奏',
    startParagraph: 5,
    endParagraph: 9,
  };
  const chapter: ChapterOptimizeChapterRef = {
    chapterNo: 3,
    title: '试炼之夜',
    content: '全文',
    updatedAt: new Date(),
  };
  const prompt = buildSegmentPrompt({
    segment,
    chapter,
    instruction: '让节奏更紧凑',
    planText: '1. 调整整体节奏',
    appearingCharacters: ['菲伦', '尤里乌丝'],
    previousSegmentSummary: '第一段描写了主角进入地下城',
    totalSegments: 3,
  });

  assert.match(prompt, /第 2\/3 段/);
  assert.match(prompt, /第3章/);
  assert.match(prompt, /试炼之夜/);
  assert.match(prompt, /菲伦、尤里乌丝/);
  assert.match(prompt, /<segment-original>[\s\S]*第二段原文内容[\s\S]*<\/segment-original>/);
  assert.match(prompt, /【前段情节摘要】[\s\S]*第一段描写了主角进入地下城/);
  assert.match(prompt, /【SEG_SUMMARY】/);
});

test('buildSegmentPrompt omits previous summary for first segment', () => {
  const segment: Segment = {
    index: 0,
    originalText: '第一段原文',
    planExcerpt: '',
    startParagraph: 0,
    endParagraph: 4,
  };
  const chapter: ChapterOptimizeChapterRef = {
    chapterNo: 1,
    title: '开始',
    content: '全文',
    updatedAt: new Date(),
  };
  const prompt = buildSegmentPrompt({
    segment,
    chapter,
    instruction: '润色',
    planText: '润色全文',
    totalSegments: 2,
  });

  assert.match(prompt, /第 1\/2 段/);
  assert.ok(!prompt.includes('【前段情节摘要】'));
  assert.ok(!prompt.includes('【前段末文'));
});

test('resolveOptimizeSegmentCount uses fewer segments for shorter chapters', () => {
  assert.equal(resolveOptimizeSegmentCount(1000), 1);
  assert.equal(resolveOptimizeSegmentCount(4000), 2);
  assert.equal(resolveOptimizeSegmentCount(8000), 3);
});

test('buildSegmentPrompt includes boundary anchors and middle-segment constraints', () => {
  const segments: Segment[] = [
    {
      index: 0,
      originalText: '第一段第一句。第一段最后一句。',
      planExcerpt: 'plan',
      startParagraph: 0,
      endParagraph: 0,
    },
    {
      index: 1,
      originalText: '第二段首句在这里。第二段末句在这里。',
      planExcerpt: 'plan',
      startParagraph: 1,
      endParagraph: 1,
    },
    {
      index: 2,
      originalText: '第三段开始了。后续内容。',
      planExcerpt: 'plan',
      startParagraph: 2,
      endParagraph: 2,
    },
  ];
  const anchors = buildSegmentBoundaryAnchors(segments[1]!, segments);
  const prompt = buildSegmentPrompt({
    segment: segments[1]!,
    chapter: { chapterNo: 1, title: '章', content: '全文', updatedAt: new Date() },
    instruction: '润色',
    planText: '方案',
    previousSegmentTail: '前段最后一句对话。',
    previousSegmentSummary: '前段摘要',
    boundaryAnchors: anchors,
    totalSegments: 3,
  });
  assert.match(prompt, /【边界锚点·只读】/);
  assert.match(prompt, /上段原文末句：「第一段最后一句。」/);
  assert.match(prompt, /本段原文首句：「第二段首句在这里。」/);
  assert.match(prompt, /本段原文末句：「第二段末句在这里。」/);
  assert.match(prompt, /下段原文首句：「第三段开始了。」/);
  assert.match(prompt, /【中段专用】/);
  assert.match(prompt, /【前段末文/);
  assert.ok(!prompt.includes('【下段原文起笔'));
});

test('buildSegmentPrompt omits next anchor on last segment', () => {
  const segments: Segment[] = [
    {
      index: 0,
      originalText: '甲段末句。',
      planExcerpt: 'p',
      startParagraph: 0,
      endParagraph: 0,
    },
    {
      index: 1,
      originalText: '乙段首句。乙段末句。',
      planExcerpt: 'p',
      startParagraph: 1,
      endParagraph: 1,
    },
  ];
  const anchors = buildSegmentBoundaryAnchors(segments[1]!, segments);
  const prompt = buildSegmentPrompt({
    segment: segments[1]!,
    chapter: { chapterNo: 1, title: '章', content: '全文', updatedAt: new Date() },
    instruction: '润色',
    planText: '方案',
    boundaryAnchors: anchors,
    totalSegments: 2,
  });
  assert.ok(!prompt.includes('下段原文首句'));
  assert.match(prompt, /本段原文末句：「乙段末句。」/);
});

test('extractFirstSentence and extractLastSentence split on Chinese punctuation', () => {
  assert.equal(extractFirstSentence('你好。世界！'), '你好。');
  assert.equal(extractLastSentence('你好。世界！'), '世界！');
});

test('calculateSegmentMaxTokensForIndex caps middle segments', () => {
  const long = '字'.repeat(3000);
  const base = calculateSegmentMaxTokens(long);
  const middle = calculateSegmentMaxTokensForIndex(long, 1, 3);
  assert.ok(middle < base);
  assert.equal(calculateSegmentMaxTokensForIndex(long, 0, 3), base);
});

test('shouldRetrySegmentForLength detects overrun', () => {
  assert.equal(shouldRetrySegmentForLength('a'.repeat(100), 'b'.repeat(140)), true);
  assert.equal(shouldRetrySegmentForLength('a'.repeat(100), 'b'.repeat(120)), false);
});

test('extractSegmentTailText keeps trailing characters', () => {
  const tail = extractSegmentTailText('abcdefghij', 4);
  assert.equal(tail, 'ghij');
});

test('extractSegmentLeadText uses first paragraph', () => {
  const lead = extractSegmentLeadText('第一段。\n\n第二段。');
  assert.equal(lead, '第一段。');
});

test('parseSegmentOutput extracts text and summary when marker present', () => {
  const output = '优化后的第二段正文内容。\n\n【SEG_SUMMARY】第二段描写了战斗场面';
  const result = parseSegmentOutput(output);
  assert.equal(result.segmentText, '优化后的第二段正文内容。');
  assert.equal(result.summary, '第二段描写了战斗场面');
});

test('parseSegmentOutput falls back to last sentence when marker absent', () => {
  const output = '优化后的正文内容。战斗场面很激烈。';
  const result = parseSegmentOutput(output);
  assert.equal(result.segmentText, '优化后的正文内容。战斗场面很激烈。');
  assert.ok(result.summary.length > 0);
});

test('calculateSegmentMaxTokens returns at least 2048', () => {
  assert.equal(calculateSegmentMaxTokens('短文本'), 2048);
});

test('calculateSegmentMaxTokens caps at 4096', () => {
  const longText = 'x'.repeat(4000);
  assert.equal(calculateSegmentMaxTokens(longText), 4096);
});

test('calculateSegmentMaxTokens returns proportional value', () => {
  const text = 'x'.repeat(1500);
  const tokens = calculateSegmentMaxTokens(text);
  assert.ok(tokens >= 2048 && tokens <= 4096);
});
