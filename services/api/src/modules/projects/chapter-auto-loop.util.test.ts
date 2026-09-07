import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTO_LOOP_ROUND_DEFAULT,
  AUTO_LOOP_ROUND_MAX,
  AUTO_LOOP_ROUND_MIN,
  CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
  CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
  applyParagraphReplacements,
  buildAutoLoopPlanUserPrompt,
  buildAutoLoopSegmentUserPrompt,
  clampAutoLoopRoundBudget,
  formatAutoLoopPersonaBlock,
  joinIndexedParagraphs,
  resolveAutoLoopSegmentMaxTokens,
  parseAutoLoopPlanItems,
  renderIndexedParagraphs,
  resolveAutoLoopHitCap,
  resolveItemAnchor,
  selectAutoLoopTargets,
  shouldContinueAutoLoop,
  splitIndexedParagraphs,
  validateAutoLoopRound,
  validateAutoLoopSegment,
} from './chapter-auto-loop.util';
import type { ChapterAutoLoopItem } from './chapter-auto-loop.util';

function makeItem(overrides: Partial<ChapterAutoLoopItem> = {}): ChapterAutoLoopItem {
  return {
    id: 'i1',
    paragraphIndex: 1,
    anchorQuote: '锚点引文',
    severity: 'high',
    issue: '问题描述',
    instruction: '改写指令',
    status: 'pending',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 段落编号与无损拼回（切片一）
// ---------------------------------------------------------------------------

test('splitIndexedParagraphs 按空行切段并从 1 开始编号', () => {
  const indexed = splitIndexedParagraphs('第一段。\n\n第二段。\n\n第三段。');
  assert.equal(indexed.paragraphs.length, 3);
  assert.deepEqual(
    indexed.paragraphs.map((item) => item.index),
    [1, 2, 3]
  );
  assert.equal(indexed.paragraphs[1].text, '第二段。');
});

test('splitIndexedParagraphs 不把段内单换行当作段落边界', () => {
  const indexed = splitIndexedParagraphs('上句。\n下句。\n\n第二段。');
  assert.equal(indexed.paragraphs.length, 2);
  assert.equal(indexed.paragraphs[0].text, '上句。\n下句。');
});

test('joinIndexedParagraphs 在无替换时逐字节还原原文', () => {
  const source = '\n\n  第一段。\n\n\n第二段。\n中间换行。\n\n第三段。\n\n';
  const indexed = splitIndexedParagraphs(source);
  assert.equal(joinIndexedParagraphs(indexed), source);
});

test('joinIndexedParagraphs 还原含 CRLF 与多余空行的原文', () => {
  const source = '第一段。\r\n\r\n第二段。\r\n\r\n\r\n第三段。';
  const indexed = splitIndexedParagraphs(source);
  assert.equal(joinIndexedParagraphs(indexed), source);
});

test('applyParagraphReplacements 只改命中段落，其余逐字节相同', () => {
  const source = '第一段。\n\n第二段。\n\n第三段。\n\n第四段。';
  const indexed = splitIndexedParagraphs(source);
  const merged = applyParagraphReplacements(indexed, [
    { paragraphIndex: 2, text: '改写后的第二段。' },
  ]);
  assert.equal(merged, '第一段。\n\n改写后的第二段。\n\n第三段。\n\n第四段。');
});

test('applyParagraphReplacements 允许单个槽位吐出多段', () => {
  const source = '第一段。\n\n很长的第二段。\n\n第三段。';
  const indexed = splitIndexedParagraphs(source);
  const merged = applyParagraphReplacements(indexed, [
    { paragraphIndex: 2, text: '对白部分。\n\n动作部分。' },
  ]);
  assert.equal(merged, '第一段。\n\n对白部分。\n\n动作部分。\n\n第三段。');
});

test('applyParagraphReplacements 忽略越界与空替换', () => {
  const source = '第一段。\n\n第二段。';
  const indexed = splitIndexedParagraphs(source);
  const merged = applyParagraphReplacements(indexed, [
    { paragraphIndex: 9, text: '不存在的段落' },
    { paragraphIndex: 1, text: '   ' },
  ]);
  assert.equal(merged, source);
});

test('renderIndexedParagraphs 给每段打上可照抄的编号', () => {
  const indexed = splitIndexedParagraphs('第一段。\n\n第二段。');
  const rendered = renderIndexedParagraphs(indexed);
  assert.match(rendered, /\[1\]\s*第一段。/);
  assert.match(rendered, /\[2\]\s*第二段。/);
});

// ---------------------------------------------------------------------------
// 条目解析（切片一）
// ---------------------------------------------------------------------------

test('parseAutoLoopPlanItems 解析合法 JSON 条目', () => {
  const raw = JSON.stringify({
    items: [
      {
        id: 'r1',
        paragraphIndex: 3,
        anchorQuote: '他握紧了拳头',
        severity: 'high',
        issue: '动作描写空泛',
        instruction: '换成具体的身体细节',
      },
    ],
  });
  const parsed = parseAutoLoopPlanItems(raw);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.discardedCount, 0);
  assert.equal(parsed.items[0].paragraphIndex, 3);
  assert.equal(parsed.items[0].severity, 'high');
  assert.equal(parsed.items[0].status, 'pending');
});

test('parseAutoLoopPlanItems 剥离 Markdown 代码块包裹', () => {
  const raw =
    '```json\n{"items":[{"paragraphIndex":1,"anchorQuote":"引文内容","severity":"medium","instruction":"改写"}]}\n```';
  const parsed = parseAutoLoopPlanItems(raw);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].severity, 'medium');
});

test('parseAutoLoopPlanItems 丢弃缺字段与非法 severity 并计数', () => {
  const raw = JSON.stringify({
    items: [
      { paragraphIndex: 1, anchorQuote: '合法引文', severity: 'high', instruction: '改写' },
      { paragraphIndex: 0, anchorQuote: '编号非法', severity: 'high', instruction: '改写' },
      { paragraphIndex: 2, anchorQuote: '', severity: 'high', instruction: '改写' },
      { paragraphIndex: 3, anchorQuote: '引文', severity: 'urgent', instruction: '改写' },
      { paragraphIndex: 4, anchorQuote: '引文', severity: 'low', instruction: '   ' },
    ],
  });
  const parsed = parseAutoLoopPlanItems(raw);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.discardedCount, 4);
});

test('parseAutoLoopPlanItems 对非 JSON 输出返回空条目而不抛错', () => {
  const parsed = parseAutoLoopPlanItems('这一章写得很好，没有需要修改的地方。');
  assert.equal(parsed.items.length, 0);
  assert.equal(parsed.parseFailed, true);
});

test('parseAutoLoopPlanItems 为缺 id 的条目补稳定 id', () => {
  const raw = JSON.stringify({
    items: [
      { paragraphIndex: 1, anchorQuote: '引文一', severity: 'high', instruction: '改写一' },
      { paragraphIndex: 2, anchorQuote: '引文二', severity: 'low', instruction: '改写二' },
    ],
  });
  const parsed = parseAutoLoopPlanItems(raw);
  assert.deepEqual(
    parsed.items.map((item) => item.id),
    ['item-1', 'item-2']
  );
});

// ---------------------------------------------------------------------------
// 定位双保险与两级降级（切片二）
// ---------------------------------------------------------------------------

test('resolveItemAnchor 编号命中时直接采用该段', () => {
  const indexed = splitIndexedParagraphs(
    '第一段内容。\n\n他握紧了拳头，转身离开。\n\n第三段内容。'
  );
  const outcome = resolveItemAnchor({
    item: makeItem({ paragraphIndex: 2, anchorQuote: '他握紧了拳头' }),
    paragraphs: indexed.paragraphs,
  });
  assert.equal(outcome.outcome, 'exact');
  assert.equal(outcome.resolvedParagraphIndex, 2);
});

test('resolveItemAnchor 用引文救回错误编号', () => {
  const indexed = splitIndexedParagraphs(
    ['第一段。', '第二段。', '第三段。', '第四段。', '他握紧了拳头，转身离开。'].join('\n\n')
  );
  const outcome = resolveItemAnchor({
    item: makeItem({ paragraphIndex: 2, anchorQuote: '他握紧了拳头' }),
    paragraphs: indexed.paragraphs,
  });
  assert.equal(outcome.outcome, 'relocated');
  assert.equal(outcome.resolvedParagraphIndex, 5);
});

test('resolveItemAnchor 忽略标点与空白差异后仍能救回', () => {
  const indexed = splitIndexedParagraphs('第一段。\n\n他，握紧了拳头；转身离开。');
  const outcome = resolveItemAnchor({
    item: makeItem({ paragraphIndex: 1, anchorQuote: '他握紧了拳头 转身离开' }),
    paragraphs: indexed.paragraphs,
  });
  assert.equal(outcome.outcome, 'relocated');
  assert.equal(outcome.resolvedParagraphIndex, 2);
});

test('resolveItemAnchor 引文零命中时判为无法定位', () => {
  const indexed = splitIndexedParagraphs('第一段。\n\n第二段。');
  const outcome = resolveItemAnchor({
    item: makeItem({ paragraphIndex: 5, anchorQuote: '完全不存在的一句引文内容' }),
    paragraphs: indexed.paragraphs,
  });
  assert.equal(outcome.outcome, 'unlocatable');
  assert.equal(outcome.resolvedParagraphIndex, null);
});

test('resolveItemAnchor 引文命中多段时判为无法定位', () => {
  const indexed = splitIndexedParagraphs(
    '他握紧了拳头，看向窗外。\n\n第二段。\n\n他握紧了拳头，深吸一口气。'
  );
  const outcome = resolveItemAnchor({
    item: makeItem({ paragraphIndex: 2, anchorQuote: '他握紧了拳头' }),
    paragraphs: indexed.paragraphs,
  });
  assert.equal(outcome.outcome, 'unlocatable');
});

test('resolveItemAnchor 对过短引文不做模糊挽救', () => {
  const indexed = splitIndexedParagraphs('第一段。\n\n他走了。');
  const outcome = resolveItemAnchor({
    item: makeItem({ paragraphIndex: 9, anchorQuote: '他' }),
    paragraphs: indexed.paragraphs,
  });
  assert.equal(outcome.outcome, 'unlocatable');
});

// ---------------------------------------------------------------------------
// 命中上限与合并（切片四）
// ---------------------------------------------------------------------------

test('resolveAutoLoopHitCap 在小章节仍允许至少 3 段', () => {
  assert.equal(resolveAutoLoopHitCap(1), 3);
  assert.equal(resolveAutoLoopHitCap(4), 3);
});

test('resolveAutoLoopHitCap 按 35% 放大且不超过 12', () => {
  assert.equal(resolveAutoLoopHitCap(20), 7);
  assert.equal(resolveAutoLoopHitCap(200), 12);
});

test('selectAutoLoopTargets 在 10 段 9 条时截断到上限并标 deferred', () => {
  const indexed = splitIndexedParagraphs(
    Array.from({ length: 10 }, (_, i) => `第 ${i + 1} 段的内容文字。`).join('\n\n')
  );
  const items = Array.from({ length: 9 }, (_, i) =>
    makeItem({
      id: `i${i + 1}`,
      paragraphIndex: i + 1,
      anchorQuote: `第 ${i + 1} 段的内容文字`,
      severity: i < 2 ? 'high' : 'low',
    })
  );
  const result = selectAutoLoopTargets({ items, paragraphs: indexed.paragraphs });
  assert.equal(result.targets.length, 3);
  assert.equal(result.deferred.length, 6);
  // 高严重度优先入选
  const selectedIndexes = result.targets.map((target) => target.paragraphIndex);
  assert.ok(selectedIndexes.includes(1));
  assert.ok(selectedIndexes.includes(2));
  assert.ok(result.deferred.every((item) => item.status === 'deferred'));
});

test('selectAutoLoopTargets 把同段多条合并为一次改写', () => {
  const indexed = splitIndexedParagraphs('第一段的内容文字。\n\n第二段的内容文字。');
  const items = [
    makeItem({
      id: 'a',
      paragraphIndex: 2,
      anchorQuote: '第二段的内容文字',
      instruction: '指令甲',
    }),
    makeItem({
      id: 'b',
      paragraphIndex: 2,
      anchorQuote: '第二段的内容文字',
      instruction: '指令乙',
    }),
  ];
  const result = selectAutoLoopTargets({ items, paragraphs: indexed.paragraphs });
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].paragraphIndex, 2);
  assert.equal(result.targets[0].items.length, 2);
});

test('selectAutoLoopTargets 把无法定位的条目单独归类且不占用上限', () => {
  const indexed = splitIndexedParagraphs('第一段的内容文字。\n\n第二段的内容文字。');
  const items = [
    makeItem({ id: 'ok', paragraphIndex: 1, anchorQuote: '第一段的内容文字' }),
    makeItem({ id: 'bad', paragraphIndex: 7, anchorQuote: '压根不存在的引文内容片段' }),
  ];
  const result = selectAutoLoopTargets({ items, paragraphs: indexed.paragraphs });
  assert.equal(result.targets.length, 1);
  assert.equal(result.unlocatable.length, 1);
  assert.equal(result.unlocatable[0].status, 'skipped_unlocatable');
});

test('selectAutoLoopTargets 保留被引文救回的条目并标 relocated', () => {
  const indexed = splitIndexedParagraphs('第一段的内容文字。\n\n他握紧了拳头，转身离开。');
  const items = [makeItem({ paragraphIndex: 1, anchorQuote: '他握紧了拳头，转身离开' })];
  const result = selectAutoLoopTargets({ items, paragraphs: indexed.paragraphs });
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].paragraphIndex, 2);
  assert.equal(result.targets[0].items[0].status, 'relocated');
});

// ---------------------------------------------------------------------------
// 分层闸门（切片三）
// ---------------------------------------------------------------------------

test('validateAutoLoopSegment 接受合理改写', () => {
  const result = validateAutoLoopSegment({
    originalText: '他握紧了拳头，转身离开。',
    replacementText: '他的指节泛白，转身走进雨里。',
  });
  assert.equal(result.ok, true);
});

test('validateAutoLoopSegment 拒收说明性开头', () => {
  const result = validateAutoLoopSegment({
    originalText: '他握紧了拳头，转身离开。',
    replacementText: '以下是修改后的段落：他的指节泛白，转身走进雨里。',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /说明/);
});

test('validateAutoLoopSegment 拒收 Markdown 包裹', () => {
  const result = validateAutoLoopSegment({
    originalText: '他握紧了拳头，转身离开。',
    replacementText: '```\n他的指节泛白，转身走进雨里。\n```',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /Markdown/);
});

test('validateAutoLoopSegment 拒收占位语', () => {
  const result = validateAutoLoopSegment({
    originalText: '他握紧了拳头，转身离开，走进了那场大雨里面。',
    replacementText: '他的指节泛白（此处省略）转身走进雨里面对着风。',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /占位语/);
});

test('validateAutoLoopSegment 拒收过短与过长替换', () => {
  const originalText = '他握紧了拳头，转身离开，走进了那场大雨里。';
  const tooShort = validateAutoLoopSegment({ originalText, replacementText: '他走了。' });
  assert.equal(tooShort.ok, false);
  assert.match(tooShort.reason ?? '', /过短/);

  const tooLong = validateAutoLoopSegment({
    originalText,
    replacementText: '他握紧了拳头。'.repeat(30),
  });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.reason ?? '', /过长/);
});

test('validateAutoLoopSegment 拒收空替换', () => {
  const result = validateAutoLoopSegment({
    originalText: '他握紧了拳头，转身离开。',
    replacementText: '   \n  ',
  });
  assert.equal(result.ok, false);
});

test('validateAutoLoopRound 接受带宽内的成稿', () => {
  const stored = '原文内容。'.repeat(100);
  const result = validateAutoLoopRound({
    storedContent: stored,
    roundDraft: '改写内容。'.repeat(105),
    instruction: '让文笔更细腻',
  });
  assert.equal(result.ok, true);
});

test('validateAutoLoopRound 以入库原文为基准判定累积漂移越界', () => {
  const stored = '原文内容。'.repeat(100);
  // 两轮各涨 20%，相对上一轮都"合规"，但相对入库原文已达 144%
  const roundTwo = '改写内容。'.repeat(144);
  const againstPrevious = validateAutoLoopRound({
    storedContent: '原文内容。'.repeat(120),
    roundDraft: roundTwo,
    instruction: '让文笔更细腻',
  });
  assert.equal(againstPrevious.ok, true, '相对上一轮应当通过，用于对照');

  const againstStored = validateAutoLoopRound({
    storedContent: stored,
    roundDraft: '改写内容。'.repeat(160),
    instruction: '让文笔更细腻',
  });
  assert.equal(againstStored.ok, false);
  assert.match(againstStored.reason ?? '', /上限/);
});

test('validateAutoLoopRound 在要求允许删减时放宽下限', () => {
  const stored = '原文内容。'.repeat(100);
  const strict = validateAutoLoopRound({
    storedContent: stored,
    roundDraft: '改写内容。'.repeat(70),
    instruction: '让文笔更细腻',
  });
  assert.equal(strict.ok, false);

  const relaxed = validateAutoLoopRound({
    storedContent: stored,
    roundDraft: '改写内容。'.repeat(70),
    instruction: '大幅删减冗余描写',
  });
  assert.equal(relaxed.ok, true);
});

// ---------------------------------------------------------------------------
// 收敛与轮数（切片四）
// ---------------------------------------------------------------------------

test('clampAutoLoopRoundBudget 归一化轮数上限', () => {
  assert.equal(clampAutoLoopRoundBudget(undefined), AUTO_LOOP_ROUND_DEFAULT);
  assert.equal(clampAutoLoopRoundBudget(0), AUTO_LOOP_ROUND_MIN);
  assert.equal(clampAutoLoopRoundBudget(99), AUTO_LOOP_ROUND_MAX);
  assert.equal(clampAutoLoopRoundBudget('2'), 2);
  assert.equal(clampAutoLoopRoundBudget(Number.NaN), AUTO_LOOP_ROUND_DEFAULT);
});

test('shouldContinueAutoLoop 在无 high 条目时提前收敛', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 2,
    roundBudget: 3,
    items: [makeItem({ severity: 'medium' }), makeItem({ severity: 'low' })],
  });
  assert.equal(decision.shouldContinue, false);
  assert.equal(decision.converged, true);
});

test('shouldContinueAutoLoop 在到达轮数上限时停止且不算收敛', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 2,
    roundBudget: 2,
    items: [makeItem({ severity: 'high' })],
  });
  assert.equal(decision.shouldContinue, false);
  assert.equal(decision.converged, false);
});

test('shouldContinueAutoLoop 在仍有 high 且未到上限时继续', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 1,
    roundBudget: 3,
    items: [makeItem({ severity: 'high' })],
  });
  assert.equal(decision.shouldContinue, true);
  assert.equal(decision.converged, false);
});

// ---------------------------------------------------------------------------
// 提示拼装
// ---------------------------------------------------------------------------

test('buildAutoLoopPlanUserPrompt 首轮不含上一轮条目区块', () => {
  const prompt = buildAutoLoopPlanUserPrompt({
    instruction: '让打斗更有临场感',
    chapterNo: 12,
    chapterTitle: '雨夜',
    indexedBody: '[1] 第一段。\n\n[2] 第二段。',
    roundIndex: 1,
    roundBudget: 2,
  });
  assert.match(prompt, /让打斗更有临场感/);
  assert.match(prompt, /\[1\] 第一段。/);
  assert.ok(!prompt.includes('<previous-items>'));
});

test('buildAutoLoopPlanUserPrompt 复诊时重申原始要求并带上一轮条目状态', () => {
  const prompt = buildAutoLoopPlanUserPrompt({
    instruction: '让打斗更有临场感',
    chapterNo: 12,
    chapterTitle: '雨夜',
    indexedBody: '[1] 第一段。',
    roundIndex: 2,
    roundBudget: 2,
    previousItems: [
      makeItem({ id: 'p1', instruction: '补足痛感', status: 'applied' }),
      makeItem({ id: 'p2', instruction: '删掉空泛比喻', status: 'skipped_unlocatable' }),
    ],
  });
  assert.match(prompt, /让打斗更有临场感/, '复诊仍须重申原始要求');
  assert.match(prompt, /<previous-items>/);
  assert.match(prompt, /补足痛感/);
  assert.match(prompt, /删掉空泛比喻/);
});

test('buildAutoLoopSegmentUserPrompt 带上下文邻段但禁止改写邻段', () => {
  const prompt = buildAutoLoopSegmentUserPrompt({
    instruction: '让打斗更有临场感',
    paragraphIndex: 2,
    originalParagraph: '他握紧了拳头。',
    previousParagraph: '雨下了一整夜。',
    nextParagraph: '门在身后合上。',
    items: [makeItem({ instruction: '补足痛感与呼吸' })],
  });
  assert.match(prompt, /他握紧了拳头。/);
  assert.match(prompt, /雨下了一整夜。/);
  assert.match(prompt, /门在身后合上。/);
  assert.match(prompt, /补足痛感与呼吸/);
  assert.match(prompt, /只输出|仅输出/, '须要求只输出目标段落');
});

test('task prompt key 使用 chapter.optimize 命名空间以复用现有分组', () => {
  assert.equal(CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY, 'chapter.optimize.loop.plan');
  assert.equal(CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY, 'chapter.optimize.loop.draft');
});

test('全部条目被丢弃时不得判定收敛——什么都没读懂不等于正文干净', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 1,
    roundBudget: 2,
    items: [],
    discardedCount: 11,
  });
  assert.equal(decision.converged, false, '11 条读不懂却报"未发现严重问题"是把失败当成功');
  assert.equal(decision.diagnosisComplete, false);
});

test('有丢弃但仍有存活条目时也不判收敛：被丢的那条可能才是 high', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 1,
    roundBudget: 2,
    items: [makeItem({ severity: 'low' })],
    discardedCount: 3,
  });
  assert.equal(decision.converged, false);
  assert.equal(decision.shouldContinue, true, '诊断不完整应继续用掉预算而非提前收工');
});

test('零丢弃且无 high 才是真收敛', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 1,
    roundBudget: 2,
    items: [makeItem({ severity: 'medium' })],
    discardedCount: 0,
  });
  assert.equal(decision.converged, true);
  assert.equal(decision.diagnosisComplete, true);
  assert.equal(decision.shouldContinue, false);
});

test('模型明说无问题（items 为空且零丢弃）仍算收敛', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 1,
    roundBudget: 3,
    items: [],
    discardedCount: 0,
  });
  assert.equal(decision.converged, true);
  assert.equal(decision.shouldContinue, false);
});

test('诊断不完整但已到轮数上限时停止且不算收敛', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 2,
    roundBudget: 2,
    items: [],
    discardedCount: 5,
  });
  assert.equal(decision.shouldContinue, false);
  assert.equal(decision.converged, false);
});

test('中文 severity 与常见字段别名被接纳而非丢弃', () => {
  const parsed = parseAutoLoopPlanItems(
    JSON.stringify({
      items: [
        { paragraphIndex: 2, anchorQuote: '他握紧了刀柄', severity: '严重', instruction: '写实' },
        { paragraphIndex: 3, quote: '雨下了一整夜', severity: '中', suggestion: '收紧节奏' },
        { paragraph: 4, anchorQuote: '门在身后合上', severity: 'LOW', instruction: '补足声音' },
      ],
    })
  );
  assert.equal(parsed.discardedCount, 0, '格式轻微跑偏不该让整轮诊断归零');
  assert.deepEqual(
    parsed.items.map((item) => [item.paragraphIndex, item.severity]),
    [
      [2, 'high'],
      [3, 'medium'],
      [4, 'low'],
    ]
  );
  assert.equal(parsed.items[1].instruction, '收紧节奏');
});

test('真正缺失定位信息的条目仍然被丢弃并计数', () => {
  const parsed = parseAutoLoopPlanItems(
    JSON.stringify({
      items: [
        {
          paragraphIndex: 2,
          anchorQuote: '有效引文内容',
          severity: 'high',
          instruction: '有效指令',
        },
        { anchorQuote: '缺编号', severity: 'high', instruction: '指令' },
        { paragraphIndex: 3, severity: 'high', instruction: '缺引文' },
        { paragraphIndex: 4, anchorQuote: '缺指令', severity: 'high' },
        {
          paragraphIndex: 5,
          anchorQuote: '无法识别的严重度',
          severity: '很急',
          instruction: '指令',
        },
      ],
    })
  );
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.discardedCount, 4);
  assert.equal(parsed.parseFailed, false);
});

test('段级 max_tokens 按原段长度定预算并夹在带宽内', () => {
  // 短段落不至于连一句都写不完
  assert.equal(resolveAutoLoopSegmentMaxTokens('短。'), 400);
  // 长段落不给整章额度，否则模型有空间越过段级 2.5 倍闸门
  assert.equal(resolveAutoLoopSegmentMaxTokens('字'.repeat(2000)), 2000);
  // 带宽之内按 4 token/字 估算
  assert.equal(resolveAutoLoopSegmentMaxTokens('字'.repeat(200)), 800);
});

test('人物卡按出场名单精确过滤', () => {
  const personas = [
    { name: '林昭', profile: '刀客', state: '重伤' },
    { name: '沈砚', profile: '书生', state: '健康' },
    { name: '路人甲', profile: '摊贩', state: '健康' },
  ];
  const block = formatAutoLoopPersonaBlock(personas, ['林昭', '沈砚']);
  assert.match(block, /林昭：刀客/);
  assert.match(block, /状态：重伤/);
  assert.match(block, /沈砚：书生/);
  assert.doesNotMatch(block, /路人甲/, '未出场人物不应进入 prompt');
});

test('无出场人物或全部匹配失败时返回空串而非空标题', () => {
  const personas = [{ name: '林昭', profile: '刀客', state: '重伤' }];
  assert.equal(formatAutoLoopPersonaBlock(personas, undefined), '');
  assert.equal(formatAutoLoopPersonaBlock(personas, []), '');
  assert.equal(formatAutoLoopPersonaBlock(personas, ['  ', '']), '');
  assert.equal(formatAutoLoopPersonaBlock(personas, ['不存在的人']), '');
});
