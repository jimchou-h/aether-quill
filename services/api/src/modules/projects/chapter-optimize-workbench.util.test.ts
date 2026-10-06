import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_TEMPLATE_KEY,
  assertWorkbenchDraftRequest,
  assertWorkbenchFixSpanRequest,
  assertWorkbenchPlanRequest,
  assertWorkbenchReviewRequest,
  buildWorkbenchDraftUserPrompt,
  buildWorkbenchPlanUserPrompt,
  buildWorkbenchSceneDraftUserPrompt,
  isNearCopyWorkbenchDraft,
  filterWorkbenchReviewItems,
  locateUniqueAnchor,
  parseWorkbenchReviewItems,
  resolveWorkbenchDraftTemplateKey,
  shouldSplitWorkbenchRange,
  sliceWorkbenchRange,
  sliceWorkbenchRangeNeighborhood,
  spliceChapterRange,
  splitWorkbenchRewriteWindows,
  WORKBENCH_RANGE_CONTEXT_CHARS,
  WORKBENCH_REWRITE_WINDOW_CHARS,
} from './chapter-optimize-workbench.util';
import {
  resolveOptimizeDraftExecution,
  resolveChapterOptimizeLengthStrategy,
} from './chapter-optimize.util';

test('spliceChapterRange keeps text outside the UTF-16 range', () => {
  const base = '客厅过场。浴室一段。走廊收束。';
  const start = base.indexOf('浴室');
  const end = base.indexOf('走廊');
  assert.equal(
    spliceChapterRange(base, start, end, '浴室加料后。'),
    '客厅过场。浴室加料后。走廊收束。'
  );
});

test('locateUniqueAnchor returns null for 0 or 2 matches', () => {
  assert.equal(locateUniqueAnchor('走廊里只剩脚步。', '钥匙掉在地毯上'), null);
  const quote = '她低声说好。';
  assert.equal(locateUniqueAnchor(`${quote}过场。${quote}`, quote), null);
  assert.deepEqual(locateUniqueAnchor(`开头${quote}结尾`, quote), {
    start: 2,
    end: 2 + quote.length,
  });
});

test('filterWorkbenchReviewItems drops illegal kind and additive instructions', () => {
  const kept = filterWorkbenchReviewItems([
    { kind: 'pose', instruction: '改成背靠墙' },
    { kind: 'tension', instruction: '补动作' },
    { kind: 'regression', instruction: '再加深这段' },
    { kind: 'vocab', instruction: '写细水声' },
    { kind: 'regression', instruction: '再补细节再继续' },
    { kind: 'regression', instruction: '这段再更浓一点' },
    { kind: 'regression', instruction: '恢复被删的拍打接触' },
  ]);
  assert.deepEqual(
    kept.map((item) => item.instruction),
    ['改成背靠墙', '恢复被删的拍打接触']
  );
});

test('workbench draft never uses splitIntoSegments on a long user-drawn range', () => {
  const longRange = '一段范围内正文。'.repeat(4000);
  assert.ok(longRange.length > 20000);
  assert.equal(shouldSplitWorkbenchRange(longRange), false);
  const windows = splitWorkbenchRewriteWindows(longRange);
  assert.ok(windows.length >= 2);
  assert.equal(windows.map((window) => window.text).join(''), longRange);
  const sliced = sliceWorkbenchRange(`前${longRange}后`, 1, 1 + longRange.length);
  assert.equal(sliced, longRange);
  const prompt = buildWorkbenchDraftUserPrompt({
    chapterNo: 2,
    title: '浴室',
    instruction: '加料',
    profile: 'sex',
    rangeText: longRange,
  });
  assert.match(prompt, /<range-original>/);
  assert.doesNotMatch(prompt, /<segment-original/);
  assert.equal(
    resolveWorkbenchDraftTemplateKey('sex'),
    CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_TEMPLATE_KEY
  );
  assert.equal(
    resolveWorkbenchDraftTemplateKey('prose'),
    CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_TEMPLATE_KEY
  );
});

test('assertWorkbenchDraftRequest rejects empty instruction, inverted offsets, empty range', () => {
  const sourceText = '客厅过场。浴室一段。走廊收束。';
  const startOffset = sourceText.indexOf('浴室');
  const endOffset = sourceText.indexOf('走廊');
  const valid = {
    instruction: '加料',
    profile: 'sex',
    startOffset,
    endOffset,
    baseUpdatedAt: '2026-09-26T00:00:00.000Z',
    sourceText,
  };
  const asserted = assertWorkbenchDraftRequest(valid);
  assert.equal(asserted.rangeText, '浴室一段。');
  assert.equal(asserted.beforeContext, '客厅过场。');
  assert.equal(asserted.afterContext, '走廊收束。');
  assert.throws(() => assertWorkbenchDraftRequest({ ...valid, instruction: '  ' }), /instruction/);
  assert.throws(
    () => assertWorkbenchDraftRequest({ ...valid, startOffset: endOffset, endOffset: startOffset }),
    /起止/
  );
  assert.throws(
    () => assertWorkbenchDraftRequest({ ...valid, startOffset: 3, endOffset: 3 }),
    /起止/
  );
});

test('workbench draft attaches read-only adjacent context for stitching', () => {
  const prefix = '前'.repeat(WORKBENCH_RANGE_CONTEXT_CHARS + 80);
  const range = '范围内要改的一场。';
  const suffix = '后'.repeat(WORKBENCH_RANGE_CONTEXT_CHARS + 40);
  const sourceText = `${prefix}${range}${suffix}`;
  const startOffset = prefix.length;
  const endOffset = startOffset + range.length;
  const neighborhood = sliceWorkbenchRangeNeighborhood(sourceText, startOffset, endOffset);
  assert.equal(neighborhood.beforeContext.length, WORKBENCH_RANGE_CONTEXT_CHARS);
  assert.equal(neighborhood.afterContext.length, WORKBENCH_RANGE_CONTEXT_CHARS);
  assert.equal(neighborhood.beforeContext.endsWith('前'.repeat(8)), true);
  const prompt = buildWorkbenchDraftUserPrompt({
    chapterNo: 2,
    title: '床上',
    instruction: '加料',
    profile: 'sex',
    rangeText: range,
    beforeContext: neighborhood.beforeContext,
    afterContext: neighborhood.afterContext,
  });
  assert.match(prompt, /<before-context>/);
  assert.match(prompt, /<after-context>/);
  assert.match(prompt, /<range-original>\n范围内要改的一场。\n<\/range-original>/);
  assert.match(prompt, /只读，用来把头尾接上/);
  assert.match(prompt, /禁止大段照抄原文/);
  assert.match(prompt, /原文原样交回视为失败/);
  const atStart = sliceWorkbenchRangeNeighborhood(sourceText, 0, 3);
  assert.equal(atStart.beforeContext, '');
  const atEnd = sliceWorkbenchRangeNeighborhood(
    sourceText,
    sourceText.length - 3,
    sourceText.length
  );
  assert.equal(atEnd.afterContext, '');
});

test('isNearCopyWorkbenchDraft flags verbatim or barely-expanded copies', () => {
  const original = `${'甲段原文。'.repeat(40)}${'乙段原文。'.repeat(40)}${'丙段原文。'.repeat(40)}`;
  assert.equal(isNearCopyWorkbenchDraft(original, original), true);
  assert.equal(isNearCopyWorkbenchDraft(original, `${original}尾补一句。`), true);
  assert.equal(
    isNearCopyWorkbenchDraft(
      original,
      original.replace(/甲段原文/g, '甲段重写').replace(/乙段原文/g, '乙段重写')
    ),
    false
  );
});

test('splitWorkbenchRewriteWindows keeps short ranges as one window', () => {
  const short = '浴室一段。';
  assert.deepEqual(splitWorkbenchRewriteWindows(short), [
    { start: 0, end: short.length, text: short },
  ]);
  assert.ok(short.length < WORKBENCH_REWRITE_WINDOW_CHARS);
});

test('workbench continuation prompt names the rewrite window', () => {
  const prompt = buildWorkbenchDraftUserPrompt({
    chapterNo: 1,
    title: '床上',
    instruction: '加料',
    profile: 'sex',
    rangeText: '第二窗原文。',
    beforeContext: '已改写的前文。',
    windowIndex: 1,
    windowTotal: 3,
  });
  assert.match(prompt, /第 2\/3 段/);
  assert.match(prompt, /禁止把后窗原文提前写完/);
});

test('prose draft prompt does not inject sensory-thickening requirements', () => {
  const prompt = buildWorkbenchDraftUserPrompt({
    chapterNo: 2,
    title: '过场',
    instruction: '顺一下对白',
    profile: 'prose',
    rangeText: '两人走出浴室，走廊灯还亮着。',
  });
  assert.match(prompt, /日常文笔/);
  assert.match(prompt, /禁止按感官加料要求/);
  assert.doesNotMatch(prompt, /性爱|体位/);
});

test('parseWorkbenchReviewItems drops illegal kinds, additive instructions, and prose pose/vocab', () => {
  const raw = JSON.stringify({
    items: [
      {
        id: 'w1',
        kind: 'pose',
        severity: 'high',
        anchorQuote: '她抬起左腿跨过门槛',
        issue: '动作穿帮',
        instruction: '改成背靠墙',
      },
      {
        kind: 'regression',
        anchorQuote: '钥匙掉在地毯上',
        issue: '当拍接触被删',
        instruction: '加深这段拍打',
      },
      {
        kind: 'tension',
        anchorQuote: '走廊灯还亮着',
        issue: '还能更浓',
        instruction: '再补细节',
      },
      {
        kind: 'regression',
        anchorQuote: '走廊灯还亮着于是他们走了',
        issue: '并段',
        instruction: '拆回两段，保留过场呼吸',
      },
    ],
  });
  const sexItems = parseWorkbenchReviewItems(raw, 'sex');
  assert.deepEqual(
    sexItems.map((item) => item.id),
    ['w1', 'w2']
  );
  assert.equal(sexItems[1]?.kind, 'regression');
  const proseItems = parseWorkbenchReviewItems(raw, 'prose');
  assert.equal(proseItems.length, 1);
  assert.equal(proseItems[0]?.kind, 'regression');
});

test('assertWorkbenchFixSpanRequest requires span and instruction', () => {
  assert.throws(
    () =>
      assertWorkbenchFixSpanRequest({ spanText: '', instruction: '改拍打节奏', profile: 'sex' }),
    /spanText/
  );
  assert.throws(
    () =>
      assertWorkbenchFixSpanRequest({
        spanText: '钥匙掉在地毯上',
        instruction: ' ',
        profile: 'sex',
      }),
    /instruction/
  );
  const parsed = assertWorkbenchFixSpanRequest({
    spanText: '钥匙掉在地毯上',
    instruction: '改为拍打桌面',
    profile: 'sex',
    beforeContext: '前文',
    afterContext: '后文',
  });
  assert.equal(parsed.spanText, '钥匙掉在地毯上');
});

test('assertWorkbenchReviewRequest rejects empty rangeText', () => {
  assert.throws(
    () => assertWorkbenchReviewRequest({ profile: 'sex', rangeText: '  ' }),
    /rangeText/
  );
});

test('direct long-chapter segmentation is unchanged beside the new workbench path', () => {
  const strategy = resolveChapterOptimizeLengthStrategy(15000);
  const execution = resolveOptimizeDraftExecution({ rewriteMode: 'direct', strategy });
  assert.equal(execution.optimizationMode, 'segmented');
  assert.equal(shouldSplitWorkbenchRange('x'.repeat(15000)), false);
});

test('workbench util source does not call splitIntoSegments', () => {
  const source = readFileSync(
    path.resolve(__dirname, './chapter-optimize-workbench.util.ts'),
    'utf8'
  );
  assert.equal(source.includes('splitIntoSegments('), false);
  assert.ok(source.includes(CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_TEMPLATE_KEY));
  assert.ok(source.includes(CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_TEMPLATE_KEY));
});

// ---------------------------------------------------------------------------
// 红灯基线：旧两档（sex / prose）draft 行为冻结。
// 后续为「按场创编」增加 mode / planText 时，下面两组快照必须逐字节不变。
// ---------------------------------------------------------------------------

const LEGACY_DRAFT_INPUT = {
  instruction: '收紧节奏',
  profile: 'sex',
  startOffset: 3,
  endOffset: 9,
  baseUpdatedAt: '2026-10-01T00:00:00.000Z',
  sourceText: '前文。范围内一句。后文。',
};

function legacyDraftView(input: Parameters<typeof assertWorkbenchDraftRequest>[0]) {
  const normalized = assertWorkbenchDraftRequest(input);
  return {
    instruction: normalized.instruction,
    profile: normalized.profile,
    startOffset: normalized.startOffset,
    endOffset: normalized.endOffset,
    baseUpdatedAt: normalized.baseUpdatedAt,
    sourceText: normalized.sourceText,
    rangeText: normalized.rangeText,
    beforeContext: normalized.beforeContext,
    afterContext: normalized.afterContext,
    appearingCharacters: normalized.appearingCharacters,
  };
}

test('baseline: sex and prose draft normalization is frozen', () => {
  assert.deepEqual(legacyDraftView(LEGACY_DRAFT_INPUT), {
    instruction: '收紧节奏',
    profile: 'sex',
    startOffset: 3,
    endOffset: 9,
    baseUpdatedAt: '2026-10-01T00:00:00.000Z',
    sourceText: '前文。范围内一句。后文。',
    rangeText: '范围内一句。',
    beforeContext: '前文。',
    afterContext: '后文。',
    appearingCharacters: undefined,
  });

  assert.deepEqual(legacyDraftView({ ...LEGACY_DRAFT_INPUT, profile: 'prose' }), {
    instruction: '收紧节奏',
    profile: 'prose',
    startOffset: 3,
    endOffset: 9,
    baseUpdatedAt: '2026-10-01T00:00:00.000Z',
    sourceText: '前文。范围内一句。后文。',
    rangeText: '范围内一句。',
    beforeContext: '前文。',
    afterContext: '后文。',
    appearingCharacters: undefined,
  });
});

test('baseline: sex and prose draft user prompt is frozen', () => {
  const sexPrompt = buildWorkbenchDraftUserPrompt({
    chapterNo: 3,
    title: '雨夜',
    instruction: '收紧节奏',
    profile: 'sex',
    rangeText: '范围内一句。',
    beforeContext: '前文。',
    afterContext: '后文。',
  });
  assert.equal(
    sexPrompt,
    [
      '【写作目标】请按「感官加料」档改写第3章「雨夜」中用户划定的连续范围。',
      '',
      '【用户优化要求】',
      '收紧节奏',
      '',
      '<before-context>',
      '前文。',
      '</before-context>',
      '',
      '<range-original>',
      '范围内一句。',
      '</range-original>',
      '',
      '<after-context>',
      '后文。',
      '</after-context>',
      '',
      '请直接输出该范围内改写后的正文纯文本，不要方案、说明、Markdown 标题或代码块。',
      '必须基于 <range-original> 从头到尾重写；禁止输出范围外原文。',
      '禁止大段照抄原文；禁止「前半改写、后半原样粘贴」；禁止原样输出 <range-original>。',
      '感官加料：必须有可见加料。原文原样交回视为失败。',
      '若有 <before-context> / <after-context>：只读，用来把头尾接上；不要复述或改写它们。',
    ].join('\n')
  );

  const prosePrompt = buildWorkbenchDraftUserPrompt({
    chapterNo: 3,
    title: '雨夜',
    instruction: '收紧节奏',
    profile: 'prose',
    rangeText: '范围内一句。',
    beforeContext: '前文。',
    afterContext: '后文。',
  });
  assert.equal(
    prosePrompt,
    [
      '【写作目标】请按「日常文笔」档改写第3章「雨夜」中用户划定的连续范围。',
      '',
      '【用户优化要求】',
      '收紧节奏',
      '',
      '【档位约束】本档为日常文笔。禁止按感官加料要求增色、堆砌特写或无必要地夸张动作。',
      '',
      '<before-context>',
      '前文。',
      '</before-context>',
      '',
      '<range-original>',
      '范围内一句。',
      '</range-original>',
      '',
      '<after-context>',
      '后文。',
      '</after-context>',
      '',
      '请直接输出该范围内改写后的正文纯文本，不要方案、说明、Markdown 标题或代码块。',
      '必须基于 <range-original> 从头到尾重写；禁止输出范围外原文。',
      '禁止大段照抄原文；禁止「前半改写、后半原样粘贴」；禁止原样输出 <range-original>。',
      '日常文笔：必须有可见的节奏、对白或衔接改动；禁止原样交回；禁止增色。',
      '若有 <before-context> / <after-context>：只读，用来把头尾接上；不要复述或改写它们。',
    ].join('\n')
  );
});

// ---------------------------------------------------------------------------
// 按场创编：新增 plan 请求校验 / 四块方案引导 / 场上成稿 prompt
// ---------------------------------------------------------------------------

test('assertWorkbenchPlanRequest accepts an offset-only request without profile', () => {
  const normalized = assertWorkbenchPlanRequest({
    instruction: '把过场压掉，加一拍争执，散场锁在门口。',
    startOffset: 3,
    endOffset: 9,
    baseUpdatedAt: '2026-10-01T00:00:00.000Z',
    sourceText: '前文。范围内一句。后文。',
  });
  assert.equal(normalized.instruction, '把过场压掉，加一拍争执，散场锁在门口。');
  assert.equal(normalized.profile, undefined);
  assert.equal(normalized.rangeText, '范围内一句。');
  assert.equal(normalized.beforeContext, '前文。');
  assert.equal(normalized.afterContext, '后文。');
});

test('assertWorkbenchPlanRequest rejects empty range and empty instruction', () => {
  const base = {
    startOffset: 3,
    endOffset: 9,
    baseUpdatedAt: '2026-10-01T00:00:00.000Z',
    sourceText: '前文。范围内一句。后文。',
  };
  assert.throws(() => assertWorkbenchPlanRequest({ ...base, instruction: '   ' }), /instruction/);
  assert.throws(
    () =>
      assertWorkbenchPlanRequest({ ...base, instruction: '改一下', startOffset: 5, endOffset: 5 }),
    /划选|起止/
  );
});

test('assertWorkbenchPlanRequest rejects a range longer than one window', () => {
  const longBody = '句。'.repeat(Math.ceil(WORKBENCH_REWRITE_WINDOW_CHARS / 2) + 10);
  assert.ok(longBody.length > WORKBENCH_REWRITE_WINDOW_CHARS);
  assert.throws(
    () =>
      assertWorkbenchPlanRequest({
        instruction: '整体改写',
        startOffset: 0,
        endOffset: longBody.length,
        baseUpdatedAt: '2026-10-01T00:00:00.000Z',
        sourceText: longBody,
      }),
    /划小|单窗|范围过长/
  );
});

test('assertWorkbenchDraftRequest requires planText in from-plan mode and rejects multi-window ranges', () => {
  const base = {
    instruction: '按方案成稿',
    profile: 'sex',
    startOffset: 3,
    endOffset: 9,
    baseUpdatedAt: '2026-10-01T00:00:00.000Z',
    sourceText: '前文。范围内一句。后文。',
    mode: 'from-plan',
  };
  assert.throws(() => assertWorkbenchDraftRequest(base), /planText/);

  const normalized = assertWorkbenchDraftRequest({
    ...base,
    planText: '【改动账本】keep 前文；rewrite 中段。',
  });
  assert.equal(normalized.mode, 'from-plan');
  assert.equal(normalized.planText, '【改动账本】keep 前文；rewrite 中段。');

  const legacy = assertWorkbenchDraftRequest({ ...LEGACY_DRAFT_INPUT });
  assert.equal(legacy.mode, 'direct');
  assert.equal(legacy.planText, undefined);

  const longBody = '句。'.repeat(Math.ceil(WORKBENCH_REWRITE_WINDOW_CHARS / 2) + 10);
  assert.throws(
    () =>
      assertWorkbenchDraftRequest({
        ...base,
        planText: '方案',
        startOffset: 0,
        endOffset: longBody.length,
        sourceText: longBody,
      }),
    /划小|单窗|范围过长/
  );
});

test('buildWorkbenchPlanUserPrompt asks for a four-part scene plan only', () => {
  const prompt = buildWorkbenchPlanUserPrompt({
    chapterNo: 3,
    title: '雨夜',
    instruction: '把过场压掉，加一拍争执，散场锁在门口。',
    rangeText: '范围内一句。',
    beforeContext: '前文。',
    afterContext: '后文。',
    appearingCharacters: ['阿青', '老陈'],
  });
  assert.match(prompt, /入场|散场/);
  assert.match(prompt, /改动账本|keep|rewrite|expand|delete/);
  assert.match(prompt, /篇幅|字数/);
  assert.match(prompt, /边界|范围外/);
  assert.match(prompt, /只输出方案|不要输出正文|方案/);
  assert.match(prompt, /阿青、老陈/);
  assert.ok(prompt.includes('范围内一句。'));
  assert.ok(!prompt.includes('后文。后文。'));
});

test('buildWorkbenchSceneDraftUserPrompt carries the confirmed plan and locks the closing state', () => {
  const prompt = buildWorkbenchSceneDraftUserPrompt({
    chapterNo: 3,
    title: '雨夜',
    instruction: '把过场压掉，加一拍争执，散场锁在门口。',
    planText: '【散场状态】两人停在门口，钥匙仍在外套口袋。',
    rangeText: '范围内一句。',
    beforeContext: '前文。',
    afterContext: '后文。',
  });
  assert.ok(prompt.includes('【散场状态】两人停在门口，钥匙仍在外套口袋。'));
  assert.match(prompt, /散场状态/);
  assert.match(prompt, /锁定|不得改变|保持一致/);
  assert.ok(prompt.includes('范围内一句。'));
  assert.doesNotMatch(prompt, /账本|举证|准入|验收/);
});
