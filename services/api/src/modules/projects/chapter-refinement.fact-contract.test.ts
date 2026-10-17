import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRefinementSourceBlocks,
  buildRewriteUserPrompt,
  buildReviewUserPrompt,
  buildFinalSeamReviewUserPrompt,
  buildRepairUserPrompt,
  mergeWindowSceneFragments,
  parsePlanOutputWithRecovery,
  parseWindowInspection,
  planRefinementDiagnosisWindows,
  type RefinementFact,
  type RefinementSceneFragment,
} from './chapter-refinement.util';

const TEXT = '甲站在门口。\n甲走到窗边。\n甲坐到桌前。';
const ENTRY: RefinementFact = {
  key: '甲的位置',
  value: '门口',
  sourceBlockId: 'b0',
  anchorQuote: '甲站在门口。',
};
const MIDDLE: RefinementFact = {
  key: '甲的位置',
  value: '窗边',
  sourceBlockId: 'b1',
  anchorQuote: '甲走到窗边。',
};
const EXIT: RefinementFact = {
  key: '甲的位置',
  value: '桌前',
  sourceBlockId: 'b2',
  anchorQuote: '甲坐到桌前。',
};

function fragment(
  startBlockId: string,
  endBlockId: string,
  entryFacts: RefinementFact[],
  exitFacts: RefinementFact[],
  startsNewScene = true
): RefinementSceneFragment {
  return {
    startBlockId,
    endBlockId,
    startsNewScene,
    confidence: 'high',
    goal: '保留位置变化',
    entryFacts,
    exitFacts,
    proposedBeatEnds: [],
  };
}

function setup(fragments: RefinementSceneFragment[]) {
  const blocks = buildRefinementSourceBlocks(TEXT);
  const inspection = parseWindowInspection(
    JSON.stringify({
      windowId: 'w0',
      sceneFragments: fragments,
      issues: [],
    })
  );
  return { blocks, scenes: mergeWindowSceneFragments({ blocks, inspections: [inspection] }) };
}

function plan(entryFacts: RefinementFact[] = [ENTRY], exitFacts: RefinementFact[] = [EXIT]) {
  return JSON.stringify({
    chapterIntent: '保留全过程并润色',
    protectedFacts: [],
    sceneBriefs: [
      {
        sceneId: 'scene-1',
        sourceBlockIds: ['b0', 'b1', 'b2'],
        decision: 'rewrite',
        reason: '调整措辞',
        editIntent: '保留全部位置变化，仅调整措辞',
        expectedChange: '更流畅',
        entryFacts,
        exitFacts,
        protectedSpanIds: [],
        targetLength: { direction: 'hold' },
        checks: [],
      },
    ],
  });
}

test('AQ-383 原文不存在的 inspect 引文不成为必须保留的事实', () => {
  const invalid: RefinementFact = {
    key: '甲的位置',
    value: '塔顶',
    sourceBlockId: 'b0',
    anchorQuote: '甲站在塔顶。',
  };
  const input = setup([fragment('b0', 'b2', [invalid], [EXIT])]);
  const result = parsePlanOutputWithRecovery({ ...input, raw: plan() });
  assert.equal(result.brief, null);
  assert.ok(result.violations.some((item) => item.kind === 'quote_not_found'));
  assert.ok(result.violations.every((item) => item.kind !== 'fact_dropped'));
});

test('AQ-383 合并片段的中途状态作为过程事实传到改写和检查，不锁为整场首尾', () => {
  const input = setup([
    fragment('b0', 'b1', [ENTRY], [MIDDLE]),
    fragment('b2', 'b2', [], [EXIT], false),
  ]);
  const result = parsePlanOutputWithRecovery({ ...input, raw: plan() });
  assert.deepEqual(result.violations, []);
  const brief = result.brief!.sceneBriefs[0];
  assert.deepEqual(brief.entryFacts, [ENTRY]);
  assert.deepEqual(brief.exitFacts, [EXIT]);
  assert.deepEqual(brief.processFacts, [MIDDLE]);
  const rewrite = buildRewriteUserPrompt({
    instruction: '润色',
    chapterIntent: '润色',
    protectedFacts: [],
    protectedQuotes: [],
    sceneBrief: brief,
    policy: 'preserve-plot',
    rangeText: TEXT,
  });
  const review = buildReviewUserPrompt({
    instruction: '润色',
    protectedFacts: [],
    sceneBrief: brief,
    protectedQuotes: [],
    rangeOriginal: TEXT,
    candidate: TEXT,
  });
  for (const prompt of [rewrite, review]) {
    assert.ok(prompt.includes('必要过程事实（不是首尾状态）'));
    assert.ok(prompt.includes('甲走到窗边。'));
  }
});

test('AQ-383 plan 整项遗漏的明确首尾事实从同场已验证证据恢复并留记录', () => {
  const input = setup([fragment('b0', 'b2', [ENTRY], [EXIT])]);
  const result = parsePlanOutputWithRecovery({ ...input, raw: plan([], []) });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.brief!.sceneBriefs[0].entryFacts, [ENTRY]);
  assert.deepEqual(result.brief!.sceneBriefs[0].exitFacts, [EXIT]);
  assert.equal(result.backfilled.filter((item) => item.method === 'inspect_boundary').length, 2);
});

test('AQ-383 模型把已验证中途事实列为散场时，按角色索引归还过程并恢复真实散场', () => {
  const input = setup([
    fragment('b0', 'b1', [ENTRY], [MIDDLE]),
    fragment('b2', 'b2', [], [EXIT], false),
  ]);
  const result = parsePlanOutputWithRecovery({ ...input, raw: plan([ENTRY], [MIDDLE]) });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.brief!.sceneBriefs[0].exitFacts, [EXIT]);
  assert.deepEqual(result.brief!.sceneBriefs[0].processFacts, [MIDDLE]);
  assert.ok(result.backfilled.some((item) => item.method === 'inspect_process'));
});

test('AQ-383 inspect 只读邻文不能成为目标窗证据', () => {
  const blocks = buildRefinementSourceBlocks(TEXT);
  const raw = JSON.stringify({
    windowId: 'w0',
    issues: [],
    sceneFragments: [fragment('b0', 'b0', [EXIT], [])],
  });
  assert.throws(
    () =>
      parseWindowInspection(raw, {
        blocks,
        startBlockIndex: 0,
        endBlockIndex: 1,
        targetText: blocks[0].text,
      }),
    /场景范围|诊断目标/
  );
  const singleBlock = buildRefinementSourceBlocks('甲站在门口。甲坐到桌前。');
  const partial = JSON.stringify({
    windowId: 'w0',
    issues: [],
    sceneFragments: [fragment('b0', 'b0', [{ ...EXIT, sourceBlockId: 'b0' }], [])],
  });
  assert.throws(
    () =>
      parseWindowInspection(partial, {
        blocks: singleBlock,
        startBlockIndex: 0,
        endBlockIndex: 1,
        targetText: '甲站在门口。',
      }),
    /诊断目标/
  );
});

test('AQ-383 边界错误值或 unknown 不被遗漏恢复覆盖', () => {
  const input = setup([fragment('b0', 'b2', [ENTRY], [EXIT])]);
  for (const value of ['塔顶', null]) {
    const fact: RefinementFact =
      value === null ? { key: ENTRY.key, value: null } : { ...ENTRY, value };
    const result = parsePlanOutputWithRecovery({ ...input, raw: plan([fact]) });
    assert.ok(
      result.violations.some(
        (item) => item.kind === 'fact_dropped' || item.kind === 'fact_downgraded'
      )
    );
    assert.ok(result.backfilled.every((item) => !item.path.includes('entryFacts')));
  }
});

test('AQ-383 入场未知而同名散场已确认时，不把合法入场 unknown 当成散场事实降级', () => {
  const unknown: RefinementFact = { key: EXIT.key, value: null };
  const input = setup([fragment('b0', 'b2', [unknown], [EXIT])]);
  const result = parsePlanOutputWithRecovery({ ...input, raw: plan([unknown], [EXIT]) });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.brief!.sceneBriefs[0].entryFacts, [unknown]);
  assert.deepEqual(result.brief!.sceneBriefs[0].exitFacts, [EXIT]);
});

test('AQ-383 散场未知而同名入场已确认时，不把合法散场 unknown 当成入场事实降级', () => {
  const unknown: RefinementFact = { key: ENTRY.key, value: null };
  const input = setup([fragment('b0', 'b2', [ENTRY], [unknown])]);
  const result = parsePlanOutputWithRecovery({ ...input, raw: plan([ENTRY], [unknown]) });
  assert.deepEqual(result.violations, []);
});

test('AQ-383 同角色已知状态变为 unknown 仍拒绝，即使另一边界保留了同名原值', () => {
  const input = setup([fragment('b0', 'b2', [EXIT], [EXIT])]);
  const result = parsePlanOutputWithRecovery({
    ...input,
    raw: plan([EXIT], [{ key: EXIT.key, value: null }]),
  });
  assert.ok(result.violations.some((item) => item.kind === 'fact_downgraded'));
  assert.ok(result.violations.some((item) => item.path.includes('exitFacts')));
});

test('AQ-383 入场与散场值颠倒时仍报告遗漏，另一边界的同名值不能替代对应状态', () => {
  const input = setup([fragment('b0', 'b2', [ENTRY], [EXIT])]);
  const result = parsePlanOutputWithRecovery({ ...input, raw: plan([EXIT], [ENTRY]) });
  assert.ok(
    result.violations.some(
      (item) => item.kind === 'fact_dropped' && item.path.includes('entryFacts')
    )
  );
  assert.ok(
    result.violations.some(
      (item) => item.kind === 'fact_dropped' && item.path.includes('exitFacts')
    )
  );
});

test('AQ-383 模型伪造过程事实不采信，拆分范围只收到自身过程事实', () => {
  const input = setup([
    fragment('b0', 'b1', [ENTRY], [MIDDLE]),
    fragment('b2', 'b2', [], [EXIT], false),
  ]);
  const raw = JSON.parse(plan());
  raw.sceneBriefs[0].processFacts = [{ ...MIDDLE, value: '塔顶' }];
  const result = parsePlanOutputWithRecovery({ ...input, raw: JSON.stringify(raw) });
  const brief = result.brief!.sceneBriefs[0];
  assert.deepEqual(brief.processFacts, [MIDDLE]);
  const prompt = buildRewriteUserPrompt({
    instruction: '润色',
    chapterIntent: '润色',
    protectedFacts: [],
    protectedQuotes: [],
    sceneBrief: brief,
    policy: 'preserve-plot',
    rangeText: '甲坐到桌前。',
  });
  const processBlock = prompt.split('【必要过程事实（不是首尾状态）】')[1]?.split('\n')[1];
  assert.equal(processBlock, '[]');
});

test('AQ-383 最终接缝复查收到已验证过程事实', () => {
  const prompt = buildFinalSeamReviewUserPrompt({
    instruction: '润色',
    chapterIntent: '润色',
    protectedFacts: [],
    ranges: [
      {
        sceneId: 's1',
        original: TEXT,
        candidate: TEXT,
        prefix: '',
        suffix: '',
        processFacts: [MIDDLE],
      },
    ],
  });
  assert.ok(prompt.includes('必要过程事实（不是首尾状态）'));
  assert.ok(prompt.includes('甲走到窗边。'));
  const repair = buildRepairUserPrompt({
    gaps: ['恢复遗漏过程'],
    protectedQuotes: [],
    candidateRange: '甲站在门口。甲坐到桌前。',
    rangeOriginal: TEXT,
    processFacts: [MIDDLE],
  });
  assert.ok(repair.includes('必要过程事实（不是首尾状态）'));
  assert.ok(repair.includes('甲走到窗边。'));
});

test('AQ-383 同场唯一引文可修复相邻 block 错标，下一场专属证据仍拒绝', () => {
  const input = setup([fragment('b0', 'b1', [ENTRY], [MIDDLE]), fragment('b2', 'b2', [], [EXIT])]);
  const raw = JSON.parse(plan());
  raw.sceneBriefs[0].sourceBlockIds = ['b0', 'b1'];
  raw.sceneBriefs[0].entryFacts = [{ ...ENTRY, sourceBlockId: 'b2' }];
  raw.sceneBriefs[0].exitFacts = [MIDDLE];
  raw.sceneBriefs.push({
    ...raw.sceneBriefs[0],
    sceneId: 'scene-2',
    sourceBlockIds: ['b2'],
    entryFacts: [],
    exitFacts: [EXIT],
  });
  const recovered = parsePlanOutputWithRecovery({ ...input, raw: JSON.stringify(raw) });
  assert.deepEqual(recovered.violations, []);
  assert.deepEqual(recovered.brief!.sceneBriefs[0].entryFacts, [ENTRY]);
  assert.ok(recovered.backfilled.some((item) => item.method === 'quote_unique_block'));
  raw.sceneBriefs[0].exitFacts = [EXIT];
  const rejected = parsePlanOutputWithRecovery({ ...input, raw: JSON.stringify(raw) });
  assert.ok(rejected.violations.some((item) => item.kind === 'fact_out_of_scope'));
});

test('AQ-383 17000 字 140 段跨窗场景只锁整场边界，全部中途证据保留', () => {
  const text = Array.from(
    { length: 140 },
    (_, i) => `甲走到第${i}处。` + '风吹过树梢，路边的叶子随风轻轻摇动。'.repeat(7)
  ).join('\n');
  assert.ok(text.length >= 17000);
  const blocks = buildRefinementSourceBlocks(text);
  const windows = planRefinementDiagnosisWindows({ baseText: text, blocks, targetChars: 3000 });
  const inspections = windows.map((window, i) => {
    const first = blocks[window.startBlockIndex];
    const last = blocks[window.endBlockIndex - 1];
    const fact = (block: typeof first) => ({
      key: '甲的位置',
      value: block.text.match(/第\d+处/)![0],
      sourceBlockId: block.id,
      anchorQuote: block.text.split('。')[0] + '。',
    });
    return parseWindowInspection(
      JSON.stringify({
        windowId: window.id,
        issues: [],
        sceneFragments: [fragment(first.id, last.id, [fact(first)], [fact(last)], i === 0)],
      }),
      {
        blocks,
        startBlockIndex: window.startBlockIndex,
        endBlockIndex: window.endBlockIndex,
        targetText: window.text,
      }
    );
  });
  const scenes = mergeWindowSceneFragments({ blocks, inspections });
  assert.equal(scenes.length, 1);
  const raw = JSON.parse(plan([], []));
  raw.sceneBriefs[0].sourceBlockIds = blocks.map((block) => block.id);
  const result = parsePlanOutputWithRecovery({ raw: JSON.stringify(raw), blocks, scenes });
  assert.deepEqual(result.violations, []);
  assert.equal(result.brief!.sceneBriefs[0].entryFacts.length, 1);
  assert.equal(result.brief!.sceneBriefs[0].exitFacts.length, 1);
  assert.equal(result.brief!.sceneBriefs[0].processFacts!.length, windows.length * 2 - 2);
});
