import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRefinementInstruction,
  assertRefinementSourceText,
  buildRefinementRunSummary,
  buildRefinementRunView,
  computeRefinementExpiresAt,
  computeRefinementPayloadHash,
  createInitialRefinementCheckpoint,
  normalizeRefinementRewritePolicy,
  REFINEMENT_DIAGNOSIS_TARGET_AUTO,
  REFINEMENT_MAX_INSTRUCTION_CHARS,
  REFINEMENT_MAX_SOURCE_CHARS,
  REFINEMENT_TTL_MS,
  RefinementValidationError,
  resolveRefinementDiagnosisTarget,
  resolveRefinementPolicy,
  type RefinementRunRecord,
} from './chapter-refinement.types';
import {
  assembleRefinementCandidate,
  buildRefinementSourceBlocks,
  CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_TEMPLATE_KEYS,
  CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS,
  CHAPTER_REFINEMENT_WRITING_TEMPLATE_KEYS,
  containsQuoteEvidence,
  deriveProtectedQuotes,
  groupRefinementRangesByBudget,
  mergeWindowSceneFragments,
  parsePlanOutputWithRecovery,
  planRefinementDiagnosisWindows,
  planRefinementWriteUnits,
  RefinementModelOutputError,
  resolveRefinementCallBudget,
  resolveRefinementCompletionFailure,
  resolveRefinementModelCapability,
  resolveRefinementPlanOutputTokens,
  runRefinementProgramGate,
  summarizeRefinementCoverage,
  verifyRefinementStateFact,
  type RefinementMergedScene,
  type RefinementSceneBrief,
  type RefinementSceneFragment,
  type RefinementSourceBlock,
  type RefinementWindowInspection,
} from './chapter-refinement.util';
import { isWritingStyleInjectionTemplateKey } from '@aether-quill/config';

function makeRecord(overrides: Partial<RefinementRunRecord> = {}): RefinementRunRecord {
  const baseText = '第一段。\n\n第二段。';
  return {
    runId: 'run-1',
    projectId: 'p1',
    chapterNo: 3,
    creatorId: 'u1',
    clientRequestId: 'c1',
    payloadHash: 'h1',
    status: 'ready',
    phase: 'finished',
    revision: 4,
    attemptId: 'a1',
    pauseReason: null,
    resumable: false,
    baseUpdatedAt: '2026-10-06T00:00:00.000Z',
    baseHash: 'base-hash',
    rewritePolicy: 'preserve-plot',
    snapshot: {
      instruction: '让打斗更有临场感',
      baseTitle: '第三章',
      baseText,
      systemPromptText: '项目系统提示',
      templateVersions: [],
      modelRoute: null,
      resolvedPolicy: resolveRefinementPolicy({}),
      frozenAt: '2026-10-06T00:00:00.000Z',
    },
    checkpoint: createInitialRefinementCheckpoint(baseText),
    tombstone: false,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:05:00.000Z',
    expiresAt: '2026-10-13T00:05:00.000Z',
    ...overrides,
  };
}

test('instruction 去空白且拒绝空值/超长', () => {
  assert.equal(assertRefinementInstruction('  优化节奏  '), '优化节奏');
  assert.throws(() => assertRefinementInstruction('   '), RefinementValidationError);
  assert.throws(
    () => assertRefinementInstruction('x'.repeat(REFINEMENT_MAX_INSTRUCTION_CHARS + 1)),
    RefinementValidationError
  );
});

test('source 拒绝空正文并限制 30000 UTF-16 单位', () => {
  assert.equal(assertRefinementSourceText('正文'), '正文');
  assert.throws(() => assertRefinementSourceText('   '), RefinementValidationError);
  assert.equal(
    assertRefinementSourceText('x'.repeat(REFINEMENT_MAX_SOURCE_CHARS)).length,
    REFINEMENT_MAX_SOURCE_CHARS
  );
  assert.throws(
    () => assertRefinementSourceText('x'.repeat(REFINEMENT_MAX_SOURCE_CHARS + 1)),
    RefinementValidationError
  );
});

test('诊断窗目标：显式 > 项目正值规范化 > 自动 3000', () => {
  assert.deepEqual(resolveRefinementDiagnosisTarget({ requested: 4200 }), {
    value: 4200,
    reason: 'explicit_request',
  });
  assert.throws(
    () => resolveRefinementDiagnosisTarget({ requested: 0 }),
    RefinementValidationError
  );
  assert.throws(
    () => resolveRefinementDiagnosisTarget({ requested: 1999 }),
    RefinementValidationError
  );
  assert.throws(
    () => resolveRefinementDiagnosisTarget({ requested: 5001 }),
    RefinementValidationError
  );

  assert.deepEqual(resolveRefinementDiagnosisTarget({ projectSegmentCharSize: 3000 }), {
    value: 3000,
    reason: 'project_segmentation_setting',
  });
  assert.deepEqual(resolveRefinementDiagnosisTarget({ projectSegmentCharSize: 800 }), {
    value: 2000,
    reason: 'project_segmentation_setting_normalized',
  });
  assert.deepEqual(resolveRefinementDiagnosisTarget({ projectSegmentCharSize: 12000 }), {
    value: 5000,
    reason: 'project_segmentation_setting_normalized',
  });
  assert.deepEqual(resolveRefinementDiagnosisTarget({ projectSegmentCharSize: 0 }), {
    value: REFINEMENT_DIAGNOSIS_TARGET_AUTO,
    reason: 'automatic_target',
  });
});

test('resolvedPolicy 携带工程预算常量', () => {
  const policy = resolveRefinementPolicy({ projectSegmentCharSize: 0 });
  assert.equal(policy.diagnosisTargetChars, REFINEMENT_DIAGNOSIS_TARGET_AUTO);
  assert.equal(policy.rewriteTargetChars, 3500);
  assert.equal(policy.rewriteMaxChars, 5200);
  assert.equal(policy.maxRepairPasses, 1);
  assert.equal(policy.maxCallsPerAttempt, 80);
  assert.equal(policy.maxActiveMsPerAttempt, 30 * 60 * 1000);
});

test('rewritePolicy 默认 preserve-plot 且拒绝未知值', () => {
  assert.equal(normalizeRefinementRewritePolicy(undefined), 'preserve-plot');
  assert.equal(normalizeRefinementRewritePolicy('scene-rewrite'), 'scene-rewrite');
  assert.throws(() => normalizeRefinementRewritePolicy('free'), RefinementValidationError);
});

test('payload 指纹对相同入参稳定、对任一差异敏感', () => {
  const base = {
    expectedChapterUpdatedAt: '2026-10-06T00:00:00.000Z',
    instruction: '优化',
    rewritePolicy: 'preserve-plot' as const,
    diagnosisTargetChars: 3000,
  };
  assert.equal(computeRefinementPayloadHash(base), computeRefinementPayloadHash({ ...base }));
  assert.notEqual(
    computeRefinementPayloadHash(base),
    computeRefinementPayloadHash({ ...base, instruction: '优化2' })
  );
  assert.notEqual(
    computeRefinementPayloadHash(base),
    computeRefinementPayloadHash({ ...base, rewritePolicy: 'scene-rewrite' })
  );
  assert.notEqual(
    computeRefinementPayloadHash(base),
    computeRefinementPayloadHash({ ...base, diagnosisTargetChars: 3001 })
  );
});

test('TTL：终态 7 天；活动状态给远期占位不被清理', () => {
  const from = new Date('2026-10-06T00:00:00.000Z');
  assert.equal(
    computeRefinementExpiresAt('ready', from),
    new Date(from.getTime() + REFINEMENT_TTL_MS).toISOString()
  );
  const active = new Date(computeRefinementExpiresAt('running', from)).getTime();
  assert.ok(active > from.getTime() + REFINEMENT_TTL_MS);
});

test('summary 与 view 从 run 记录投影，view 保留冻结原文与候选', () => {
  const record = makeRecord();
  const summary = buildRefinementRunSummary(record, 'memory');
  assert.equal(summary.storageMode, 'memory');
  assert.equal(summary.runId, 'run-1');
  assert.equal(summary.status, 'ready');
  assert.equal(summary.usage.callCount, 0);
  assert.equal('baseText' in summary, false);

  const view = buildRefinementRunView(record, 'memory', true);
  assert.equal(view.instruction, '让打斗更有临场感');
  assert.equal(view.baseText, '第一段。\n\n第二段。');
  assert.equal(view.acceptedDraftText, '第一段。\n\n第二段。');
  assert.equal(view.sourceCurrent, true);
  assert.equal(view.coverage.retainedOriginalChars, record.snapshot.baseText.length);
});

test('模板分类表：utility 仅诊断/规划/检查，writing 为改写/补修，文风样本只注入 writing', () => {
  assert.deepEqual(
    [...CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS].sort(),
    [
      CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
      CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
      CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
    ].sort()
  );
  assert.deepEqual(
    [...CHAPTER_REFINEMENT_WRITING_TEMPLATE_KEYS].sort(),
    [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY, CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY].sort()
  );

  for (const key of CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS) {
    assert.equal(isWritingStyleInjectionTemplateKey(key), false, `${key} 不应注入文风样本`);
  }
  for (const key of CHAPTER_REFINEMENT_WRITING_TEMPLATE_KEYS) {
    assert.equal(isWritingStyleInjectionTemplateKey(key), true, `${key} 应注入文风样本`);
  }

  // 分类无重叠、并集覆盖全部 key
  const all = [...CHAPTER_REFINEMENT_TEMPLATE_KEYS].sort();
  const union = [
    ...CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS,
    ...CHAPTER_REFINEMENT_WRITING_TEMPLATE_KEYS,
  ].sort();
  assert.deepEqual(union, all);
});

// ── AQ-382：诊断窗 / 场景合并 / 写作单位 / 偏移合并 ──────────────────────

function makeFragment(
  startBlockId: string,
  endBlockId: string,
  startsNewScene: boolean,
  confidence: 'high' | 'low' = 'high'
): RefinementSceneFragment {
  return {
    startBlockId,
    endBlockId,
    startsNewScene,
    confidence,
    goal: '',
    entryFacts: [],
    exitFacts: [],
    proposedBeatEnds: [],
  };
}

function makeInspection(
  windowId: string,
  sceneFragments: RefinementSceneFragment[]
): RefinementWindowInspection {
  return { windowId, sceneFragments, issues: [] };
}

function makeMergedScene(
  sceneId: string,
  startBlockIndex: number,
  endBlockIndex: number,
  blocks: RefinementSourceBlock[],
  confidence: 'high' | 'low' = 'high'
): RefinementMergedScene {
  return {
    sceneId,
    windowIds: ['w0'],
    startBlockIndex,
    endBlockIndex,
    startOffset: blocks[startBlockIndex].startOffset,
    endOffset: blocks[endBlockIndex - 1].endOffset,
    confidence,
    startsNewScene: true,
    goals: [],
    fragments: [],
  };
}

function makeSceneBrief(
  sceneId: string,
  sourceBlockIds: string[],
  decision: 'keep' | 'patch' | 'rewrite'
): RefinementSceneBrief {
  return {
    sceneId,
    sourceBlockIds,
    decision,
    reason: '',
    editIntent: '',
    expectedChange: '',
    entryFacts: [],
    exitFacts: [],
    protectedSpanIds: [],
    targetLength: { direction: 'hold' },
    checks: [],
  };
}

test('诊断窗规划：CRLF／空行／单换行混合下覆盖全文且首尾相接', () => {
  const text = '第一段。\r\n\r\n第二段单换行\n第三段。';
  const blocks = buildRefinementSourceBlocks(text);
  const windows = planRefinementDiagnosisWindows({ baseText: text, blocks, targetChars: 5 });

  assert.ok(windows.length > 1);
  assert.equal(windows.map((window) => window.text).join(''), text);
  assert.equal(windows[0]?.startOffset, 0);
  assert.equal(windows[windows.length - 1]?.endOffset, text.length);
  for (let i = 1; i < windows.length; i += 1) {
    assert.equal(windows[i]?.startOffset, windows[i - 1]?.endOffset);
  }
});

test('诊断窗规划：超长自然段按 UTF-16 安全边界切分且不劈开代理对', () => {
  const text = '甲乙丙😀丁戊己庚辛。'.repeat(8);
  const blocks = buildRefinementSourceBlocks(text);
  assert.equal(blocks.length, 1);

  for (const targetChars of [4, 10, 30]) {
    const windows = planRefinementDiagnosisWindows({ baseText: text, blocks, targetChars });
    assert.ok(windows.length > 1, `target=${targetChars} 应产生多个窗口`);
    assert.equal(windows.map((window) => window.text).join(''), text);
    assert.equal(windows[windows.length - 1]?.endOffset, text.length);
    for (const window of windows) {
      const last = window.text.charCodeAt(window.text.length - 1);
      const first = window.text.charCodeAt(0);
      assert.equal(last >= 0xd800 && last <= 0xdbff, false, '窗口不得以高代理项结尾');
      assert.equal(first >= 0xdc00 && first <= 0xdfff, false, '窗口不得以低代理项开头');
    }
    // 单句短于目标时优先落在句末边界
    if (targetChars === 30) {
      for (let i = 0; i < windows.length - 1; i += 1) {
        assert.equal(windows[i]?.text.endsWith('。'), true);
      }
    }
  }
});

test('跨窗场景合并：连续片段合并，声明新场景不合并', () => {
  const blocks = buildRefinementSourceBlocks('AA\n\nBB\n\nCC');
  const scenes = mergeWindowSceneFragments({
    blocks,
    inspections: [
      makeInspection('w0', [makeFragment('b0', 'b0', true)]),
      makeInspection('w1', [makeFragment('b1', 'b1', false)]),
      makeInspection('w2', [makeFragment('b2', 'b2', true)]),
    ],
  });

  assert.equal(scenes.length, 2);
  assert.deepEqual(scenes[0]?.windowIds, ['w0', 'w1']);
  assert.equal(scenes[0]?.startBlockIndex, 0);
  assert.equal(scenes[0]?.endBlockIndex, 2);
  assert.equal(scenes[1]?.startBlockIndex, 2);
  assert.equal(scenes[1]?.endBlockIndex, 3);
});

test('跨窗场景合并：block 引用不可验证时降级，全部不可验证则丢弃', () => {
  const blocks = buildRefinementSourceBlocks('AA\n\nBB');

  const degraded = mergeWindowSceneFragments({
    blocks,
    inspections: [makeInspection('w0', [makeFragment('b0', 'b9', true)])],
  });
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0]?.confidence, 'low');
  assert.equal(degraded[0]?.startBlockIndex, 0);
  assert.equal(degraded[0]?.endBlockIndex, 1);

  const dropped = mergeWindowSceneFragments({
    blocks,
    inspections: [makeInspection('w0', [makeFragment('bx', 'by', true)])],
  });
  assert.equal(dropped.length, 0);
});

test('写作单位规划：未覆盖 block 由程序补 keep 单位，保证全覆盖', () => {
  const text = 'AA\n\nBB\n\nCC';
  const blocks = buildRefinementSourceBlocks(text);
  const plan = planRefinementWriteUnits({
    baseText: text,
    blocks,
    scenes: [makeMergedScene('scene-1', 0, 1, blocks)],
    briefs: [makeSceneBrief('scene-1', ['b0'], 'rewrite')],
    rewriteTargetChars: 2,
    rewriteMaxChars: 100,
  });

  assert.deepEqual(
    plan.units.map((unit) => [unit.startBlockIndex, unit.endBlockIndex, unit.decision]),
    [
      [0, 1, 'rewrite'],
      [1, 3, 'keep'],
    ]
  );
  assert.equal(plan.units[1]?.sceneId, 'uncovered-1');
  assert.equal(plan.units[1]?.retainedForSafety, true);
  assert.equal(
    plan.units.map((unit) => text.slice(unit.startOffset, unit.endOffset)).join(''),
    text
  );
});

test('写作单位规划：低置信度场景整场保留原文', () => {
  const text = 'AA\n\nBB';
  const blocks = buildRefinementSourceBlocks(text);
  const plan = planRefinementWriteUnits({
    baseText: text,
    blocks,
    scenes: [makeMergedScene('scene-1', 0, 2, blocks, 'low')],
    briefs: [makeSceneBrief('scene-1', ['b0', 'b1'], 'rewrite')],
    rewriteTargetChars: 4,
    rewriteMaxChars: 100,
  });

  assert.equal(plan.units.length, 1);
  assert.equal(plan.units[0]?.decision, 'keep');
  assert.equal(plan.units[0]?.retainedForSafety, true);
  assert.equal(plan.units[0]?.lowConfidence, true);
});

test('写作单位规划：超长场景无可验证拍边界时整场保留原文并记录', () => {
  const text = '甲'.repeat(30);
  const blocks = buildRefinementSourceBlocks(text);
  const plan = planRefinementWriteUnits({
    baseText: text,
    blocks,
    scenes: [makeMergedScene('scene-1', 0, 1, blocks)],
    briefs: [makeSceneBrief('scene-1', ['b0'], 'rewrite')],
    rewriteTargetChars: 10,
    rewriteMaxChars: 12,
  });

  assert.equal(plan.units.length, 1);
  assert.equal(plan.units[0]?.decision, 'keep');
  assert.equal(plan.units[0]?.retainedForSafety, true);
  assert.deepEqual(plan.unsplittableSceneIds, ['scene-1']);
});

test('写作单位规划：超长场景按已验证拍边界拆分', () => {
  const text = `${'甲'.repeat(10)}\n\n${'乙'.repeat(10)}\n\n${'丙'.repeat(10)}`;
  const blocks = buildRefinementSourceBlocks(text);
  const scene = makeMergedScene('scene-1', 0, 3, blocks);
  scene.fragments = [
    {
      ...makeFragment('b0', 'b2', true),
      proposedBeatEnds: [{ blockId: 'b1', anchorQuote: '乙乙乙' }],
    },
  ];
  const plan = planRefinementWriteUnits({
    baseText: text,
    blocks,
    scenes: [scene],
    briefs: [makeSceneBrief('scene-1', ['b0', 'b1', 'b2'], 'rewrite')],
    rewriteTargetChars: 20,
    rewriteMaxChars: 25,
  });

  assert.deepEqual(plan.unsplittableSceneIds, []);
  assert.deepEqual(
    plan.units.map((unit) => [unit.startBlockIndex, unit.endBlockIndex]),
    [
      [0, 2],
      [2, 3],
    ]
  );
});

test('写作单位规划：模型未回填合并后 sceneId 时按 sourceBlockIds 对齐交底', () => {
  const text = 'AA\n\nBB';
  const blocks = buildRefinementSourceBlocks(text);
  const plan = planRefinementWriteUnits({
    baseText: text,
    blocks,
    scenes: [makeMergedScene('scene-1', 0, 2, blocks)],
    briefs: [makeSceneBrief('s1', ['b1'], 'rewrite')],
    rewriteTargetChars: 4,
    rewriteMaxChars: 100,
  });

  assert.deepEqual(plan.scenesWithoutBrief, []);
  assert.equal(plan.units.length, 1);
  assert.equal(plan.units[0]?.decision, 'rewrite');
});

test('按原文偏移合并：替换长度变化不产生漂移，交叠替换被拒绝', () => {
  const baseText = 'AAAA\n\nBBBB\n\nCCCC';
  const merged = assembleRefinementCandidate({
    baseText,
    replacements: [
      { startOffset: 0, endOffset: 4, replacement: 'AAAAA' },
      { startOffset: 12, endOffset: 16, replacement: 'C' },
    ],
  });
  assert.equal(merged, 'AAAAA\n\nBBBB\n\nC');

  assert.throws(
    () =>
      assembleRefinementCandidate({
        baseText,
        replacements: [
          { startOffset: 0, endOffset: 6, replacement: 'x' },
          { startOffset: 4, endOffset: 8, replacement: 'y' },
        ],
      }),
    RefinementModelOutputError
  );
});

test('覆盖面统计：processed 为跨度合计，retainedOriginal 只计保留原文的部分', () => {
  const coverage = summarizeRefinementCoverage({
    sourceChars: 100,
    units: [
      { startOffset: 0, endOffset: 40, retainedOriginal: false },
      { startOffset: 40, endOffset: 100, retainedOriginal: true },
    ],
  });
  assert.deepEqual(coverage, {
    sourceChars: 100,
    plannedChars: 100,
    processedChars: 100,
    retainedOriginalChars: 60,
  });
});

test('严格完成判定：非空内容不等于成功（缺 end / length / 过滤 / 未知）', () => {
  // 正常收束
  assert.equal(
    resolveRefinementCompletionFailure({ completed: true, finishReason: 'stop', text: '正文' }),
    null
  );

  // 缺 end：上游提前断流，即便已有非空正文也不可接受
  assert.equal(
    resolveRefinementCompletionFailure({ completed: false, finishReason: null, text: '半截正文' })
      ?.kind,
    'incomplete_stream'
  );

  // 长度截断
  assert.equal(
    resolveRefinementCompletionFailure({ completed: true, finishReason: 'length', text: '正文' })
      ?.kind,
    'truncated'
  );

  // 内容过滤
  assert.equal(
    resolveRefinementCompletionFailure({
      completed: true,
      finishReason: 'content_filter',
      text: '正文',
    })?.kind,
    'filtered'
  );

  // 未知／缺失完成原因：不靠模型名猜测，一律不可应用
  assert.equal(
    resolveRefinementCompletionFailure({ completed: true, finishReason: null, text: '正文' })?.kind,
    'unknown_finish'
  );
  assert.equal(
    resolveRefinementCompletionFailure({
      completed: true,
      finishReason: 'weird_reason',
      text: '正文',
    })?.kind,
    'unknown_finish'
  );
});

test('逐字锁只取 protectedSpanIds 解析的整块原文，事实引文不参与', () => {
  const blocks = buildRefinementSourceBlocks('AA\n\nBB\n\nCC');
  const scene = makeMergedScene('scene-1', 0, 3, blocks);
  const sceneBrief: RefinementSceneBrief = {
    ...makeSceneBrief('scene-1', ['b0', 'b1', 'b2'], 'patch'),
    protectedSpanIds: ['b1'],
    entryFacts: [{ key: 'k', value: 'v', sourceBlockId: 'b0', anchorQuote: 'AA' }],
    exitFacts: [{ key: 'k2', value: 'v2', sourceBlockId: 'b2', anchorQuote: 'CC' }],
  };

  assert.deepEqual(
    deriveProtectedQuotes({
      sceneBrief,
      blocks,
      startBlockIndex: scene.startBlockIndex,
      endBlockIndex: scene.endBlockIndex,
    }),
    ['BB']
  );
});

test('逐字锁忽略不存在或落在写作单位范围外的 protectedSpanIds', () => {
  const blocks = buildRefinementSourceBlocks('AA\n\nBB\n\nCC');
  const scene = makeMergedScene('scene-1', 1, 3, blocks);
  const sceneBrief: RefinementSceneBrief = {
    ...makeSceneBrief('scene-1', ['b1', 'b2'], 'patch'),
    protectedSpanIds: ['b0', 'b9', 'b2'],
  };

  assert.deepEqual(
    deriveProtectedQuotes({
      sceneBrief,
      blocks,
      startBlockIndex: scene.startBlockIndex,
      endBlockIndex: scene.endBlockIndex,
    }),
    ['CC']
  );
});

test('程序门禁：无逐字锁不拒绝改写，逐字锁整块丢失才判 quote_missing', () => {
  assert.equal(
    runRefinementProgramGate({ candidate: '改写后的正文。', maxChars: 1000, protectedQuotes: [] })
      .ok,
    true
  );

  const gate = runRefinementProgramGate({
    candidate: '改写后的正文。',
    maxChars: 1000,
    protectedQuotes: ['AA'],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.failures[0]?.code, 'quote_missing');
});

test('引文证据匹配：引号字形无关，但内容字符须连续出现', () => {
  // 原文直引号，模型引文用中文弯引号
  assert.equal(containsQuoteEvidence('"我姓周，周绍安。"男人说', '“我姓周，周绍安。”'), true);
  // 连续引语被模型在句末补了一个原文没有的闭引号
  assert.equal(
    containsQuoteEvidence(
      '"他要的是一本书里的某一页。那页上有一段话。"',
      '“他要的是一本书里的某一页。”'
    ),
    true
  );
  // 内容不符不放过
  assert.equal(containsQuoteEvidence('"我姓周，周绍安。"男人说', '“我姓陆，陆绍安。”'), false);
  // 只有引号、去掉后为空串时退回精确匹配，不产生空串命中
  assert.equal(containsQuoteEvidence('正文', '"'), false);
  assert.equal(containsQuoteEvidence('正文', ''), false);
});

test('引文证据匹配：对白被说话人提示隔断时按引号内容拼接命中（AQ-383 补充）', () => {
  const block = '"签在这儿就行。"周绍安说，"不用写日期。"';
  assert.equal(containsQuoteEvidence(block, '签在这儿就行。不用写日期。'), true);
  // 顺序颠倒不属于拼接命中
  assert.equal(containsQuoteEvidence(block, '不用写日期。签在这儿就行。'), false);
  // 内容不符不放过
  assert.equal(containsQuoteEvidence(block, '签在这儿就行。请写日期。'), false);
});

test('plan 合同校验：引文字形不同／句末补闭引号仍判命中（AQ-383）', () => {
  const text = '"我姓周，周绍安。"男人说。\n\n"他要的是一本书里的某一页。那页上有一段话。"';
  const blocks = buildRefinementSourceBlocks(text);
  const scenes = [makeMergedScene('scene-1', 0, blocks.length, blocks)];
  const plan = {
    chapterIntent: '意图',
    protectedFacts: [
      {
        key: '身份',
        value: '周绍安',
        sourceBlockId: blocks[0]!.id,
        anchorQuote: '“我姓周，周绍安。”',
      },
      {
        key: '真相',
        value: '某一页',
        sourceBlockId: blocks[1]!.id,
        anchorQuote: '“他要的是一本书里的某一页。”',
      },
    ],
    sceneBriefs: [
      {
        ...makeSceneBrief(
          'scene-1',
          blocks.map((block) => block.id),
          'patch'
        ),
        entryFacts: [
          {
            key: '身份',
            value: '周绍安',
            sourceBlockId: blocks[0]!.id,
            anchorQuote: '“我姓周，周绍安。”',
          },
        ],
      },
    ],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });
  assert.deepEqual(recovery.violations, []);
  assert.ok(recovery.brief);
});

test('plan 合同校验：引文内容确实不在原文仍记 quote_not_found（AQ-383）', () => {
  const text = '"我姓周，周绍安。"男人说。';
  const blocks = buildRefinementSourceBlocks(text);
  const scenes = [makeMergedScene('scene-1', 0, blocks.length, blocks)];
  const plan = {
    chapterIntent: '意图',
    protectedFacts: [
      { key: '身份', value: '陆沉', sourceBlockId: blocks[0]!.id, anchorQuote: '陆沉' },
    ],
    sceneBriefs: [makeSceneBrief('scene-1', [blocks[0]!.id], 'patch')],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });
  assert.equal(recovery.violations.length, 1);
  assert.equal(recovery.violations[0]?.kind, 'quote_not_found');
  assert.equal(recovery.violations[0]?.path, 'protectedFacts[0].anchorQuote');
});

test('plan 合同校验：引文正确但 block 归属错位时唯一重锚（AQ-383 补充）', () => {
  // 真实样章：模型把信件正文归到相邻的「昭儿：」行，正文实际在下一块
  const text = '"昭儿："\n\n书我替你留着。什么时候想看了，就来取。\n\n不必解释。';
  const blocks = buildRefinementSourceBlocks(text);
  const scenes = [makeMergedScene('scene-1', 0, blocks.length, blocks)];
  const quote = '书我替你留着。什么时候想看了，就来取。';
  const plan = {
    chapterIntent: '意图',
    protectedFacts: [
      { key: '信件内容', value: '书我替你留着', sourceBlockId: blocks[0]!.id, anchorQuote: quote },
    ],
    sceneBriefs: [
      {
        ...makeSceneBrief(
          'scene-1',
          blocks.map((block) => block.id),
          'patch'
        ),
        exitFacts: [
          {
            key: '信件内容',
            value: '书我替你留着',
            sourceBlockId: blocks[0]!.id,
            anchorQuote: quote,
          },
        ],
      },
    ],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });
  assert.deepEqual(recovery.violations, []);
  const protectedFact = recovery.brief?.protectedFacts[0];
  const exitFact = recovery.brief?.sceneBriefs[0]?.exitFacts[0];
  assert.ok(protectedFact && protectedFact.value !== null);
  assert.ok(exitFact && exitFact.value !== null);
  assert.equal(protectedFact.sourceBlockId, blocks[1]!.id);
  assert.equal(exitFact.sourceBlockId, blocks[1]!.id);
  assert.equal(recovery.backfilled.length, 2);
  assert.ok(recovery.backfilled.every((item) => item.method === 'quote_unique_block'));
});

test('plan 合同校验：引文在多个 block 出现时不重锚（AQ-383 补充）', () => {
  const text = '雨还在下。\n\n别的段落。\n\n雨还在下。';
  const blocks = buildRefinementSourceBlocks(text);
  const scenes = [makeMergedScene('scene-1', 0, blocks.length, blocks)];
  const plan = {
    chapterIntent: '意图',
    protectedFacts: [
      { key: '天气', value: '下雨', sourceBlockId: blocks[1]!.id, anchorQuote: '雨还在下。' },
    ],
    sceneBriefs: [
      makeSceneBrief(
        'scene-1',
        blocks.map((block) => block.id),
        'patch'
      ),
    ],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });
  assert.equal(recovery.violations.length, 1);
  assert.equal(recovery.violations[0]?.kind, 'quote_not_found');
});

test('plan 合同校验：场景事实的唯一命中在场景范围外不重锚（AQ-383 补充）', () => {
  const text = '甲。\n\n乙。\n\n丙。';
  const blocks = buildRefinementSourceBlocks(text);
  const scenes = [makeMergedScene('scene-1', 0, blocks.length, blocks)];
  const plan = {
    chapterIntent: '意图',
    protectedFacts: [],
    sceneBriefs: [
      {
        ...makeSceneBrief('scene-1', [blocks[0]!.id], 'patch'),
        entryFacts: [{ key: 'x', value: '丙', sourceBlockId: blocks[0]!.id, anchorQuote: '丙。' }],
      },
    ],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });
  assert.equal(recovery.violations.length, 1);
  assert.equal(recovery.violations[0]?.kind, 'quote_not_found');
});

// ── F2：plan 恢复不得丢失已证实必要事实或覆盖错误字段 ──────────────────

function sceneWithVerifiedFact(
  sceneId: string,
  blocks: RefinementSourceBlock[],
  facts: Array<{ key: string; value: string; sourceBlockId: string; anchorQuote: string }>
): RefinementMergedScene {
  return {
    sceneId,
    windowIds: ['w0'],
    startBlockIndex: 0,
    endBlockIndex: blocks.length,
    startOffset: blocks[0]!.startOffset,
    endOffset: blocks[blocks.length - 1]!.endOffset,
    confidence: 'high',
    startsNewScene: true,
    goals: [],
    fragments: [
      {
        startBlockId: blocks[0]!.id,
        endBlockId: blocks[blocks.length - 1]!.id,
        startsNewScene: true,
        confidence: 'high',
        goal: '',
        entryFacts: facts,
        exitFacts: [],
        proposedBeatEnds: [],
      },
    ],
  };
}

const F2_TEXT = '甲握紧钥匙，转身离开。';
const F2_KEY_FACT = { key: 'item', value: '钥匙', sourceBlockId: 'b0', anchorQuote: '钥匙' };

test('F2 已知必要事实被降级为 null：记 fact_downgraded，不得放行', () => {
  const blocks = buildRefinementSourceBlocks(F2_TEXT);
  const scenes = [sceneWithVerifiedFact('scene-1', blocks, [F2_KEY_FACT])];
  const plan = {
    chapterIntent: '精简',
    protectedFacts: [{ key: 'item', value: null }],
    sceneBriefs: [makeSceneBrief('scene-1', [blocks[0]!.id], 'rewrite')],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });

  assert.ok(recovery.violations.some((v) => v.kind === 'fact_downgraded'));
});

test('F2 已验证边界事实被整项遗漏：确定性继承且记录来源', () => {
  const blocks = buildRefinementSourceBlocks(F2_TEXT);
  const scenes = [sceneWithVerifiedFact('scene-1', blocks, [F2_KEY_FACT])];
  const plan = {
    chapterIntent: '精简',
    protectedFacts: [],
    sceneBriefs: [makeSceneBrief('scene-1', [blocks[0]!.id], 'rewrite')],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });

  assert.deepEqual(recovery.violations, []);
  assert.deepEqual(recovery.brief?.sceneBriefs[0]?.entryFacts, [F2_KEY_FACT]);
  assert.equal(recovery.backfilled[0]?.method, 'inspect_boundary');
});

test('F2 缺 sourceBlockId 但已有错误引文：不静默覆盖，记违规', () => {
  const blocks = buildRefinementSourceBlocks(F2_TEXT);
  const scenes = [sceneWithVerifiedFact('scene-1', blocks, [F2_KEY_FACT])];
  const plan = {
    chapterIntent: '精简',
    protectedFacts: [{ key: 'item', value: '钥匙', anchorQuote: '毫不相关的错误引文' }],
    sceneBriefs: [makeSceneBrief('scene-1', [blocks[0]!.id], 'rewrite')],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });

  assert.ok(
    recovery.violations.some((v) => v.kind === 'missing_fact_source'),
    '错误引文不得被索引回填覆盖'
  );
  // 没有发生任何回填：已有错误引文未被静默替换为索引引文
  assert.equal(
    recovery.backfilled.some((item) => item.path.startsWith('protectedFacts')),
    false
  );
  assert.equal(recovery.brief, null);
});

test('F2 缺 sourceBlockId 且引文可由唯一索引佐证：只补 sourceBlockId', () => {
  const blocks = buildRefinementSourceBlocks(F2_TEXT);
  const scenes = [sceneWithVerifiedFact('scene-1', blocks, [F2_KEY_FACT])];
  const plan = {
    chapterIntent: '精简',
    protectedFacts: [{ key: 'item', value: '钥匙', anchorQuote: '钥匙' }],
    sceneBriefs: [makeSceneBrief('scene-1', [blocks[0]!.id], 'rewrite')],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });

  assert.deepEqual(recovery.violations, []);
  assert.equal(
    (recovery.brief?.protectedFacts[0] as { sourceBlockId?: string } | undefined)?.sourceBlockId,
    'b0'
  );
  assert.equal(recovery.backfilled[0]?.method, 'quote_unique_block');
});

test('F2 同一 key/value 有多个来源：不猜测，记 ambiguous_backfill', () => {
  const text = '甲握紧钥匙。\n\n乙也握紧钥匙。';
  const blocks = buildRefinementSourceBlocks(text);
  const scenes = [
    sceneWithVerifiedFact(
      'scene-1',
      [blocks[0]!],
      [{ key: 'item', value: '钥匙', sourceBlockId: blocks[0]!.id, anchorQuote: '钥匙' }]
    ),
    sceneWithVerifiedFact(
      'scene-2',
      [blocks[1]!],
      [{ key: 'item', value: '钥匙', sourceBlockId: blocks[1]!.id, anchorQuote: '钥匙' }]
    ),
  ];
  // Scene 范围下标属于全文 blocks，不能沿用单块 helper 的局部 0 下标。
  scenes[1].startBlockIndex = 1;
  scenes[1].endBlockIndex = 2;
  const plan = {
    chapterIntent: '精简',
    protectedFacts: [{ key: 'item', value: '钥匙' }],
    sceneBriefs: [
      makeSceneBrief('scene-1', [blocks[0]!.id], 'rewrite'),
      makeSceneBrief('scene-2', [blocks[1]!.id], 'rewrite'),
    ],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });

  assert.ok(recovery.violations.some((v) => v.kind === 'ambiguous_backfill'));
});

// ── F5：散场状态事实的证据判定 ─────────────────────────────────────────

test('F5 状态事实要有证据：只认当前候选，历史原文证据不算当前状态', () => {
  const candidate = '他推门而入，屋内寂静无声。';
  const original = '他推开门，屋内一片寂静。';

  // 命中当前候选且给出末态证据锚点 → 证据来自候选（程序返回锚点的唯一位置，不采信模型数字）
  const placed = verifyRefinementStateFact(
    {
      key: 'place',
      value: '屋内',
      sourceBlockId: 'b1',
      anchorQuote: '屋内',
      exitAnchorQuote: '屋内寂静无声。',
    },
    { candidate, original }
  );
  assert.equal(placed.status, 'evidence');
  assert.equal(placed.origin, 'candidate');
  assert.equal(candidate.slice(placed.start, placed.end), '屋内寂静无声。');
  // W6：候选全段命中但缺少末态证据锚点 → 不可确认，不得作为当前状态传播
  assert.notEqual(
    verifyRefinementStateFact(
      { key: 'place', value: '屋内', sourceBlockId: 'b1', anchorQuote: '屋内' },
      { candidate, original }
    ).status,
    'evidence'
  );
  // 候选不含、仅改写前原文含 → 历史证据，不能证明当前散场状态成立
  assert.deepEqual(
    verifyRefinementStateFact(
      { key: 'quiet', value: '一片寂静', sourceBlockId: 'b1', anchorQuote: '一片寂静' },
      { candidate: '毫不相干', original }
    ),
    { status: 'historical' }
  );
  // 既不在候选也不在原文 → 凭空状态，冲突
  assert.deepEqual(
    verifyRefinementStateFact(
      { key: 'crowd', value: '人群喧闹', sourceBlockId: 'b1', anchorQuote: '人群喧闹' },
      { candidate, original }
    ),
    { status: 'conflict' }
  );
  // value=null → 未知，不作为确定状态
  assert.deepEqual(
    verifyRefinementStateFact({ key: 'time', value: null }, { candidate, original }),
    { status: 'unknown' }
  );
});

test('F5 入场持有、散场放下：历史入场动作不得被当作当前散场状态', () => {
  const original = '甲拿着钥匙入场，散场时把钥匙留在桌上。';
  const candidate = '甲把钥匙留在桌上，独自走出门。';
  // 模型误把入场动作报成散场状态：只有在原文能命中，候选已不含 → 不得作为确定状态
  assert.deepEqual(
    verifyRefinementStateFact(
      { key: 'holding', value: '拿着钥匙', sourceBlockId: 'b0', anchorQuote: '甲拿着钥匙入场' },
      { candidate, original }
    ),
    { status: 'historical' }
  );
  // 候选确实体现散场放下钥匙，且给出末态证据锚点 → 只有候选证据才是当前状态
  const dropped = verifyRefinementStateFact(
    {
      key: 'holding',
      value: '把钥匙留在桌上',
      sourceBlockId: 'b0',
      anchorQuote: '把钥匙留在桌上',
      exitAnchorQuote: '把钥匙留在桌上',
    },
    { candidate, original }
  );
  assert.equal(dropped.status, 'evidence');
  assert.equal(dropped.origin, 'candidate');
  // 与当前候选相反的「仍拿着钥匙」既不在候选也不在原文 → 冲突
  assert.deepEqual(
    verifyRefinementStateFact(
      {
        key: 'holding',
        value: '手里还捏着钥匙',
        sourceBlockId: 'b0',
        anchorQuote: '手里还捏着钥匙',
      },
      { candidate, original }
    ),
    { status: 'conflict' }
  );
});

test('W6 候选内的入场动作不能证明散场状态：缺末态证据锚点即不传播', () => {
  const original = '甲拿着钥匙入场，散场时把钥匙留在桌上。';
  const candidate = original;
  // 事实只给入场锚点、没有末态证据锚点 → 不得认定为当前散场状态
  assert.equal(
    verifyRefinementStateFact(
      { key: 'holding', value: '拿着钥匙', sourceBlockId: 'b0', anchorQuote: '甲拿着钥匙入场' },
      { candidate, original }
    ).status,
    'historical'
  );
  // 给出末态证据锚点，且状态值落在锚点内 → 才认定为当前状态
  const anchored = verifyRefinementStateFact(
    {
      key: 'holding',
      value: '钥匙留在桌上',
      sourceBlockId: 'b0',
      anchorQuote: '钥匙留在桌上',
      exitAnchorQuote: '散场时把钥匙留在桌上',
    },
    { candidate, original }
  );
  assert.equal(anchored.status, 'evidence');
  assert.equal(anchored.origin, 'candidate');
});

// ── B2：末态证据的可信边界（W6 关闭） ──────────────────────────────────

test('B2/W6 入场片段冒充末态锚点：之后有同一状态后续变化时不得判为确定末态', () => {
  const original = '甲拿着钥匙入场，散场时把钥匙留在桌上。';
  const candidate = original;
  // 把入场引文直接填成 exitAnchorQuote（第四轮 W6 反例）：候选后面明确改变同一状态
  const verdict = verifyRefinementStateFact(
    {
      key: 'holding',
      value: '拿着钥匙',
      sourceBlockId: 'b0',
      anchorQuote: '甲拿着钥匙入场',
      exitAnchorQuote: '甲拿着钥匙入场',
    },
    { candidate, original }
  );
  assert.equal(verdict.status, 'superseded');
  assert.notEqual(verdict.status, 'evidence');
  // 同一状态在范围末尾的最后一次变化才可作为末态证据
  assert.equal(
    verifyRefinementStateFact(
      {
        key: 'holding',
        value: '钥匙留在桌上',
        sourceBlockId: 'b0',
        anchorQuote: '甲拿着钥匙入场',
        exitAnchorQuote: '散场时把钥匙留在桌上',
      },
      { candidate, original }
    ).status,
    'evidence'
  );
});

test('B2 重复引文无法确定末态位置：多次出现记为不确定', () => {
  const candidate = '他把钥匙留在桌上。钥匙留在桌上这件事没人提起。';
  assert.equal(
    verifyRefinementStateFact(
      {
        key: 'holding',
        value: '钥匙留在桌上',
        sourceBlockId: 'b0',
        anchorQuote: '钥匙留在桌上',
        exitAnchorQuote: '钥匙留在桌上',
      },
      { candidate, original: '他把钥匙留在桌上。' }
    ).status,
    'ambiguous'
  );
});

test('B2 同物件多次转移：放下一句之后又被拿起，末态锚点不是最后变化', () => {
  const candidate = '甲把钥匙留在桌上，临走又抓起钥匙。';
  const verdict = verifyRefinementStateFact(
    {
      key: 'holding',
      value: '钥匙留在桌上',
      sourceBlockId: 'b0',
      anchorQuote: '把钥匙留在桌上',
      exitAnchorQuote: '把钥匙留在桌上',
    },
    { candidate, original: '甲把钥匙留在桌上。' }
  );
  assert.equal(verdict.status, 'superseded');
});

test('B2 末尾对白中的状态陈述不等于叙述末态', () => {
  const candidate = '甲收拾好东西。“钥匙我放桌上了。”他说。';
  assert.equal(
    verifyRefinementStateFact(
      {
        key: 'holding',
        value: '钥匙我放桌上了',
        sourceBlockId: 'b0',
        anchorQuote: '钥匙我放桌上了',
        exitAnchorQuote: '钥匙我放桌上了',
      },
      { candidate, original: '甲把钥匙放在桌上。' }
    ).status,
    'ambiguous'
  );
});

test('B2 原文与候选相反：候选不含该状态且原文含 → 历史证据，不传播', () => {
  const original = '甲拿着钥匙入场。';
  const candidate = '甲把钥匙留在桌上，独自走出门。';
  assert.equal(
    verifyRefinementStateFact(
      {
        key: 'holding',
        value: '拿着钥匙',
        sourceBlockId: 'b0',
        anchorQuote: '甲拿着钥匙入场',
        exitAnchorQuote: '甲拿着钥匙入场',
      },
      { candidate, original }
    ).status,
    'historical'
  );
});

test('B2 事实自标不确定 / 自报后续变化：不进入确定状态集合', () => {
  const candidate = '甲拿着钥匙入场，散场时把钥匙留在桌上。';
  assert.equal(
    verifyRefinementStateFact(
      {
        key: 'holding',
        value: '拿着钥匙',
        sourceBlockId: 'b0',
        anchorQuote: '甲拿着钥匙入场',
        exitEvidence: {
          exitAnchorQuote: '甲拿着钥匙入场',
          basis: 'exit_confirmation',
          uncertain: true,
        },
      },
      { candidate, original: candidate }
    ).status,
    'ambiguous'
  );
  assert.equal(
    verifyRefinementStateFact(
      {
        key: 'holding',
        value: '拿着钥匙',
        sourceBlockId: 'b0',
        anchorQuote: '甲拿着钥匙入场',
        exitEvidence: {
          exitAnchorQuote: '甲拿着钥匙入场',
          basis: 'last_change',
          supersededBy: '散场时把钥匙留在桌上',
        },
      },
      { candidate, original: candidate }
    ).status,
    'superseded'
  );
});

test('B2 末态锚点重复/唯一由程序定位，不采信模型标注', () => {
  const candidate = '屋内寂静无声。他站在屋内。';
  // 锚点在候选末尾之外还出现过一次 → 位置不唯一
  assert.equal(
    verifyRefinementStateFact(
      {
        key: 'place',
        value: '屋内',
        sourceBlockId: 'b1',
        anchorQuote: '屋内',
        exitAnchorQuote: '屋内',
      },
      { candidate, original: '他推开门，屋内一片寂静。' }
    ).status,
    'ambiguous'
  );
  // 唯一出现在末尾 → 可定位，程序给出偏移
  const unique = verifyRefinementStateFact(
    {
      key: 'place',
      value: '屋内',
      sourceBlockId: 'b1',
      anchorQuote: '屋内',
      exitAnchorQuote: '他站在屋内',
    },
    { candidate, original: '他推开门，屋内一片寂静。' }
  );
  assert.equal(unique.status, 'evidence');
  assert.equal(candidate.slice(unique.start, unique.end), '他站在屋内');
});

// ── F6：完整输入的保守预算与最终检查分组 ───────────────────────────────

test('F6 调用预算按完整输入 + 预期输出夹逼，输入超限即拒绝而非裁剪', () => {
  const ok = resolveRefinementCallBudget({ promptChars: 4_000, desiredOutputChars: 4_000 });
  assert.equal(ok.ok, true);
  assert.ok((ok.maxTokens ?? 0) >= 1024);

  // 完整输入本身超出上下文窗口 → 明确拒绝（不得裁剪用户要求 / 必要事实 / 目标原文）
  const rejected = resolveRefinementCallBudget({ promptChars: 200_000, desiredOutputChars: 4_000 });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.reason);

  // 自定义小上下文：可用余量不足 1024 即拒绝
  const tiny = resolveRefinementCallBudget({
    promptChars: 1_000,
    desiredOutputChars: 1_000,
    contextTokens: 2_000,
  });
  assert.equal(tiny.ok, false);
});

test('C2 必要输出同时受上下文余量与单次输出上限约束，装不下即拒绝（不静默裁剪）', () => {
  // 上下文足够（可用余量远大于必要输出），但单次输出上限不足 → 必须拒绝
  const outputCapRejected = resolveRefinementCallBudget({
    promptChars: 1_000,
    desiredOutputChars: 1,
    requiredOutputTokens: 9_000,
    contextTokens: 64_000,
    maxOutputTokens: 8_192,
  });
  assert.equal(outputCapRejected.ok, false);
  assert.match(outputCapRejected.reason ?? '', /单次输出上限/);

  // 装得下 → 返回恰好等于必要输出，不再被夹逼裁剪
  const fits = resolveRefinementCallBudget({
    promptChars: 1_000,
    desiredOutputChars: 1,
    requiredOutputTokens: 6_000,
    contextTokens: 64_000,
    maxOutputTokens: 8_192,
  });
  assert.deepEqual(fits, { ok: true, maxTokens: 6_000 });
});

test('C2 模型能力按 provider+model 解析：已知 provider 的未知 model 不猜测', () => {
  assert.deepEqual(
    resolveRefinementModelCapability({ provider: 'deepseek', model: 'deepseek-chat' }),
    { contextTokens: 64_000, maxOutputTokens: 8_192 }
  );
  // 已知 provider 但未登记 model（含大/小容量差异）→ 不可判断，不得回落到 provider 级猜测值
  assert.equal(
    resolveRefinementModelCapability({ provider: 'deepseek', model: 'unknown-small-model' }),
    null
  );
  // 缺 model 同样不可判断
  assert.equal(resolveRefinementModelCapability({ provider: 'deepseek' }), null);
  // 完全未知 provider
  assert.equal(resolveRefinementModelCapability({ provider: 'unknown-vendor', model: 'x' }), null);
  // 大小写不敏感匹配 provider
  assert.deepEqual(
    resolveRefinementModelCapability({ provider: 'DeepSeek', model: 'deepseek-chat' }),
    { contextTokens: 64_000, maxOutputTokens: 8_192 }
  );
});

test('V4 Pro 能力精确登记且保留上下文与单次输出预算门禁', () => {
  const capability = resolveRefinementModelCapability({
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
  });
  assert.deepEqual(capability, { contextTokens: 1_000_000, maxOutputTokens: 393_216 });
  assert.equal(
    resolveRefinementModelCapability({ provider: 'siliconflow', model: 'deepseek-v4-pro' }),
    null
  );
  assert.equal(
    resolveRefinementModelCapability({ provider: 'deepseek', model: 'deepseek-v4-pro-unknown' }),
    null
  );
  assert.deepEqual(
    resolveRefinementCallBudget({
      promptChars: 30_000,
      desiredOutputChars: 6_556,
      requiredOutputTokens: 4_096,
      ...capability!,
    }),
    { ok: true, maxTokens: 4_096 }
  );
  assert.equal(
    resolveRefinementCallBudget({
      promptChars: 1_000_000,
      desiredOutputChars: 0,
      requiredOutputTokens: 4_096,
      ...capability!,
    }).ok,
    false
  );
  assert.equal(
    resolveRefinementCallBudget({
      promptChars: 1_000,
      desiredOutputChars: 0,
      requiredOutputTokens: 393_217,
      ...capability!,
    }).ok,
    false
  );
});

test('F6 最终检查按字符预算分组，超预算范围自成一组不被裁剪', () => {
  const groups = groupRefinementRangesByBudget([1, 2, 3, 4, 5], (n) => n * 10, 50);
  assert.deepEqual(groups, [[1, 2], [3], [4], [5]]);
  // 顺序与完整性保持
  assert.deepEqual(groups.flat(), [1, 2, 3, 4, 5]);
  // 单个超预算项自成一组，不被切分
  assert.deepEqual(
    groupRefinementRangesByBudget([1, 9, 2], (n) => n * 10, 50),
    [[1], [9], [2]]
  );
});

// ── plan 必要输出预算：随合并场景数与事实/引文规模增长，非固定 4096 ──────

test('plan 输出预算：空场景下限 4096，随场景数与事实引文规模增长', () => {
  // 空场景列表：估算 < 4096，被下限钳制到 4096（与历史固定预算一致）
  assert.equal(resolveRefinementPlanOutputTokens([], []), 4_096);

  // 单场景、无事实：base + 1 scene + 若干 block id + 1 check，仍 < 4096 → 钳到 4096
  const singleBlock = buildRefinementSourceBlocks('甲。');
  const singleScene: RefinementMergedScene = {
    sceneId: 'scene-1',
    windowIds: ['w0'],
    startBlockIndex: 0,
    endBlockIndex: singleBlock.length,
    startOffset: 0,
    endOffset: singleBlock[0].endOffset,
    confidence: 'high',
    startsNewScene: true,
    goals: ['g'],
    fragments: [
      {
        startBlockId: 'b0',
        endBlockId: 'b0',
        startsNewScene: true,
        confidence: 'high',
        goal: 'g',
        entryFacts: [],
        exitFacts: [],
        proposedBeatEnds: [],
      },
    ],
  };
  assert.equal(resolveRefinementPlanOutputTokens(singleBlock, [singleScene]), 4_096);

  // 多场景 + 长引文事实：估算显著超过 4096，体现按合同规模增长
  const manyBlocks = buildRefinementSourceBlocks(
    Array.from({ length: 60 }, (_, i) => `第${i}段正文内容。`).join('\n\n')
  );
  const longQuote = '她伸手解开衣领，露出锁骨下一片莹白。'.repeat(20);
  const manyScenes: RefinementMergedScene[] = Array.from({ length: 30 }, (_, i) => ({
    sceneId: `scene-${i + 1}`,
    windowIds: ['w0'],
    startBlockIndex: i * 2,
    endBlockIndex: Math.min(i * 2 + 2, manyBlocks.length),
    startOffset: 0,
    endOffset: manyBlocks[Math.min(i * 2 + 1, manyBlocks.length - 1)].endOffset,
    confidence: 'high',
    startsNewScene: true,
    goals: ['g'],
    fragments: [
      {
        startBlockId: 'b0',
        endBlockId: 'b1',
        startsNewScene: true,
        confidence: 'high',
        goal: 'g',
        entryFacts: [
          { key: 'clothing', value: '解开衣领', sourceBlockId: 'b0', anchorQuote: longQuote },
        ],
        exitFacts: [],
        proposedBeatEnds: [],
      },
    ],
  }));
  const multi = resolveRefinementPlanOutputTokens(manyBlocks, manyScenes);
  assert.ok(multi > 4_096, `多场景估算应超过 4096，实际 ${multi}`);
  // 上限钳制
  assert.ok(multi <= 65_536, `不应超过上限 65536，实际 ${multi}`);
});

// ── F2：回填与校验都必须限定在允许的证据范围内（禁止跨场取证） ──────────

const F2_TWO_SCENE_TEXT = '甲握着钥匙。\n\n乙站在院中。';

function twoSceneSetup(): {
  blocks: RefinementSourceBlock[];
  scenes: RefinementMergedScene[];
} {
  const blocks = buildRefinementSourceBlocks(F2_TWO_SCENE_TEXT);
  const scene = (
    sceneId: string,
    blockIndex: number,
    entryFacts: Array<{ key: string; value: string; sourceBlockId: string; anchorQuote: string }>
  ): RefinementMergedScene => ({
    sceneId,
    windowIds: ['w0'],
    startBlockIndex: blockIndex,
    endBlockIndex: blockIndex + 1,
    startOffset: blocks[blockIndex]!.startOffset,
    endOffset: blocks[blockIndex]!.endOffset,
    confidence: 'high',
    startsNewScene: true,
    goals: [],
    fragments: [
      {
        startBlockId: blocks[blockIndex]!.id,
        endBlockId: blocks[blockIndex]!.id,
        startsNewScene: true,
        confidence: 'high',
        goal: '',
        entryFacts,
        exitFacts: [],
        proposedBeatEnds: [],
      },
    ],
  });
  return {
    blocks,
    scenes: [
      scene('scene-1', 0, [
        { key: 'key', value: '钥匙', sourceBlockId: 'b0', anchorQuote: '钥匙' },
      ]),
      scene('scene-2', 1, []),
    ],
  };
}

test('F2 场景内事实不得从其它场景复制证据（跨场取证）', () => {
  const { blocks, scenes } = twoSceneSetup();
  const brief1 = {
    ...makeSceneBrief('scene-1', ['b0'], 'rewrite'),
    entryFacts: [{ key: 'key', value: '钥匙', sourceBlockId: 'b0', anchorQuote: '钥匙' }],
  };
  // scene-2 只允许 b1，但声明了只在 b0 有证据的同值事实且缺来源字段
  const brief2 = {
    ...makeSceneBrief('scene-2', ['b1'], 'rewrite'),
    entryFacts: [{ key: 'key', value: '钥匙' }],
  };
  const plan = {
    chapterIntent: '精简',
    protectedFacts: [],
    sceneBriefs: [brief1, brief2],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });

  assert.ok(
    recovery.violations.some(
      (v) => v.kind === 'missing_fact_source' && v.path.includes('sceneBriefs[1]')
    ),
    '跨场取证必须记为违规'
  );
  assert.equal(
    recovery.backfilled.some((b) => b.path.includes('sceneBriefs[1]')),
    false,
    '不得从其它场景回填证据'
  );
});

test('F2 场景内事实可在本场景允许范围内确定性回填', () => {
  const { blocks, scenes } = twoSceneSetup();
  const brief1 = {
    ...makeSceneBrief('scene-1', ['b0'], 'rewrite'),
    entryFacts: [{ key: 'key', value: '钥匙' }],
  };
  const brief2 = makeSceneBrief('scene-2', ['b1'], 'keep');
  const plan = { chapterIntent: '精简', protectedFacts: [], sceneBriefs: [brief1, brief2] };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });

  assert.equal(recovery.violations.length, 0);
  const filled = recovery.backfilled.find((b) => b.path === 'sceneBriefs[0].entryFacts[0]');
  assert.ok(filled);
  assert.equal(filled?.sourceBlockId, 'b0');
  assert.equal(
    (recovery.brief?.sceneBriefs[0].entryFacts[0] as { sourceBlockId?: string } | undefined)
      ?.sourceBlockId,
    'b0'
  );
});

test('F2 场景内事实的证据 block 不属于本场景范围：记 fact_out_of_scope', () => {
  const { blocks, scenes } = twoSceneSetup();
  const brief1 = {
    ...makeSceneBrief('scene-1', ['b0'], 'rewrite'),
    entryFacts: [{ key: 'key', value: '钥匙', sourceBlockId: 'b0', anchorQuote: '钥匙' }],
  };
  const brief2 = {
    ...makeSceneBrief('scene-2', ['b1'], 'rewrite'),
    entryFacts: [{ key: 'key', value: '钥匙', sourceBlockId: 'b0', anchorQuote: '钥匙' }],
  };
  const plan = { chapterIntent: '精简', protectedFacts: [], sceneBriefs: [brief1, brief2] };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });

  assert.ok(
    recovery.violations.some(
      (v) => v.kind === 'fact_out_of_scope' && v.path.includes('sceneBriefs[1]')
    )
  );
});

test('F2 全章保护事实允许全文范围回填（合法跨范围只读依赖）', () => {
  const { blocks, scenes } = twoSceneSetup();
  const brief1 = {
    ...makeSceneBrief('scene-1', ['b0'], 'keep'),
    entryFacts: [{ key: 'key', value: '钥匙', sourceBlockId: 'b0', anchorQuote: '钥匙' }],
  };
  const brief2 = makeSceneBrief('scene-2', ['b1'], 'keep');
  const plan = {
    chapterIntent: '精简',
    protectedFacts: [{ key: 'key', value: '钥匙' }],
    sceneBriefs: [brief1, brief2],
  };

  const recovery = parsePlanOutputWithRecovery({ raw: JSON.stringify(plan), blocks, scenes });

  assert.equal(recovery.violations.length, 0);
  assert.equal(
    (recovery.brief?.protectedFacts[0] as { sourceBlockId?: string } | undefined)?.sourceBlockId,
    'b0'
  );
});

test('R2 同句后续转移：锚点所在句的后半句不得被整体跳过', () => {
  // 中性复现正文：同一句内先拿钥匙、后把钥匙放下，句中没有逗号分隔
  const candidate = '甲手里拿着钥匙走到门边后把钥匙放在桌上。';
  const anchor = '甲手里拿着钥匙';
  const result = verifyRefinementStateFact(
    {
      key: 'holding',
      value: '拿着钥匙',
      sourceBlockId: 'b0',
      anchorQuote: anchor,
      exitAnchorQuote: anchor,
    },
    { candidate, original: candidate }
  );
  assert.equal(
    result.status,
    'superseded',
    '锚点后的同句剩余部分仍有同一状态的后续变化，不得判为确定末态'
  );
});

test('R2 同句剩余部分无关变化时仍确认末态（不因修复过度拦截）', () => {
  const candidate = '他把门打开后走进屋内。';
  const anchor = '他把门打开';
  const result = verifyRefinementStateFact(
    {
      key: 'door',
      value: '把门打开',
      sourceBlockId: 'b0',
      anchorQuote: anchor,
      exitAnchorQuote: anchor,
    },
    { candidate, original: candidate }
  );
  assert.equal(result.status, 'evidence');
});

test('R2 自报后续变化须校验位置在锚点之后', () => {
  const candidate = '散场时把钥匙留在桌上，甲拿着钥匙入场。';
  const anchor = '甲拿着钥匙入场';
  // 模型自报的后续变化实际出现在锚点之前：位置无法证实，按不确定处理
  assert.equal(
    verifyRefinementStateFact(
      {
        key: 'holding',
        value: '拿着钥匙',
        sourceBlockId: 'b0',
        anchorQuote: anchor,
        exitEvidence: {
          exitAnchorQuote: anchor,
          basis: 'last_change',
          supersededBy: '散场时把钥匙留在桌上',
        },
      },
      { candidate, original: candidate }
    ).status,
    'ambiguous'
  );
  // 位置确实在锚点之后：按自报判为已取代
  const ordered = '甲拿着钥匙入场，散场时把钥匙留在桌上。';
  assert.equal(
    verifyRefinementStateFact(
      {
        key: 'holding',
        value: '拿着钥匙',
        sourceBlockId: 'b0',
        anchorQuote: anchor,
        exitEvidence: {
          exitAnchorQuote: anchor,
          basis: 'last_change',
          supersededBy: '散场时把钥匙留在桌上',
        },
      },
      { candidate: ordered, original: ordered }
    ).status,
    'superseded'
  );
});
