import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChapterVersionConflictError,
  assertDraftText,
  assertInstruction,
  assertPlanText,
  assertOptimizeDraftRequest,
  parseFrozenReviewResult,
  buildFrozenReviewUserPrompt,
  resolveDraftSplitSource,
  buildDraftUserPrompt,
  buildDirectDraftUserPrompt,
  buildPlanRevisionInstruction,
  buildPlanUserPrompt,
  normalizeRewriteMode,
  ensureChapterVersionMatches,
  makeOptimizationId,
  normalizeInstruction,
  parseExpectedUpdatedAt,
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
  CHAPTER_OPTIMIZE_MAX_MAX_TOKENS,
  CHAPTER_OPTIMIZE_MIN_MAX_TOKENS,
  resolveChapterOptimizeLengthStrategy,
  resolveChapterOptimizeConfig,
  resolveChapterOptimizeConfigWithProjectOverride,
  resolveOptimizeDraftExecution,
  listOptimizeDraftSseStages,
  clampChapterOptimizeSegmentCharSize,
  DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE,
  MAX_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE,
  measureChapterDraftChangeRate,
  validateMergedChapterDraft,
  detectPlaceholderText,
  mergeSegmentDraftTexts,
  buildSegmentDiagnosisSystemPrompt,
  buildSegmentDiagnosisUserPrompt,
  CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_SEGMENT_MAX_RETRIES,
  buildPlanSynthesisUserPrompt,
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

test('buildPlanRevisionInstruction preserves current plan and revision feedback', () => {
  const prompt = buildPlanRevisionInstruction({
    instruction: '收紧节奏',
    currentPlanText: '1. 精简环境描写\n2. 保留关键对白',
    revisionFeedback: '第二点不要动，增加人物心理活动',
  });
  assert.match(prompt, /【原始优化要求】\n收紧节奏/);
  assert.match(prompt, /<current-optimization-plan>[\s\S]*保留关键对白/);
  assert.match(prompt, /【本轮方案修改意见】\n第二点不要动/);
  assert.match(prompt, /完整的新版优化方案/);
});

test('assertInstruction rejects empty and overly long strings', () => {
  assert.throws(() => assertInstruction(''), /不能为空/);
  assert.throws(() => assertInstruction('x'.repeat(20001)), /20000/);
  assert.doesNotThrow(() => assertInstruction('增加心理描写'));
  assert.doesNotThrow(() => assertInstruction('x'.repeat(2000)));
});

test('assertPlanText rejects empty plan', () => {
  assert.throws(() => assertPlanText(''), /planText/);
  assert.throws(() => assertPlanText('   '), /planText/);
  assert.doesNotThrow(() => assertPlanText('1. 改写第一段；2. 调整节奏'));
});

test('normalizeRewriteMode defaults omitted values to from-plan', () => {
  assert.equal(normalizeRewriteMode(undefined), 'from-plan');
  assert.equal(normalizeRewriteMode('from-plan'), 'from-plan');
  assert.equal(normalizeRewriteMode('direct'), 'direct');
  assert.equal(normalizeRewriteMode('other'), 'from-plan');
});

test('assertOptimizeDraftRequest requires planText for from-plan and allows omitting it for direct', () => {
  assert.throws(
    () => assertOptimizeDraftRequest({ instruction: '收紧节奏', planText: '' }),
    /planText/
  );
  assert.throws(
    () =>
      assertOptimizeDraftRequest({
        rewriteMode: 'from-plan',
        instruction: '收紧节奏',
      }),
    /planText/
  );
  const direct = assertOptimizeDraftRequest({
    rewriteMode: 'direct',
    instruction: '  收紧节奏  ',
  });
  assert.equal(direct.rewriteMode, 'direct');
  assert.equal(direct.instruction, '收紧节奏');
  assert.equal(direct.planText, '');
  assert.throws(
    () => assertOptimizeDraftRequest({ rewriteMode: 'direct', instruction: '' }),
    /instruction/
  );
  const withSource = assertOptimizeDraftRequest({
    rewriteMode: 'direct',
    instruction: '收紧节奏',
    sourceText: '上一稿正文不应被 direct 使用',
  });
  assert.equal(withSource.sourceText, '');
  const refine = assertOptimizeDraftRequest({
    rewriteMode: 'from-plan',
    instruction: '收紧节奏',
    planText: '压缩旁白',
    sourceText: '  上一轮优化正文  ',
  });
  assert.equal(refine.sourceText, '上一轮优化正文');
  const withGaps = assertOptimizeDraftRequest({
    rewriteMode: 'from-plan',
    instruction: '收紧节奏',
    planText: '压缩旁白',
    reviewGaps: '  章末张力仍虚  ',
  });
  assert.equal(withGaps.reviewGaps, '章末张力仍虚');
  const directGaps = assertOptimizeDraftRequest({
    rewriteMode: 'direct',
    instruction: '收紧节奏',
    reviewGaps: '不该带上',
  });
  assert.equal(directGaps.reviewGaps, '');
});

test('assertDraftText rejects empty draft', () => {
  assert.throws(() => assertDraftText(''), /draftText/);
  assert.doesNotThrow(() => assertDraftText('优化后的正文'));
});

test('buildPlanUserPrompt wraps chapter-original and asks for structured plan', () => {
  const prompt = buildPlanUserPrompt({
    chapter: sampleChapter,
    instruction: '增加心理描写',
  });

  assert.match(prompt, /<chapter-original chapter-no="3">/);
  assert.match(prompt, /<\/chapter-original>/);
  assert.match(prompt, /原章节正文内容，主角在地下城遇袭/);
  assert.match(prompt, /【用户优化要求】[\s\S]*增加心理描写/);
  assert.match(prompt, /请基于以上信息输出「优化方案」/);
  assert.match(prompt, /禁止直接输出新的正文/);
  assert.doesNotMatch(prompt, /<indexed-chapter/);
  assert.doesNotMatch(prompt, /文学策划/);
  assert.doesNotMatch(prompt, /落点提示/);
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
  assert.match(prompt, /实质性重写/);
  assert.doesNotMatch(prompt, /主锚/);
  assert.match(prompt, /禁止因「方案未点名具体句子/);
  assert.doesNotMatch(prompt, /当作改写方向/);
  assert.doesNotMatch(prompt, /不是句级待办清单/);
  assert.doesNotMatch(prompt, /文学策划/);
  assert.doesNotMatch(prompt, /\[n-m\]/);
  assert.doesNotMatch(prompt, /不得另起优化方案或大纲/);
});

test('buildDraftUserPrompt uses sourceText as chapter-original and adds refine constraint', () => {
  const prompt = buildDraftUserPrompt({
    chapter: sampleChapter,
    instruction: '让节奏更紧凑',
    planText: '1. 落实方案每一条',
    sourceText: '上一轮已经改过的正文，林默走进营地。',
  });

  assert.match(prompt, /上一轮已经改过的正文，林默走进营地。/);
  assert.doesNotMatch(prompt, /原章节正文内容，主角在地下城遇袭/);
  assert.match(prompt, /不得另起优化方案或大纲/);
  assert.match(prompt, /<optimization-plan chapter-no="3">/);
});

test('parseFrozenReviewResult reads CLOSED and GAPS markers', () => {
  assert.equal(parseFrozenReviewResult('【验收结论】CLOSED').hasMaterialGaps, false);
  assert.equal(
    parseFrozenReviewResult('【验收结论】GAPS\n【缺口说明】章末虚').hasMaterialGaps,
    true
  );
  assert.equal(parseFrozenReviewResult('无实质缺口，可以收口').hasMaterialGaps, false);
  assert.equal(parseFrozenReviewResult('x'.repeat(80)).hasMaterialGaps, true);
  assert.equal(parseFrozenReviewResult('短').hasMaterialGaps, false);
});

test('buildFrozenReviewUserPrompt freezes plan and draft', () => {
  const prompt = buildFrozenReviewUserPrompt({
    chapter: sampleChapter,
    instruction: '收紧节奏',
    planText: '主锚在营火',
    draftText: '新写的正文',
  });
  assert.match(prompt, /收紧节奏/);
  assert.match(prompt, /主锚在营火/);
  assert.match(prompt, /新写的正文/);
  assert.match(prompt, /【验收结论】CLOSED/);
});

test('resolveDraftSplitSource prefers previous draft', () => {
  assert.equal(resolveDraftSplitSource('入库原文', '上一稿'), '上一稿');
  assert.equal(resolveDraftSplitSource('入库原文', '  '), '入库原文');
});

test('buildDraftUserPrompt injects review gaps on refine pass', () => {
  const prompt = buildDraftUserPrompt({
    chapter: sampleChapter,
    instruction: '让节奏更紧凑',
    planText: '1. 落实方案每一条',
    sourceText: '上一轮已经改过的正文',
    reviewGaps: '章末对峙仍被旁白稀释',
  });
  assert.match(prompt, /【冻结合同未落实缺口】/);
  assert.match(prompt, /章末对峙仍被旁白稀释/);
  assert.match(prompt, /禁止另开润色愿望/);
});

test('buildDirectDraftUserPrompt injects instruction and original chapter without optimization-plan', () => {
  const prompt = buildDirectDraftUserPrompt({
    chapter: sampleChapter,
    instruction: '让节奏更紧凑，减少解释性叙述',
  });

  assert.match(prompt, /【用户优化要求】[\s\S]*让节奏更紧凑，减少解释性叙述/);
  assert.match(prompt, /<chapter-original chapter-no="3">/);
  assert.match(prompt, /原章节正文内容/);
  assert.match(prompt, /请直接输出「优化后的章节正文」纯文本/);
  assert.match(prompt, /改动幅度由【用户优化要求】决定/);
  assert.doesNotMatch(prompt, /不低于原文的/);
  assert.doesNotMatch(prompt, /段落数不得少于原文/);
  assert.doesNotMatch(prompt, /<optimization-plan/);
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
  assert.doesNotMatch(prompt, /【SEG_SUMMARY】/);
  assert.match(prompt, /不要附加摘要、说明或其他元信息/);
  assert.match(prompt, /<optimization-plan>/);
  assert.match(prompt, /禁止「前半改写、后半原样粘贴」/);
  assert.doesNotMatch(prompt, /若本段无需修改，则原样输出/);
});

test('buildSegmentPrompt injects review gaps', () => {
  const segment: Segment = {
    index: 0,
    originalText: '上一稿本段',
    planExcerpt: '',
    startParagraph: 0,
    endParagraph: 0,
  };
  const prompt = buildSegmentPrompt({
    segment,
    chapter: sampleChapter,
    instruction: '收紧节奏',
    planText: '压缩旁白',
    totalSegments: 2,
    reviewGaps: '本段对峙被解释冲淡',
  });
  assert.match(prompt, /【冻结合同未落实缺口】/);
  assert.match(prompt, /本段对峙被解释冲淡/);
});

test('buildSegmentPrompt in direct mode omits optimization-plan and keeps instruction plus segment original', () => {
  const segment: Segment = {
    index: 0,
    originalText: '第一段原文内容',
    planExcerpt: '',
    startParagraph: 0,
    endParagraph: 2,
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
    instruction: '收紧节奏，减少解释性叙述',
    planText: '',
    omitOptimizationPlan: true,
    totalSegments: 2,
  });

  assert.match(prompt, /【用户优化要求】[\s\S]*收紧节奏，减少解释性叙述/);
  assert.match(prompt, /<segment-original>[\s\S]*第一段原文内容/);
  assert.doesNotMatch(prompt, /<optimization-plan/);
  assert.doesNotMatch(prompt, /<segment-local-plan/);
});

test('resolveOptimizeDraftExecution segments long chapters in direct mode without plan diagnosis stages', () => {
  const strategy = resolveChapterOptimizeLengthStrategy(15000);
  const execution = resolveOptimizeDraftExecution({ rewriteMode: 'direct', strategy });
  assert.equal(execution.optimizationMode, 'segmented');
  assert.equal(execution.segmentTotal, strategy.segmentCount);
  assert.equal(execution.skipPlanDiagnosis, true);
  const stages = listOptimizeDraftSseStages(execution);
  assert.ok(stages.includes('draft_segment'));
  assert.ok(stages.includes('merge_validation'));
  assert.equal(stages.includes('segment_diagnosis'), false);
  assert.equal(stages.includes('plan_synthesis'), false);
});

test('resolveOptimizeDraftExecution segments long chapters in from-plan mode without plan diagnosis stages', () => {
  const strategy = resolveChapterOptimizeLengthStrategy(15000);
  const execution = resolveOptimizeDraftExecution({ rewriteMode: 'from-plan', strategy });
  assert.equal(execution.optimizationMode, 'segmented');
  assert.equal(execution.segmentTotal, strategy.segmentCount);
  assert.equal(execution.skipPlanDiagnosis, false);
  assert.match(execution.strategyLabel, /按方案分段生成正文/);
  const stages = listOptimizeDraftSseStages(execution);
  assert.ok(stages.includes('draft_segment'));
  assert.ok(stages.includes('merge_validation'));
  assert.equal(stages.includes('segment_diagnosis'), false);
  assert.equal(stages.includes('plan_synthesis'), false);
});

test('buildSegmentPrompt injects optimization plan for from-plan segments', () => {
  const segment: Segment = {
    index: 0,
    originalText: '第一段原文内容',
    planExcerpt: '主锚：起床。关键一笔：改为「他坐起身」。',
    startParagraph: 0,
    endParagraph: 0,
  };
  const chapter: ChapterOptimizeChapterRef = {
    chapterNo: 2,
    title: '测试章',
    content: '全文',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const prompt = buildSegmentPrompt({
    segment,
    chapter,
    instruction: '加强感官',
    planText: '主锚：起床。关键一笔：改为「他坐起身」。',
    omitOptimizationPlan: false,
    totalSegments: 2,
  });

  assert.match(prompt, /<optimization-plan>[\s\S]*主锚：起床/);
  assert.match(prompt, /<segment-original>[\s\S]*第一段原文内容/);
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

test('resolveOptimizeSegmentCount returns segment count by 3000-char chunks', () => {
  const config = resolveChapterOptimizeConfig();
  assert.equal(resolveOptimizeSegmentCount(1000, undefined, config), 1);
  assert.equal(resolveOptimizeSegmentCount(4000, undefined, config), 2);
  assert.equal(resolveOptimizeSegmentCount(8000, undefined, config), 3);
  assert.equal(resolveOptimizeSegmentCount(15000, undefined, config), 5);
});

test('resolveOptimizeSegmentCount returns 1 when segmentation disabled', () => {
  const disabled = {
    ...resolveChapterOptimizeConfig(),
    segmentationEnabled: false,
  };
  assert.equal(resolveOptimizeSegmentCount(15000, undefined, disabled), 1);
});

test('resolveChapterOptimizeLengthStrategy segments oversized chapters instead of rejecting', () => {
  const strategy = resolveChapterOptimizeLengthStrategy(15000);
  assert.equal(strategy.mode, 'segmented');
  assert.equal(strategy.segmentCount, 5);
  assert.match(strategy.strategyLabel, /5 段优化/);
});

test('resolveChapterOptimizeLengthStrategy maps medium chapters to ceil(chars/3000) segments', () => {
  const strategy = resolveChapterOptimizeLengthStrategy(4000);
  assert.equal(strategy.mode, 'segmented');
  assert.equal(strategy.segmentCount, 2);
  assert.match(strategy.strategyLabel, /2 段优化/);
});

test('resolveChapterOptimizeLengthStrategy respects segmentCharSize=0 as no split', () => {
  const config = resolveChapterOptimizeConfigWithProjectOverride(0);
  const strategy = resolveChapterOptimizeLengthStrategy(15000, config);
  assert.equal(strategy.mode, 'single');
  assert.equal(strategy.segmentCount, 1);
  assert.equal(strategy.strategyLabel, '整章优化（未按字数分段）');
});

test('resolveChapterOptimizeLengthStrategy uses custom project segment size', () => {
  const config = resolveChapterOptimizeConfigWithProjectOverride(2000);
  const strategy = resolveChapterOptimizeLengthStrategy(4000, config);
  assert.equal(strategy.mode, 'segmented');
  assert.equal(strategy.segmentCount, 2);
  assert.match(strategy.strategyLabel, /约 2000 字\/段/);
});

test('clampChapterOptimizeSegmentCharSize allows 0 and clamps upper bound', () => {
  assert.equal(clampChapterOptimizeSegmentCharSize(0), 0);
  assert.equal(clampChapterOptimizeSegmentCharSize('0'), 0);
  assert.equal(clampChapterOptimizeSegmentCharSize(25000), MAX_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE);
  assert.equal(
    clampChapterOptimizeSegmentCharSize(undefined),
    DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE
  );
});

test('detectPlaceholderText flags common placeholder phrases', () => {
  assert.equal(detectPlaceholderText('正文（此处省略）后续'), '（此处省略）');
  assert.equal(detectPlaceholderText('正常正文内容'), null);
  assert.equal(detectPlaceholderText('其余情节同上。'), '同上');
  assert.equal(detectPlaceholderText('（同上）'), '同上');
  assert.equal(
    detectPlaceholderText('她重新将注意力放回合同上，但显然，这次的专注度更高了。'),
    null
  );
  assert.equal(detectPlaceholderText('认同上述安排后她点了点头。'), null);
});

test('validateMergedChapterDraft 不按字数或段落数裁决改动幅度', () => {
  for (const repeat of [90, 70, 40, 10]) {
    const result = validateMergedChapterDraft({ mergedDraft: '字'.repeat(repeat) });
    assert.equal(result.passed, true, `${repeat}% 篇幅属于合法改写，系统不得拦截`);
  }

  const fewerParagraphs = validateMergedChapterDraft({ mergedDraft: '合并后的单段正文。' });
  assert.equal(fewerParagraphs.passed, true);
});

test('validateMergedChapterDraft 仍拦截空输出与占位语', () => {
  assert.equal(validateMergedChapterDraft({ mergedDraft: '   ' }).passed, false);

  const placeholder = validateMergedChapterDraft({
    mergedDraft: '第一段正文。\n\n（此处省略）\n\n第三段正文。',
  });
  assert.equal(placeholder.passed, false);
  assert.ok(placeholder.failures.some((item) => item.includes('占位语')));
});

test('measureChapterDraftChangeRate 统计一字未动的段落', () => {
  const original = '第一段原文。\n\n第二段原文。\n\n第三段原文。';
  const draft = '第一段原文。\n\n第二段被改写了，明显不同。\n\n第三段原文。';
  const rate = measureChapterDraftChangeRate(original, draft);
  assert.equal(rate.originalParagraphs, 3);
  assert.equal(rate.draftParagraphs, 3);
  assert.equal(rate.unchangedParagraphs, 2);
  assert.ok(Math.abs(rate.unchangedRatio - 2 / 3) < 1e-9);

  const copied = measureChapterDraftChangeRate(original, original);
  assert.equal(copied.unchangedRatio, 1, '整章照抄必须显示 100% 未变');
});

test('mergeSegmentDraftTexts joins segments with blank lines', () => {
  assert.equal(mergeSegmentDraftTexts(['第一段', '第二段']), '第一段\n\n第二段');
});

test('buildSegmentDiagnosisSystemPrompt carries published plan plus scan limiter', () => {
  const published = '【已发布方案标准】主锚必须落到可执行的关键一笔。';
  const prompt = buildSegmentDiagnosisSystemPrompt(published);
  assert.match(prompt, /【已发布方案标准】/);
  assert.match(prompt, /主锚必须落到可执行的关键一笔/);
  assert.match(prompt, /只扫描当前片段/);
  assert.match(prompt, /禁止输出整章方案或新正文/);

  const fallback = buildSegmentDiagnosisSystemPrompt();
  assert.match(fallback, new RegExp(CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT.slice(0, 12)));
  assert.match(fallback, /只扫描当前片段/);
});

test('buildSegmentDiagnosisUserPrompt wraps segment original text', () => {
  const segment: Segment = {
    index: 0,
    originalText: '第一段原文',
    planExcerpt: '',
    startParagraph: 0,
    endParagraph: 0,
  };
  const prompt = buildSegmentDiagnosisUserPrompt({
    chapter: sampleChapter,
    instruction: '润色',
    segment,
    totalSegments: 2,
  });
  assert.match(prompt, /<segment-original/);
  assert.match(prompt, /第一段原文/);
  assert.match(prompt, /200～400 字/);
});

test('buildPlanSynthesisUserPrompt includes all segment diagnoses', () => {
  const prompt = buildPlanSynthesisUserPrompt({
    chapter: sampleChapter,
    instruction: '润色',
    segmentDiagnoses: [
      { segmentIndex: 1, diagnosisText: '第一段诊断' },
      { segmentIndex: 2, diagnosisText: '第二段诊断' },
    ],
  });
  assert.match(prompt, /第一段诊断/);
  assert.match(prompt, /第二段诊断/);
  assert.match(prompt, /<chapter-original/);
  assert.match(prompt, /不要机械拼接分段报告/);
  assert.doesNotMatch(prompt, /主锚/);
});

test('CHAPTER_OPTIMIZE_SEGMENT_MAX_RETRIES is 1', () => {
  assert.equal(CHAPTER_OPTIMIZE_SEGMENT_MAX_RETRIES, 1);
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
  assert.match(prompt, /是刚发生的事/);
  assert.doesNotMatch(prompt, /语气参考/);
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

test('calculateSegmentMaxTokensForIndex 不再对中段单独压低 token', () => {
  const long = '字'.repeat(3000);
  const base = calculateSegmentMaxTokens(long);
  assert.equal(calculateSegmentMaxTokensForIndex(long, 1, 3), base);
  assert.equal(calculateSegmentMaxTokensForIndex(long, 0, 3), base);

  const short = '字'.repeat(500);
  assert.equal(
    calculateSegmentMaxTokensForIndex(short, 1, 3),
    calculateSegmentMaxTokens(short),
    '短段中段也不再额外压低，避免后半段写不下回抄'
  );
  assert.ok(calculateSegmentMaxTokens(short) >= 4096);
});

test('shouldRetrySegmentForLength 只在跑飞时触发，不拦截正常扩写', () => {
  assert.equal(shouldRetrySegmentForLength('a'.repeat(100), 'b'.repeat(300)), true);
  assert.equal(shouldRetrySegmentForLength('a'.repeat(100), 'b'.repeat(200)), false);
  assert.equal(shouldRetrySegmentForLength('a'.repeat(100), 'b'.repeat(140)), false);
});

test('extractSegmentTailText keeps trailing characters when no sentence boundary exists', () => {
  const tail = extractSegmentTailText('abcdefghij', 4);
  assert.equal(tail, 'ghij');
});

test('extractSegmentTailText starts after the last sentence boundary before the cut', () => {
  const earlier = `${'甲'.repeat(30)}。`;
  const middle = `${'乙'.repeat(40)}。`;
  const last = `${'丙'.repeat(50)}。`;
  const tail = extractSegmentTailText(`${earlier}${middle}${last}`, 80);
  assert.equal(tail, `${middle}${last}`);
});

test('extractSegmentTailText keeps a last sentence longer than the budget', () => {
  const earlier = `${'甲'.repeat(20)}。`;
  const last = `${'乙'.repeat(150)}。`;
  const tail = extractSegmentTailText(`${earlier}${last}`, 80);
  assert.equal(tail, last);
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

test('calculateSegmentMaxTokens returns at least 4096', () => {
  assert.equal(calculateSegmentMaxTokens('短文本'), CHAPTER_OPTIMIZE_MIN_MAX_TOKENS);
});

test('calculateSegmentMaxTokens caps at 65536', () => {
  const longText = 'x'.repeat(40000);
  assert.equal(calculateSegmentMaxTokens(longText), CHAPTER_OPTIMIZE_MAX_MAX_TOKENS);
});

test('calculateSegmentMaxTokens returns proportional value for mid-length', () => {
  const text = 'x'.repeat(3000);
  const tokens = calculateSegmentMaxTokens(text);
  assert.equal(tokens, Math.ceil(3000 * 2.5));
  assert.ok(tokens >= CHAPTER_OPTIMIZE_MIN_MAX_TOKENS && tokens <= CHAPTER_OPTIMIZE_MAX_MAX_TOKENS);
});
