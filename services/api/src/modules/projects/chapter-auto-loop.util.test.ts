import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTO_LOOP_ROUND_DEFAULT,
  AUTO_LOOP_ROUND_MAX,
  AUTO_LOOP_ROUND_MIN,
  CHAPTER_AUTO_LOOP_DRAFT_SYSTEM_PROMPT,
  CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
  CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT,
  CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
  applyParagraphReplacements,
  buildAutoLoopPlanUserPrompt,
  buildAutoLoopSegmentUserPrompt,
  carryDeferredItems,
  clampAutoLoopRoundBudget,
  expandMergeIntoNeighborItems,
  formatAutoLoopPersonaBlock,
  resolveAutoLoopPersonaNames,
  isDeleteOnlyTarget,
  isWholeParagraphDeletion,
  joinIndexedParagraphs,
  extractAutoLoopFollowingText,
  extractAutoLoopPrecedingText,
  extractAutoLoopWindowTail,
  splitAutoLoopCharWindows,
  stitchAutoLoopCharWindows,
  resolveAutoLoopSegmentMaxTokens,
  orderTargetsRewriteBeforeDelete,
  parseAutoLoopPlanItems,
  parseMergeIntoNeighborPair,
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

test('applyParagraphReplacements 抽槽后前后段直接衔接，不留空段', () => {
  const source = '龟头直直撞上花心。\n\n他窄腰加快了挺动的速率。\n\n每一次深入都撞得更重。';
  const indexed = splitIndexedParagraphs(source);
  const merged = applyParagraphReplacements(indexed, [
    { paragraphIndex: 2, text: '', deleteParagraph: true },
  ]);
  assert.equal(merged, '龟头直直撞上花心。\n\n每一次深入都撞得更重。');
  assert.ok(!merged.includes('他窄腰加快了挺动的速率。'));
});

test('applyParagraphReplacements 连续抽槽只保留一层分隔', () => {
  const source = '一段。\n\n二段。\n\n三段。\n\n四段。';
  const indexed = splitIndexedParagraphs(source);
  const merged = applyParagraphReplacements(indexed, [
    { paragraphIndex: 2, text: '', deleteParagraph: true },
    { paragraphIndex: 3, text: '', deleteParagraph: true },
  ]);
  assert.equal(merged, '一段。\n\n四段。');
});

test('splitAutoLoopCharWindows 字数为 0 时整章一窗且拼回原文', () => {
  const source = `${'甲'.repeat(4000)}\n\n${'乙'.repeat(4000)}`;
  const windows = splitAutoLoopCharWindows(source, {
    segmentCharSize: 0,
    singleSegmentThreshold: 2800,
  });
  assert.equal(windows.length, 1);
  assert.equal(stitchAutoLoopCharWindows(windows, []), source);
});

test('splitAutoLoopCharWindows 按剩余段落攒满预算，不腰斩，拼回原文', () => {
  const source = 'aaaa\n\nbbbb\n\ncccc\n\ndddd';
  const windows = splitAutoLoopCharWindows(source, {
    segmentCharSize: 8,
    singleSegmentThreshold: 0,
  });
  assert.equal(windows.length, 2);
  assert.equal(windows[0]?.text, 'aaaa\n\nbbbb');
  assert.equal(windows[1]?.text, 'cccc\n\ndddd');
  assert.equal(stitchAutoLoopCharWindows(windows, []), source);
  assert.ok(!windows[0]?.text.includes('cc'));
});

test('splitAutoLoopCharWindows 单段超过预算时整段单独成窗', () => {
  const long = 'x'.repeat(12);
  const source = `${long}\n\nshort`;
  const windows = splitAutoLoopCharWindows(source, {
    segmentCharSize: 8,
    singleSegmentThreshold: 0,
  });
  assert.equal(windows.length, 2);
  assert.equal(windows[0]?.text, long);
  assert.equal(windows[1]?.text, 'short');
  assert.equal(stitchAutoLoopCharWindows(windows, []), source);
});

test('extractAutoLoopWindowTail 取最后一段，超 400 字截末尾', () => {
  assert.equal(extractAutoLoopWindowTail('第一段。\n\n最后一段。'), '最后一段。');
  const long = `前段。\n\n${'尾'.repeat(500)}`;
  const tail = extractAutoLoopWindowTail(long, 400);
  assert.equal(tail.length, 400);
  assert.equal(tail, '尾'.repeat(400));
});

test('extractAutoLoopPrecedingText 从近到远攒前文，超预算截靠近目标的末尾', () => {
  const paragraphs = splitIndexedParagraphs('甲段内容。\n\n乙段内容。\n\n目标段。').paragraphs;
  assert.equal(extractAutoLoopPrecedingText(paragraphs, 3), '甲段内容。\n\n乙段内容。');
  assert.equal(extractAutoLoopPrecedingText(paragraphs, 3, 5), '乙段内容。'.slice(-5));
  assert.equal(extractAutoLoopPrecedingText(paragraphs, 1), '');
});

test('extractAutoLoopFollowingText 从近到远攒后文，首段超预算截开头', () => {
  const paragraphs = splitIndexedParagraphs('目标段。\n\n丙段内容。\n\n丁段内容。').paragraphs;
  assert.equal(extractAutoLoopFollowingText(paragraphs, 1), '丙段内容。\n\n丁段内容。');
  assert.equal(extractAutoLoopFollowingText(paragraphs, 1, 4), '丙段内容。'.slice(0, 4));
  assert.equal(extractAutoLoopFollowingText(paragraphs, 3), '');
});

test('splitAutoLoopCharWindows 未过单段阈值时整章一窗', () => {
  const source = `${'短'.repeat(100)}\n\n${'也短'.repeat(50)}`;
  const windows = splitAutoLoopCharWindows(source, {
    segmentCharSize: 50,
    singleSegmentThreshold: 2800,
  });
  assert.equal(windows.length, 1);
  assert.equal(stitchAutoLoopCharWindows(windows, []), source);
});

test('splitAutoLoopCharWindows 约 20000 / 5000 切出四窗且不腰斩', () => {
  const parts = ['甲', '乙', '丙', '丁'].map((ch) => ch.repeat(5000));
  const source = parts.join('\n\n');
  const windows = splitAutoLoopCharWindows(source, {
    segmentCharSize: 5000,
    singleSegmentThreshold: 2800,
  });
  assert.equal(windows.length, 4);
  windows.forEach((window, index) => {
    assert.equal(window.text, parts[index]);
    assert.ok(!window.text.includes(parts[(index + 1) % 4]?.slice(0, 8) ?? 'never'));
  });
  assert.equal(stitchAutoLoopCharWindows(windows, []), source);
});

test('isWholeParagraphDeletion 只认整段/整句删除，不认句内删词', () => {
  assert.equal(
    isWholeParagraphDeletion('删除[183]整句“他窄腰加快了挺动的速率。”，使[182]结尾直接衔接[184]。'),
    true
  );
  assert.equal(isWholeParagraphDeletion('删除此句，使前后段衔接'), true);
  assert.equal(isWholeParagraphDeletion('整段删除这句机械过渡'), true);
  assert.equal(isWholeParagraphDeletion('删除第36段整段。', 36), true);
  assert.equal(isWholeParagraphDeletion('删除第36段。', 36), true);
  assert.equal(isWholeParagraphDeletion('删除第36段整段。', 35), false);
  assert.equal(isWholeParagraphDeletion('删除第36段里的成语', 36), false);
  assert.equal(isWholeParagraphDeletion('删除这句里的成语'), false);
  assert.equal(isWholeParagraphDeletion('删除此句中的「加快」'), false);
  assert.equal(isWholeParagraphDeletion('换成更具体的身体细节与呼吸节奏'), false);
});

const MERGE_118_INTO_117 =
  "将118段与117段合并，删除'温热的，细腻的，像最上等的丝绸。'整句，117段保留'指尖碰到她大腿内侧的皮肤，温软滑腻，带着体温的暖意从指腹传来'即可，不再追加比喻。";

test('将源段与邻段合并时只抽源段，不抽保留段', () => {
  assert.equal(isWholeParagraphDeletion(MERGE_118_INTO_117, 118), true);
  assert.equal(isWholeParagraphDeletion(MERGE_118_INTO_117, 117), false);
  assert.equal(isWholeParagraphDeletion('把第3段合并到第2段', 3), true);
  assert.equal(isWholeParagraphDeletion('把第3段合并到第2段', 2), false);
  assert.equal(isWholeParagraphDeletion('把本段并入上一段'), true);
  assert.equal(isWholeParagraphDeletion('删除这句里的成语，不要与邻段合并', 5), false);
});

test('isDeleteOnlyTarget 同段混有改写指令时不抽槽', () => {
  assert.equal(isDeleteOnlyTarget([{ instruction: '删除整段过渡句' }]), true);
  assert.equal(isDeleteOnlyTarget([{ instruction: MERGE_118_INTO_117 }], 118), true);
  assert.equal(isDeleteOnlyTarget([{ instruction: MERGE_118_INTO_117 }], 117), false);
  assert.equal(
    isDeleteOnlyTarget([{ instruction: '删除整句' }, { instruction: '补上呼吸与痛感' }]),
    false
  );
});

test('parseMergeIntoNeighborPair 识别删除并整合进邻段', () => {
  const pair = parseMergeIntoNeighborPair(
    '删除[313]整句，使[312]直接衔接[314]。将龟头抵住花心等细节整合进[312]段。'
  );
  assert.deepEqual(pair, { sourceIndex: 313, keeperIndex: 312 });
  assert.deepEqual(parseMergeIntoNeighborPair('把第3段合并到第2段'), {
    sourceIndex: 3,
    keeperIndex: 2,
  });
});

test('expandMergeIntoNeighborItems 拆成保留段改写 + 源段删除', () => {
  const indexed = splitIndexedParagraphs('保留段正文足够长。\n\n源段正文也足够长。\n\n下一段。');
  const items = [
    makeItem({
      id: 'm1',
      paragraphIndex: 2,
      anchorQuote: '源段正文也足够长',
      instruction: '删除[2]整句，使[1]直接衔接[3]。将源段细节整合进[1]段。',
    }),
  ];
  const expanded = expandMergeIntoNeighborItems(items, indexed.paragraphs);
  assert.equal(expanded.length, 2);
  assert.equal(expanded[0].paragraphIndex, 1);
  assert.ok(expanded[0].id.endsWith('#keeper'));
  assert.equal(expanded[1].paragraphIndex, 2);
  assert.ok(expanded[1].id.endsWith('#delete'));
  assert.equal(isDeleteOnlyTarget([expanded[0]], 1), false);
  assert.equal(isDeleteOnlyTarget([expanded[1]], 2), true);
});

test('selectAutoLoopTargets 对合并指令先改写后删除', () => {
  const indexed = splitIndexedParagraphs('保留段正文足够长。\n\n源段正文也足够长。\n\n下一段。');
  const result = selectAutoLoopTargets({
    items: [
      makeItem({
        id: 'm1',
        paragraphIndex: 2,
        anchorQuote: '源段正文也足够长',
        severity: 'high',
        instruction: '删除[2]整句，将细节整合进[1]段。',
      }),
    ],
    paragraphs: indexed.paragraphs,
  });
  assert.equal(result.targets.length, 2);
  assert.equal(result.targets[0].paragraphIndex, 1);
  assert.equal(isDeleteOnlyTarget(result.targets[0].items, 1), false);
  assert.equal(result.targets[1].paragraphIndex, 2);
  assert.equal(isDeleteOnlyTarget(result.targets[1].items, 2), true);
  assert.equal(result.targets[1].deleteAfterRewriteIndex, 1);
  const ordered = orderTargetsRewriteBeforeDelete(result.targets);
  assert.deepEqual(
    ordered.map((target) => target.paragraphIndex),
    [1, 2]
  );
});

test('carryDeferredItems 把上一轮顺延条目标成待处理', () => {
  const carried = carryDeferredItems([
    makeItem({ id: 'd1', status: 'deferred', instruction: '补痛感' }),
    makeItem({ id: 'a1', status: 'applied', instruction: '已改' }),
  ]);
  assert.equal(carried.length, 1);
  assert.equal(carried[0].id, 'carry:d1');
  assert.equal(carried[0].status, 'pending');
});

test('selectAutoLoopTargets 优先保留 preferItemIds（顺延）', () => {
  const indexed = splitIndexedParagraphs(
    Array.from({ length: 10 }, (_, i) => `第 ${i + 1} 段的内容文字。`).join('\n\n')
  );
  const deferred = makeItem({
    id: 'carry:old',
    paragraphIndex: 9,
    anchorQuote: '第 9 段的内容文字',
    severity: 'low',
  });
  const fresh = Array.from({ length: 8 }, (_, i) =>
    makeItem({
      id: `n${i + 1}`,
      paragraphIndex: i + 1,
      anchorQuote: `第 ${i + 1} 段的内容文字`,
      severity: 'high',
    })
  );
  const result = selectAutoLoopTargets({
    items: [deferred, ...fresh],
    paragraphs: indexed.paragraphs,
    preferItemIds: new Set(['carry:old']),
  });
  assert.equal(result.targets.length, 3);
  assert.ok(
    result.targets.some((target) => target.paragraphIndex === 9),
    '顺延段即使 severity 低也应挤进本轮'
  );
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
  assert.equal(parsed.items.length, 2, '未知 severity 应救回而不是丢条');
  assert.equal(parsed.discardedCount, 3);
});

test('parseAutoLoopPlanItems 对非 JSON 输出返回空条目而不抛错', () => {
  const parsed = parseAutoLoopPlanItems('这一章写得很好，没有需要修改的地方。');
  assert.equal(parsed.items.length, 0);
  assert.equal(parsed.parseFailed, true);
});

test('parseAutoLoopPlanItems 容忍说明文字包裹、尾逗号和智能引号', () => {
  const raw = [
    '以下是本轮复诊结果：',
    '{“items”:[',
    '{"paragraphIndex":2,"anchorQuote":"他握紧了拳头走过去","severity":"high","instruction":"写实",},',
    ']}',
    '以上。',
  ].join('\n');
  const parsed = parseAutoLoopPlanItems(raw);
  assert.equal(parsed.parseFailed, false);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].paragraphIndex, 2);
});

test('parseAutoLoopPlanItems 不得把字符串里的中文弯引号当成 JSON 定界符', () => {
  const raw = [
    '```json',
    '{',
    '  "items": [',
    '    {',
    '      "id": "r1",',
    '      "paragraphIndex": 123,',
    '      "anchorQuote": "指尖在发抖。整个人像被电了一下",',
    '      "severity": "high",',
    '      "issue": "电流比喻",',
    '      "instruction": "删除“像被电了一下”这一电流比喻，改为具体的触觉反馈"',
    '    }',
    '  ]',
    '}',
    '```',
  ].join('\n');
  const parsed = parseAutoLoopPlanItems(raw);
  assert.equal(parsed.parseFailed, false, '合法 JSON 含中文引号时不得整轮判死');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].paragraphIndex, 123);
  assert.match(parsed.items[0].instruction, /像被电了一下/);
});

test('parseAutoLoopPlanItems 从被截断的 JSON 里捞出完整条目，而不是整轮判死', () => {
  const raw =
    '{"items":[{"paragraphIndex":1,"anchorQuote":"他握紧了拳头走过去","severity":"high","instruction":"补足痛感"},{"paragraphIndex":2,"anchorQuote":"雨下了一整夜没有停","severity":"medium","instruction":"收';
  const parsed = parseAutoLoopPlanItems(raw);
  assert.equal(parsed.parseFailed, false, '截断不该让整轮诊断归零');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].paragraphIndex, 1);
});

test('parseAutoLoopPlanItems 救回漏掉收尾引号的 id，整份条目仍可用', () => {
  const raw = JSON.stringify({
    items: [
      {
        id: 'r1',
        paragraphIndex: 1,
        anchorQuote: '雨下了一整夜',
        severity: 'high',
        issue: '氛围空',
        instruction: '补雨声与湿冷',
      },
      {
        id: 'r2',
        paragraphIndex: 2,
        anchorQuote: '他握紧了拳头',
        severity: 'high',
        issue: '动作空泛',
        instruction: '写实指节与呼吸',
      },
    ],
  }).replace('"id":"r2"', '"id":"r2');
  assert.match(raw, /"id":"r2,"paragraphIndex"/, '夹具必须复现漏引号');
  const parsed = parseAutoLoopPlanItems(raw);
  assert.equal(parsed.parseFailed, false, '单条 id 漏引号不得整轮判死');
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(
    parsed.items.map((item) => item.paragraphIndex),
    [1, 2]
  );
});

test('parseAutoLoopPlanItems 外层解不开时仍按单条捞出合法条目', () => {
  const raw =
    '{"items":[{"id":"r1","paragraphIndex":1,"anchorQuote":"雨下了一整夜","severity":"high","instruction":"补雨声"},{"id":"r2","paragraphIndex":2,"anchorQuote":"他握紧了拳头","severity":"high","instruction":"写实","broken":}]}';
  const parsed = parseAutoLoopPlanItems(raw);
  assert.equal(parsed.parseFailed, false, '外层脏 JSON 仍应拆出能读的条目');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].paragraphIndex, 1);
});

test('parseAutoLoopPlanItems 救回编号别名、缺 severity、用 issue 顶 instruction', () => {
  const parsed = parseAutoLoopPlanItems(
    JSON.stringify({
      items: [
        {
          paragraphIndex: '第3段',
          anchorQuote: '他握紧了刀柄没有松开',
          instruction: '写实',
        },
        {
          paragraphIndex: 4,
          excerpt: '门在身后合上发出闷响',
          issue: '收束太空',
          severity: 'high',
        },
      ],
    })
  );
  assert.equal(parsed.discardedCount, 0);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].paragraphIndex, 3);
  assert.equal(parsed.items[0].severity, 'medium', '缺 severity 时按 medium 救回，不丢条');
  assert.equal(parsed.items[1].instruction, '收束太空');
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

test('selectAutoLoopTargets 最后一轮不截断，消化全部可定位条目', () => {
  const indexed = splitIndexedParagraphs(
    Array.from({ length: 10 }, (_, i) => `第 ${i + 1} 段的内容文字。`).join('\n\n')
  );
  const items = Array.from({ length: 9 }, (_, i) =>
    makeItem({
      id: `i${i + 1}`,
      paragraphIndex: i + 1,
      anchorQuote: `第 ${i + 1} 段的内容文字`,
      severity: 'high',
    })
  );
  const result = selectAutoLoopTargets({
    items,
    paragraphs: indexed.paragraphs,
    unlimitedHits: true,
  });
  assert.equal(result.targets.length, 9);
  assert.equal(result.deferred.length, 0);
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

test('validateAutoLoopSegment 不因扩写或收紧拒收——字数限制会挡住用户要求', () => {
  const originalText = '他握紧了拳头，转身离开。';
  const expanded = validateAutoLoopSegment({
    originalText,
    replacementText:
      '他握紧了拳头，指节泛白，雨水顺着刀背往下滴，转身走进那场下了一整夜的雨里。'.repeat(4),
  });
  assert.equal(expanded.ok, true, '65 字扩到 195 这种扩写必须通过');

  const tightened = validateAutoLoopSegment({
    originalText,
    replacementText: '他走了。',
  });
  assert.equal(tightened.ok, true);
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
  });
  assert.equal(result.ok, true);
});

test('validateAutoLoopRound 接受相对入库原文的扩写，不再按 150% 封顶', () => {
  const stored = '原文内容。'.repeat(100);
  const expanded = validateAutoLoopRound({
    storedContent: stored,
    roundDraft: '改写内容。'.repeat(200),
  });
  assert.equal(expanded.ok, true, '扩写到 200% 必须通过，否则用户要求被闸门挡掉');
});

test('validateAutoLoopRound 不再按字数下限裁决删减幅度', () => {
  const stored = '原文内容。'.repeat(100);
  for (const repeat of [85, 75, 70, 40]) {
    const result = validateAutoLoopRound({
      storedContent: stored,
      roundDraft: '改写内容。'.repeat(repeat),
    });
    assert.equal(result.ok, true, `${repeat}% 的成稿属于合法删减，系统不得拦截`);
  }
});

test('validateAutoLoopRound 仍拦截疑似正文丢失的成稿', () => {
  const stored = '原文内容。'.repeat(100);
  const collapsed = validateAutoLoopRound({
    storedContent: stored,
    roundDraft: '改写内容。'.repeat(10),
  });
  assert.equal(collapsed.ok, false);
  assert.match(collapsed.reason ?? '', /正文丢失/);
});

// ---------------------------------------------------------------------------
// 收敛与轮数（切片四）
// ---------------------------------------------------------------------------

test('clampAutoLoopRoundBudget 归一化轮数上限', () => {
  assert.equal(clampAutoLoopRoundBudget(undefined), AUTO_LOOP_ROUND_DEFAULT);
  assert.equal(clampAutoLoopRoundBudget(0), AUTO_LOOP_ROUND_MIN);
  assert.equal(clampAutoLoopRoundBudget(5), AUTO_LOOP_ROUND_MAX);
  assert.equal(clampAutoLoopRoundBudget(99), AUTO_LOOP_ROUND_MAX);
  assert.equal(clampAutoLoopRoundBudget('2'), 2);
  assert.equal(clampAutoLoopRoundBudget(Number.NaN), AUTO_LOOP_ROUND_DEFAULT);
});

test('shouldContinueAutoLoop 在仅剩轻微问题时提前收敛', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 2,
    roundBudget: 3,
    items: [makeItem({ severity: 'low' })],
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

test('shouldContinueAutoLoop 仅 medium/low 不再续跑，避免一直润色', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 1,
    roundBudget: 3,
    items: [makeItem({ severity: 'medium' }), makeItem({ severity: 'low' })],
    discardedCount: 0,
    appliedCount: 0,
  });
  assert.equal(decision.shouldContinue, false);
  assert.equal(decision.converged, true);
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
  assert.match(prompt, /【用户优化要求】[\s\S]*让打斗更有临场感/);
  assert.match(prompt, /\[1\] 第一段。/);
  assert.match(prompt, /不得摘录【叙事上下文】、【下章衔接】/);
  assert.match(prompt, /只出两类条目/);
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
  assert.match(prompt, /【用户优化要求】[\s\S]*让打斗更有临场感/, '复诊仍须重申原始要求');
  assert.match(prompt, /<previous-items>/);
  assert.match(prompt, /补足痛感/);
  assert.match(prompt, /删掉空泛比喻/);
});

test('buildAutoLoopPlanUserPrompt 带上一窗只读前文且不把它放进可编号正文', () => {
  const prompt = buildAutoLoopPlanUserPrompt({
    instruction: '让打斗更有临场感',
    chapterNo: 12,
    chapterTitle: '雨夜',
    indexedBody: '[1] 本窗第一段。',
    roundIndex: 1,
    roundBudget: 2,
    previousWindowTail: '上一窗最后一段只读。',
  });
  assert.match(prompt, /【上一窗末文·只读】/);
  assert.match(prompt, /禁止对其出条目或改写/);
  assert.match(prompt, /上一窗最后一段只读。/);
  assert.match(prompt, /不得摘录【叙事上下文】、【下章衔接】/);
  assert.ok(!prompt.includes('[1] 上一窗最后一段只读。'));
});

test('buildAutoLoopSegmentUserPrompt 带前后文只读块且禁止改写它们', () => {
  const prompt = buildAutoLoopSegmentUserPrompt({
    instruction: '让打斗更有临场感',
    paragraphIndex: 2,
    originalParagraph: '他握紧了拳头。',
    precedingText: '雨下了一整夜。\n\n院门还没关上。',
    followingText: '门在身后合上。\n\n鸡叫了第二声。',
    items: [makeItem({ instruction: '补足痛感与呼吸' })],
  });
  assert.match(prompt, /<preceding-paragraphs>/);
  assert.match(prompt, /<following-paragraphs>/);
  assert.match(prompt, /院门还没关上/);
  assert.match(prompt, /鸡叫了第二声/);
  assert.match(prompt, /不得提前写下这些情节/);
  assert.match(prompt, /他握紧了拳头。/);
  assert.match(prompt, /补足痛感与呼吸/);
  assert.match(prompt, /【用户优化要求】[\s\S]*让打斗更有临场感/);
  assert.match(prompt, /只输出|仅输出/, '须要求只输出目标段落');
});

test('复诊 system prompt 只抓未落地和改坏，不把润色当续跑理由', () => {
  assert.match(CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT, /只允许出两类条目/);
  assert.match(CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT, /还能更贴要求/);
  assert.match(CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT, /删除整段|删除整句/);
  assert.match(CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT, /禁止在 instruction 里写「两段合并」/);
  assert.match(CHAPTER_AUTO_LOOP_DRAFT_SYSTEM_PROMPT, /必须遵循【用户优化要求】/);
  assert.match(CHAPTER_AUTO_LOOP_DRAFT_SYSTEM_PROMPT, /不得把后文情节提前写完/);
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

test('本轮真的改写了段落但只剩轻微问题时仍收工', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 1,
    roundBudget: 2,
    items: [makeItem({ severity: 'low' })],
    discardedCount: 0,
    appliedCount: 3,
  });
  assert.equal(decision.shouldContinue, false);
  assert.equal(decision.converged, true, '仅剩轻微不再开下一轮');
});

test('零丢弃且无 high 才是真收敛', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 1,
    roundBudget: 2,
    items: [makeItem({ severity: 'low' })],
    discardedCount: 0,
    appliedCount: 0,
  });
  assert.equal(decision.converged, true);
  assert.equal(decision.diagnosisComplete, true);
  assert.equal(decision.shouldContinue, false);
});

test('轮数上限对仍有 high 是硬上界，仅 medium 则算收敛', () => {
  const atBudgetWithHigh = shouldContinueAutoLoop({
    roundIndex: 2,
    roundBudget: 2,
    items: [makeItem({ severity: 'high' })],
    discardedCount: 0,
    appliedCount: 5,
  });
  assert.equal(atBudgetWithHigh.shouldContinue, false);
  assert.equal(atBudgetWithHigh.converged, false);

  const onlyMedium = shouldContinueAutoLoop({
    roundIndex: 2,
    roundBudget: 2,
    items: [makeItem({ severity: 'medium' })],
    discardedCount: 0,
    appliedCount: 5,
  });
  assert.equal(onlyMedium.shouldContinue, false);
  assert.equal(onlyMedium.converged, true);
});

test('模型明说无问题（items 为空且零丢弃）仍算收敛', () => {
  const decision = shouldContinueAutoLoop({
    roundIndex: 1,
    roundBudget: 3,
    items: [],
    discardedCount: 0,
    appliedCount: 0,
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
          anchorQuote: '无法识别的严重度仍应救回',
          severity: '很急',
          instruction: '指令',
        },
      ],
    })
  );
  assert.equal(parsed.items.length, 2, '无法识别的 severity 应降为 medium 而不是丢条');
  assert.equal(parsed.discardedCount, 3);
  assert.equal(parsed.parseFailed, false);
  assert.equal(parsed.items[1].severity, 'medium');
});

test('段级 max_tokens 给短段足够扩写空间并夹在带宽内', () => {
  assert.equal(resolveAutoLoopSegmentMaxTokens('短。'), 1200);
  assert.equal(resolveAutoLoopSegmentMaxTokens('字'.repeat(2000)), 4000);
  assert.equal(resolveAutoLoopSegmentMaxTokens('字'.repeat(200)), 1600);
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

test('自动循环角色名单：勾选优先，否则正文出场并回退精修选角', () => {
  const personas = [
    { name: '林默', profile: '女主', state: '清醒', status: 'published' },
    { name: '沈砚', profile: '男主', state: '健康', status: 'published' },
    { name: '路人', profile: '路人', state: '健康', status: 'published' },
  ];
  assert.deepEqual(
    resolveAutoLoopPersonaNames({
      sourceText: '林默靠在门边。',
      personas,
      requestedNames: ['沈砚'],
    }),
    ['沈砚']
  );
  assert.deepEqual(
    resolveAutoLoopPersonaNames({
      sourceText: '林默靠在门边。',
      personas,
      fallbackNames: ['沈砚'],
    }),
    ['林默', '沈砚']
  );
  assert.deepEqual(
    resolveAutoLoopPersonaNames({
      sourceText: '没有人出场。',
      personas,
    }),
    ['林默', '沈砚', '路人']
  );
});
