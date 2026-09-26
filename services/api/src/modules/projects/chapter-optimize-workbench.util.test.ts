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
  assertWorkbenchReviewRequest,
  buildWorkbenchDraftUserPrompt,
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
  assert.equal(locateUniqueAnchor('走廊里只剩脚步。', '囊袋拍打着她臀肉'), null);
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
    { kind: 'tension', instruction: '补体位' },
    { kind: 'regression', instruction: '再加深这段' },
    { kind: 'vocab', instruction: '写细水声' },
    { kind: 'regression', instruction: '补接吻再继续' },
    { kind: 'regression', instruction: '这段再更色一点' },
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
  const atEnd = sliceWorkbenchRangeNeighborhood(sourceText, sourceText.length - 3, sourceText.length);
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

test('prose draft prompt does not inject sex-thickening requirements', () => {
  const prompt = buildWorkbenchDraftUserPrompt({
    chapterNo: 2,
    title: '过场',
    instruction: '顺一下对白',
    profile: 'prose',
    rangeText: '两人走出浴室，走廊灯还亮着。',
  });
  assert.match(prompt, /日常文笔/);
  assert.match(prompt, /禁止按性爱加料要求/);
  assert.doesNotMatch(prompt, /加料、加深感官/);
});

test('parseWorkbenchReviewItems drops illegal kinds, additive instructions, and prose pose/vocab', () => {
  const raw = JSON.stringify({
    items: [
      {
        id: 'w1',
        kind: 'pose',
        severity: 'high',
        anchorQuote: '她抬起左腿环住他腰',
        issue: '体位穿帮',
        instruction: '改成背靠墙',
      },
      {
        kind: 'regression',
        anchorQuote: '囊袋拍打着她臀肉',
        issue: '当拍接触被删',
        instruction: '加深这段拍打',
      },
      {
        kind: 'tension',
        anchorQuote: '走廊灯还亮着',
        issue: '还能更色',
        instruction: '补接吻',
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
    () => assertWorkbenchFixSpanRequest({ spanText: '', instruction: '改拍会阴', profile: 'sex' }),
    /spanText/
  );
  assert.throws(
    () =>
      assertWorkbenchFixSpanRequest({
        spanText: '囊袋拍打着她臀肉',
        instruction: ' ',
        profile: 'sex',
      }),
    /instruction/
  );
  const parsed = assertWorkbenchFixSpanRequest({
    spanText: '囊袋拍打着她臀肉',
    instruction: '改为拍会阴',
    profile: 'sex',
    beforeContext: '前文',
    afterContext: '后文',
  });
  assert.equal(parsed.spanText, '囊袋拍打着她臀肉');
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
