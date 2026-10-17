import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_PLAN_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REWRITE_SYSTEM_PROMPT,
} from './chapter-refinement.util';
import {
  OrchestratedRefinementEngine,
  type RefinementEngineStageEvent,
} from './chapter-refinement.engine';
import type {
  RefinementGenerationGateway,
  RefinementGenerationRequest,
  RefinementGenerationResult,
} from './chapter-refinement.gateway';
import {
  createInitialRefinementCheckpoint,
  resolveRefinementPolicy,
  type RefinementCheckpoint,
  type RefinementRunRecord,
} from './chapter-refinement.types';

const BASE_TEXT = [
  '夜幕降临，城中灯火次第亮起。',
  '',
  '他推开门，屋内一片寂静。',
  '',
  '远处传来打更声。',
].join('\n');

const INSPECT_OK = JSON.stringify({
  windowId: 'w0',
  sceneFragments: [
    {
      startBlockId: 'b0',
      endBlockId: 'b2',
      startsNewScene: true,
      confidence: 'high',
      goal: '交代归来与夜境',
      entryFacts: [],
      exitFacts: [],
      proposedBeatEnds: [],
    },
  ],
  issues: [],
});

const PLAN_REWRITE = JSON.stringify({
  chapterIntent: '收紧节奏，强化归来时的落寞',
  protectedFacts: [{ key: 'time', value: '夜幕', sourceBlockId: 'b0', anchorQuote: '夜幕' }],
  sceneBriefs: [
    {
      sceneId: 's1',
      sourceBlockIds: ['b0', 'b1', 'b2'],
      decision: 'rewrite',
      reason: '铺陈偏散',
      editIntent: '合并三段为一段连贯动作',
      expectedChange: '三段并作一段',
      entryFacts: [],
      exitFacts: [],
      protectedSpanIds: [],
      targetLength: { direction: 'condense' },
      checks: [],
    },
  ],
});

const REWRITE_OK = '夜幕降临，城中灯火次第亮起。他推门而入，屋内寂静无声，远处打更声隐约传来。';
const REVIEW_OK = JSON.stringify({ issues: [], exitStateFacts: [] });

function makeRecord(overrides: Partial<RefinementRunRecord> = {}): RefinementRunRecord {
  return {
    runId: 'run-1',
    projectId: 'p1',
    chapterNo: 3,
    creatorId: 'u1',
    clientRequestId: 'c1',
    payloadHash: 'h1',
    status: 'running',
    phase: 'reading',
    revision: 2,
    attemptId: 'a1',
    pauseReason: null,
    resumable: false,
    baseUpdatedAt: '2026-10-06T00:00:00.000Z',
    baseHash: 'base-hash',
    rewritePolicy: 'preserve-plot',
    snapshot: {
      instruction: '收紧节奏，减少解释性叙述',
      baseTitle: '第三章',
      baseText: BASE_TEXT,
      systemPromptText: '项目系统提示',
      templateVersions: [],
      modelRoute: null,
      resolvedPolicy: resolveRefinementPolicy({}),
      frozenAt: '2026-10-06T00:00:00.000Z',
    },
    checkpoint: createInitialRefinementCheckpoint(BASE_TEXT),
    tombstone: false,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:10.000Z',
    expiresAt: '2026-10-13T00:00:00.000Z',
    ...overrides,
  };
}

interface ScriptedGateway {
  gateway: RefinementGenerationGateway;
  requests: RefinementGenerationRequest[];
}

/** 按 templateKey 依次返回脚本化结果；未登记的 key 视为上游失败。 */
function makeGateway(
  handler: (request: RefinementGenerationRequest) => Partial<RefinementGenerationResult>
): ScriptedGateway {
  const requests: RefinementGenerationRequest[] = [];
  return {
    requests,
    gateway: {
      async generate(request) {
        requests.push(request);
        const result = handler(request);
        return {
          ok: result.ok ?? true,
          text: result.text ?? '',
          traceId: result.traceId ?? 'trace-1',
          aborted: result.aborted ?? false,
          ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
          ...(result.completionFailure ? { completionFailure: result.completionFailure } : {}),
        };
      },
    },
  };
}

function scriptByKey(map: Record<string, Partial<RefinementGenerationResult>>) {
  return (request: RefinementGenerationRequest): Partial<RefinementGenerationResult> =>
    map[request.templateKey] ?? { ok: false, errorMessage: `no script for ${request.templateKey}` };
}

/** 从 inspect prompt 中取出诊断窗 id，便于按窗返回不同的脚本化结果。 */
function inspectWindowId(prompt: string): string {
  return prompt.match(/<diagnosis-window id="([^"]+)"/)?.[1] ?? '';
}

test('AQ-383 inspect 无原文证据时有界重试并暂停，不启动 plan 或缓存无效事实', async () => {
  const invalid = JSON.parse(INSPECT_OK);
  invalid.sceneFragments[0].entryFacts = [
    { key: '地点', value: '塔顶', sourceBlockId: 'b0', anchorQuote: '他站在塔顶。' },
  ];
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: JSON.stringify(invalid) },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );
  const result = await new OrchestratedRefinementEngine(gateway).run({
    record: makeRecord(),
    signal: new AbortController().signal,
    onStage: async () => {},
  });
  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'invalid_model_output');
  assert.ok(result.checkpoint.progress.message.includes('地点'));
  assert.ok(result.checkpoint.progress.message.includes('引文'));
  assert.deepEqual(
    requests.map((item) => item.templateKey),
    [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY, CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]
  );
  assert.equal(result.checkpoint.diagnosis?.inspections.length ?? 0, 0);
});

test('AQ-383 第二窗借用只读邻文证据：重试携带错误，修正后继续且不重跑首窗', async () => {
  const text = '甲拿着钥匙。\n甲推开门。';
  const record = makeRecord();
  record.snapshot.baseText = text;
  record.snapshot.resolvedPolicy.diagnosisTargetChars = 7;
  record.checkpoint = createInitialRefinementCheckpoint(text);
  let secondWindowCalls = 0;
  const { gateway, requests } = makeGateway((request) => {
    if (request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY) {
      const windowId = inspectWindowId(request.prompt);
      const isSecond = windowId === 'w1';
      if (isSecond) secondWindowCalls += 1;
      const corrected = !isSecond || request.prompt.includes('上一版诊断未通过校验');
      const inspection = {
        windowId,
        issues: [],
        sceneFragments: [
          {
            startBlockId: isSecond ? 'b1' : 'b0',
            endBlockId: isSecond ? 'b1' : 'b0',
            startsNewScene: !isSecond,
            confidence: 'high',
            goal: '开门',
            proposedBeatEnds: [],
            entryFacts: corrected
              ? []
              : [{ key: '钥匙', value: '持有', sourceBlockId: 'b1', anchorQuote: '甲拿着钥匙。' }],
            exitFacts: [],
          },
        ],
      };
      return { text: JSON.stringify(inspection) };
    }
    if (request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY) {
      const plan = JSON.parse(PLAN_REWRITE);
      plan.protectedFacts = [];
      plan.sceneBriefs[0].sourceBlockIds = ['b0', 'b1'];
      plan.sceneBriefs[0].decision = 'keep';
      return { text: JSON.stringify(plan) };
    }
    return { ok: false, errorMessage: 'unexpected call' };
  });
  const { result } = await runEngine(gateway, record);
  assert.equal(result.status, 'ready');
  assert.equal(secondWindowCalls, 2);
  assert.equal(
    requests.filter(
      (request) =>
        request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY &&
        inspectWindowId(request.prompt) === 'w0'
    ).length,
    1
  );
  const retry = requests.filter((request) => inspectWindowId(request.prompt) === 'w1')[1];
  assert.ok(retry.prompt.includes('钥匙'));
  assert.ok(retry.prompt.includes('不得引用只读邻文'));
  assert.ok(retry.prompt.includes('<read-only-neighbor'));
  assert.equal(result.checkpoint.diagnosis?.completedWindows, 2);
});

test('AQ-383 plan 暂停后继续：合法同名首尾状态直接成稿，不重复 inspect 或误判降级', async () => {
  const unknown = { key: '声音', value: null };
  const confirmed = {
    key: '声音',
    value: '打更声',
    sourceBlockId: 'b2',
    anchorQuote: '远处传来打更声。',
  };
  const inspection = JSON.parse(INSPECT_OK);
  inspection.sceneFragments[0].entryFacts = [unknown];
  inspection.sceneFragments[0].exitFacts = [confirmed];
  const plan = JSON.parse(PLAN_REWRITE);
  plan.protectedFacts = [];
  plan.sceneBriefs[0].entryFacts = [unknown];
  plan.sceneBriefs[0].exitFacts = [confirmed];
  const record = makeRecord({ phase: 'planning' });
  record.checkpoint.diagnosis = { completedWindows: 1, inspections: [inspection] };
  record.checkpoint.usage.callCount = 9;
  record.checkpoint.issues = [
    {
      id: 'old-plan-error',
      category: 'coverage',
      severity: 'high',
      disposition: 'unresolved',
      message: 'plan 合同违规（fact_downgraded）：同名状态',
    },
  ];
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: JSON.stringify(inspection) },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: JSON.stringify(plan) },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );
  const { result } = await runEngine(gateway, record);
  assert.equal(result.status, 'ready');
  assert.equal(result.checkpoint.acceptedDraftText, REWRITE_OK);
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY)
      .length,
    1
  );
  assert.equal(
    requests.some((request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY),
    false
  );
  assert.ok(!result.checkpoint.issues.some((issue) => issue.message.includes('fact_downgraded')));
});

async function runEngine(
  gateway: RefinementGenerationGateway,
  record: RefinementRunRecord,
  signal?: AbortSignal,
  options?: { onCheckpoint?: (checkpoint: RefinementCheckpoint) => void; now?: () => number }
) {
  const engine = new OrchestratedRefinementEngine(gateway);
  const stages: RefinementEngineStageEvent[] = [];
  const result = await engine.run({
    record,
    signal: signal ?? new AbortController().signal,
    onStage: (event) => {
      stages.push(event);
    },
    ...(options?.onCheckpoint ? { onCheckpoint: options.onCheckpoint } : {}),
    ...(options?.now ? { now: options.now } : {}),
  });
  return { result, stages };
}

function factContractFixture() {
  const text = '甲站在门口。\n甲走到窗边。\n甲坐到桌前。';
  const fact = (value: string, sourceBlockId: string, anchorQuote: string) => ({
    key: '甲的位置',
    value,
    sourceBlockId,
    anchorQuote,
  });
  const middle = fact('窗边', 'b1', '甲走到窗边。');
  const inspection = JSON.stringify({
    windowId: 'w0',
    issues: [],
    sceneFragments: [
      {
        startBlockId: 'b0',
        endBlockId: 'b1',
        startsNewScene: true,
        confidence: 'high',
        goal: '移动',
        entryFacts: [fact('门口', 'b0', '甲站在门口。')],
        exitFacts: [middle],
        proposedBeatEnds: [],
      },
      {
        startBlockId: 'b2',
        endBlockId: 'b2',
        startsNewScene: false,
        confidence: 'high',
        goal: '落座',
        entryFacts: [],
        exitFacts: [fact('桌前', 'b2', '甲坐到桌前。')],
        proposedBeatEnds: [],
      },
    ],
  });
  const plan = JSON.parse(PLAN_REWRITE);
  plan.protectedFacts = [];
  plan.sceneBriefs[0].entryFacts = [];
  plan.sceneBriefs[0].exitFacts = [];
  plan.sceneBriefs[0].targetLength = { direction: 'hold' };
  const record = makeRecord();
  record.snapshot.baseText = text;
  record.checkpoint = createInitialRefinementCheckpoint(text);
  return { text, middle, inspection, plan: JSON.stringify(plan), record };
}

test('AQ-383 引擎继承遗漏边界并把过程事实传至规划、改写、单位和最终复查', async () => {
  const fixture = factContractFixture();
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: fixture.inspection },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: fixture.plan },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: fixture.text },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );
  const { result } = await runEngine(gateway, fixture.record);
  assert.equal(result.status, 'ready');
  assert.equal(
    requests.filter((item) => item.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY).length,
    1
  );
  assert.equal(result.checkpoint.planRecovery?.backfillCount, 1);
  const planRequest = requests.find(
    (item) => item.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY
  )!;
  assert.ok(planRequest.prompt.includes('已验证事实角色索引'));
  for (const request of requests.filter((item) =>
    [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY, CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY].includes(
      item.templateKey
    )
  )) {
    assert.ok(request.prompt.includes('必要过程事实（不是首尾状态）'));
    assert.ok(request.prompt.includes('甲走到窗边。'));
  }
});

test('AQ-383 旧改写 checkpoint 复验诊断，拒绝无效证据且不调用模型', async () => {
  const fixture = factContractFixture();
  const first = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: fixture.inspection },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: fixture.plan },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { ok: false, completionFailure: 'truncated' },
    })
  );
  const firstRecord = structuredClone(fixture.record);
  firstRecord.snapshot.resolvedPolicy.maxCallsPerAttempt = 2;
  const paused = await runEngine(first.gateway, firstRecord);
  assert.ok(paused.result.checkpoint.resumeState);
  const checkpoint = structuredClone(paused.result.checkpoint);
  checkpoint.diagnosis!.inspections[0].sceneFragments[0].entryFacts[0] = {
    key: '甲的位置',
    value: '塔顶',
    sourceBlockId: 'b0',
    anchorQuote: '甲站在塔顶。',
  };
  const resumed = makeGateway(() => ({ text: fixture.text }));
  const { result } = await runEngine(resumed.gateway, { ...fixture.record, checkpoint });
  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'invalid_model_output');
  assert.equal(resumed.requests.length, 0);
});

test('AQ-383 旧改写 checkpoint 从有效诊断恢复过程事实，不重跑 inspect 和 plan', async () => {
  const fixture = factContractFixture();
  const first = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: fixture.inspection },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: fixture.plan },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { ok: false, completionFailure: 'truncated' },
    })
  );
  const firstRecord = structuredClone(fixture.record);
  firstRecord.snapshot.resolvedPolicy.maxCallsPerAttempt = 2;
  const paused = await runEngine(first.gateway, firstRecord);
  const checkpoint = structuredClone(paused.result.checkpoint);
  assert.ok(checkpoint.resumeState);
  for (const unit of checkpoint.resumeState.units) {
    if (unit.brief) delete unit.brief.processFacts;
  }
  const resumed = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: fixture.text },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );
  const { result } = await runEngine(resumed.gateway, { ...fixture.record, checkpoint });
  assert.equal(result.status, 'ready');
  assert.ok(
    resumed.requests.every(
      (item) =>
        item.templateKey !== CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY &&
        item.templateKey !== CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY
    )
  );
  assert.ok(resumed.requests[0].prompt.includes('甲走到窗边。'));
  assert.ok(resumed.requests[0].prompt.includes('必要过程事实（不是首尾状态）'));
});

test('AQ-383 合并后诊断事实跨场：受控暂停而非抛出未处理异常', async () => {
  const fixture = factContractFixture();
  const inspection = JSON.parse(fixture.inspection);
  inspection.sceneFragments[1].startsNewScene = true;
  inspection.sceneFragments[0].exitFacts = inspection.sceneFragments[1].exitFacts;
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: JSON.stringify(inspection) },
    })
  );
  const { result } = await runEngine(gateway, fixture.record);
  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'invalid_model_output');
  assert.ok(requests.every((item) => item.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY));
});

test('单场竖切：inspect→plan→rewrite→review 通过后产出完整候选', async () => {
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const { result, stages } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready');
  assert.equal(result.phase, 'finished');
  assert.equal(result.resumable, false);
  assert.equal(result.checkpoint.acceptedDraftText, REWRITE_OK);
  assert.deepEqual(
    requests.map((request) => request.templateKey),
    [
      CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
      CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
      CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
      CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
      CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
    ]
  );
  assert.deepEqual(
    stages.map((stage) => stage.phase),
    ['reading', 'reading', 'planning', 'rewriting', 'verifying', 'verifying', 'finished']
  );
  assert.equal(result.checkpoint.changes.length, 1);
  assert.equal(result.checkpoint.coverage.processedChars, BASE_TEXT.length);
});

test('决策为 keep 时不调用改写，候选逐码元等于冻结原文', async () => {
  const keepPlan = JSON.stringify({
    chapterIntent: '保持原样',
    protectedFacts: [],
    sceneBriefs: [
      {
        sceneId: 's1',
        sourceBlockIds: ['b0', 'b1', 'b2'],
        decision: 'keep',
        reason: '已达标',
        editIntent: '',
        expectedChange: '',
        entryFacts: [],
        exitFacts: [],
        protectedSpanIds: [],
        targetLength: { direction: 'hold' },
        checks: [],
      },
    ],
  });
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: keepPlan },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready');
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  assert.equal(result.checkpoint.changes.length, 0);
  assert.equal(
    requests.some((request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY),
    false
  );
});

test('冻结的模板文本覆盖运行时默认，缺失时回退仓库默认', async () => {
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const record = makeRecord();
  record.snapshot.templateTexts = {
    [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: 'FROZEN-INSPECT',
    [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: 'FROZEN-REWRITE',
  };
  await runEngine(gateway, record);

  const inspectRequest = requests.find(
    (request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY
  );
  const planRequest = requests.find(
    (request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY
  );
  const rewriteRequest = requests.find(
    (request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY
  );
  assert.equal(inspectRequest?.systemPromptText, 'FROZEN-INSPECT');
  assert.equal(rewriteRequest?.systemPromptText, 'FROZEN-REWRITE');
  // 未冻结的 key 回退仓库默认：utility 阶段用诊断/规划默认文本，不含写作指导
  assert.equal(planRequest?.systemPromptText, CHAPTER_REFINEMENT_PLAN_SYSTEM_PROMPT);
  assert.equal(planRequest?.systemPromptText.includes('改写当前范围'), false);
  // writing 阶段使用冻结指导，未冻结时用仓库改写默认文本
  assert.equal(CHAPTER_REFINEMENT_REWRITE_SYSTEM_PROMPT.includes('改写当前范围'), true);
  assert.equal(rewriteRequest?.maxTokens && rewriteRequest.maxTokens > 0, true);
});

test('程序门禁空输出：保留原文并标记 ready_with_issues', async () => {
  const { gateway } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: '   ' },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready_with_issues');
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  assert.equal(
    result.checkpoint.issues.some((issue) => issue.category === 'hard_constraint'),
    true
  );
});

test('程序门禁占位语：候选含占位语时拒绝并保留原文', async () => {
  const { gateway } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: '（此处省略）他推门而入。' },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready_with_issues');
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
});

test('事实引文被改写不触发程序门禁：首尾事实/锁定事实是语义检查，不是逐字锁', async () => {
  // 改写输出丢失 protectedFacts 的「夜幕」引文；事实语义由 review 负责，程序不得据此拒绝
  const { gateway } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: {
        text: '灯火次第亮起。他推门而入，屋内寂静无声，远处打更声隐约传来。',
      },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready');
  assert.equal(
    result.checkpoint.acceptedDraftText,
    '灯火次第亮起。他推门而入，屋内寂静无声，远处打更声隐约传来。'
  );
  assert.equal(result.checkpoint.changes.length, 1);
});

test('程序门禁逐字锁缺失：plan 标注的 protectedSpanIds 整块丢失时拒绝', async () => {
  const lockedPlan = JSON.stringify({
    chapterIntent: '收紧节奏',
    protectedFacts: [],
    sceneBriefs: [
      {
        sceneId: 's1',
        sourceBlockIds: ['b0', 'b1', 'b2'],
        decision: 'rewrite',
        reason: '铺陈偏散',
        editIntent: '合并三段',
        expectedChange: '并作一段',
        entryFacts: [],
        exitFacts: [],
        // b0 = 「夜幕降临，城中灯火次第亮起。」整块逐字保留
        protectedSpanIds: ['b0'],
        targetLength: { direction: 'condense' },
        checks: [],
      },
    ],
  });
  const { gateway } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: lockedPlan },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: '他推门而入，屋内寂静无声。' },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready_with_issues');
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  assert.equal(
    result.checkpoint.issues.some(
      (issue) => issue.category === 'hard_constraint' && issue.message.includes('逐字锁')
    ),
    true
  );
});

test('AQ-383 成稿收到当前单位逐字锁、章级语义事实和完整用户要求，避免未告知锁而退稿', async () => {
  const record = makeRecord();
  record.snapshot.instruction = '润色表达，保留日常铺垫，突出门内外声音的变化。';
  const lockedPlan = JSON.parse(PLAN_REWRITE);
  lockedPlan.sceneBriefs[0].protectedSpanIds = ['b0'];
  const lock = BASE_TEXT.split('\n')[0];
  const polished = `${lock}他推门而入。屋内静得听见衣袖擦过门框，远处打更声随门缝飘进来。`;
  const { gateway, requests } = makeGateway((request) => {
    if (request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY) {
      return { text: INSPECT_OK };
    }
    if (request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY) {
      return { text: JSON.stringify(lockedPlan) };
    }
    if (request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY) {
      // 模型依照收到的锁工作；不靠读原文猜哪一段不可改。
      const lockList = request.prompt.split('【逐字锁】\n')[1]?.split('\n')[0];
      const quotes = lockList ? JSON.parse(lockList) : [];
      return {
        text: quotes.includes(lock) ? polished : '天色暗下来。他推门而入，远处打更声传来。',
      };
    }
    return { text: REVIEW_OK };
  });
  const { result } = await runEngine(gateway, record);
  assert.equal(result.status, 'ready');
  assert.equal(result.checkpoint.acceptedDraftText, polished);
  assert.equal(result.checkpoint.coverage.retainedOriginalChars, 0);
  const rewrite = requests.find(
    (request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY
  )!;
  assert.ok(rewrite.prompt.includes(`【本轮精修要求】\n${record.snapshot.instruction}`));
  assert.ok(rewrite.prompt.includes(`【逐字锁】\n${JSON.stringify([lock])}`));
  assert.ok(rewrite.prompt.includes(`本章锁定事实：${JSON.stringify(lockedPlan.protectedFacts)}`));
  assert.ok(rewrite.prompt.includes('须保留语义，措辞可改'));
  const plan = requests.find(
    (request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY
  )!;
  assert.ok(plan.prompt.includes('protectedSpanIds'));
  assert.ok(plan.prompt.includes('整块原文逐字保留'));
  assert.ok(plan.prompt.includes('事实证据引文'));
});

test('逐字锁整块保留在候选时不拦截改写', async () => {
  const lockedPlan = JSON.stringify({
    chapterIntent: '收紧节奏',
    protectedFacts: [],
    sceneBriefs: [
      {
        sceneId: 's1',
        sourceBlockIds: ['b0', 'b1', 'b2'],
        decision: 'rewrite',
        reason: '铺陈偏散',
        editIntent: '合并三段',
        expectedChange: '并作一段',
        entryFacts: [],
        exitFacts: [],
        protectedSpanIds: ['b0'],
        targetLength: { direction: 'condense' },
        checks: [],
      },
    ],
  });
  const { gateway } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: lockedPlan },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready');
  assert.equal(result.checkpoint.acceptedDraftText, REWRITE_OK);
});

test('规划越界：boundaryConflict 触发 paused 并保留原文', async () => {
  const conflictPlan = JSON.stringify({
    boundaryConflict: { reason: 'cross_scene', detail: '要求把后文事件提前到本场' },
  });
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: conflictPlan },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'boundary_conflict');
  assert.equal(result.resumable, true);
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  assert.equal(
    requests.some((request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY),
    false
  );
});

test('inspect 输出不可解析：重试一次后暂停为 invalid_model_output', async () => {
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: '这不是 JSON' },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'invalid_model_output');
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY)
      .length,
    2
  );
});

test('上游失败重试一次后仍失败：暂停为 upstream_failure', async () => {
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { ok: false, errorMessage: '上游 502' },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'upstream_failure');
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY)
      .length,
    2
  );
});

test('改写输出未完整收束：不接受非空半成品，暂停并保留已接受前文', async () => {
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: {
        ok: false,
        text: '半截正文',
        completionFailure: 'truncated',
        errorMessage: '输出达到长度上限被截断，候选不可用',
      },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'upstream_failure');
  // 非空但未收束的内容不得进入候选
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  assert.equal(result.checkpoint.changes.length, 0);
  assert.equal(
    result.checkpoint.issues.some((issue) => issue.message.includes('未完整收束')),
    true
  );
  // 严格失败同样重试一次
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY)
      .length,
    2
  );
});

test('改写阶段被取消：暂停为 user_cancelled 且不产出候选', async () => {
  const { gateway } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { ok: false, aborted: true },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'user_cancelled');
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
});

test('预算耗尽：调用次数为 0 时立即暂停', async () => {
  const { gateway } = makeGateway(scriptByKey({}));
  const record = makeRecord();
  record.snapshot.resolvedPolicy = {
    ...record.snapshot.resolvedPolicy,
    maxCallsPerAttempt: 0,
  };

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'budget_exhausted');
});

test('未被场景覆盖的自然段由程序补 keep 单位，尾部逐码元保留', async () => {
  const baseText = 'AAAA\n\nBBBB\n\nCCCC';
  const record = makeRecord();
  record.snapshot.baseText = baseText;
  record.checkpoint = createInitialRefinementCheckpoint(baseText);
  record.snapshot.resolvedPolicy = {
    ...record.snapshot.resolvedPolicy,
    rewriteTargetChars: 4,
    rewriteMaxChars: 10,
  };

  const inspect = JSON.stringify({
    windowId: 'w0',
    sceneFragments: [
      {
        startBlockId: 'b0',
        endBlockId: 'b0',
        startsNewScene: true,
        confidence: 'high',
        goal: '起手',
        entryFacts: [],
        exitFacts: [],
        proposedBeatEnds: [],
      },
    ],
    issues: [],
  });
  const plan = JSON.stringify({
    chapterIntent: '精简起手',
    protectedFacts: [],
    sceneBriefs: [
      {
        sceneId: 's1',
        sourceBlockIds: ['b0'],
        decision: 'rewrite',
        reason: '啰嗦',
        editIntent: '压缩',
        expectedChange: '更短',
        entryFacts: [],
        exitFacts: [],
        protectedSpanIds: [],
        targetLength: { direction: 'condense' },
        checks: [],
      },
    ],
  });
  const { gateway } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: inspect },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: plan },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: 'aa' },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'ready_with_issues');
  assert.equal(result.checkpoint.acceptedDraftText, 'aa\n\nBBBB\n\nCCCC');
  assert.equal(result.checkpoint.changes[0]?.startOffset, 0);
  assert.equal(result.checkpoint.changes[0]?.endOffset, 4);
  // 未被场景覆盖的 b1/b2 有显式覆盖决策，且整章跨度全部计入已处理
  assert.equal(result.checkpoint.coverage.processedChars, baseText.length);
  assert.equal(
    result.checkpoint.issues.some((issue) => issue.category === 'coverage'),
    true
  );
});

test('整章多场景顺序改写：长度变化不漂移，后续单位收到已接受前文', async () => {
  const baseText = 'AAAA\n\nBBBB\n\nCCCC';
  const record = makeRecord();
  record.snapshot.baseText = baseText;
  record.checkpoint = createInitialRefinementCheckpoint(baseText);

  const inspect = JSON.stringify({
    windowId: 'w0',
    sceneFragments: ['b0', 'b1', 'b2'].map((blockId) => ({
      startBlockId: blockId,
      endBlockId: blockId,
      startsNewScene: true,
      confidence: 'high',
      goal: `推进 ${blockId}`,
      entryFacts: [],
      exitFacts: [],
      proposedBeatEnds: [],
    })),
    issues: [],
  });
  const sceneBriefSeeds: Array<[string, string]> = [
    ['scene-1', 'b0'],
    ['scene-2', 'b1'],
    ['scene-3', 'b2'],
  ];
  const plan = JSON.stringify({
    chapterIntent: '收紧节奏',
    protectedFacts: [],
    sceneBriefs: sceneBriefSeeds.map(([sceneId, blockId]) => ({
      sceneId,
      sourceBlockIds: [blockId],
      decision: 'rewrite',
      reason: '啰嗦',
      editIntent: '压缩',
      expectedChange: '更短',
      entryFacts: [],
      exitFacts: [],
      protectedSpanIds: [],
      targetLength: { direction: 'condense' },
      checks: [],
    })),
  });

  const rewriteOutputs = ['AAAAA', 'BB', 'CCCCCC'];
  let rewriteCall = 0;
  const { gateway, requests } = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: inspect };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: plan };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = rewriteOutputs[rewriteCall] ?? '';
        rewriteCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        return { text: REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'ready');
  // 第一段扩写、第二段收紧、第三段扩写：按原文偏移合并，长度变化不影响后续定位
  assert.equal(result.checkpoint.acceptedDraftText, 'AAAAA\n\nBB\n\nCCCCCC');
  assert.equal(result.checkpoint.changes.length, 3);
  assert.deepEqual(
    result.checkpoint.changes.map((change) => [change.startOffset, change.endOffset]),
    [
      [0, 4],
      [6, 10],
      [12, 16],
    ]
  );
  assert.equal(result.checkpoint.coverage.processedChars, baseText.length);
  assert.equal(result.checkpoint.coverage.retainedOriginalChars, 0);

  const rewriteRequests = requests.filter(
    (request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY
  );
  assert.equal(rewriteRequests.length, 3);
  // 第二段的输入必须包含第一段已接受成稿；未改写的第三段只作为只读后文带出，不是本段写作范围
  assert.equal(rewriteRequests[1]?.prompt.includes('AAAAA'), true);
  assert.equal(
    rewriteRequests[1]?.prompt.includes('【当前写作范围原文】\n<range>\nBBBB\n</range>'),
    true
  );
  assert.equal(
    rewriteRequests[1]?.prompt.includes('【尚未改写的后文开头（只读，禁止改写或复述）】'),
    true
  );
});

test('跨窗场景合并：同一场跨两个诊断窗只改写一次', async () => {
  const baseText = 'AAAA\n\nBBBB\n\nCCCC';
  const record = makeRecord();
  record.snapshot.baseText = baseText;
  record.checkpoint = createInitialRefinementCheckpoint(baseText);
  record.snapshot.resolvedPolicy = {
    ...record.snapshot.resolvedPolicy,
    diagnosisTargetChars: 4,
  };

  const inspectByWindow: Record<string, string> = {
    w0: JSON.stringify({
      windowId: 'w0',
      sceneFragments: [
        {
          startBlockId: 'b0',
          endBlockId: 'b0',
          startsNewScene: true,
          confidence: 'high',
          goal: '开场',
          entryFacts: [],
          exitFacts: [],
          proposedBeatEnds: [],
        },
      ],
      issues: [],
    }),
    w1: JSON.stringify({
      windowId: 'w1',
      sceneFragments: [
        {
          startBlockId: 'b1',
          endBlockId: 'b1',
          startsNewScene: false,
          confidence: 'high',
          goal: '开场延续',
          entryFacts: [],
          exitFacts: [],
          proposedBeatEnds: [],
        },
      ],
      issues: [],
    }),
    w2: JSON.stringify({
      windowId: 'w2',
      sceneFragments: [
        {
          startBlockId: 'b2',
          endBlockId: 'b2',
          startsNewScene: true,
          confidence: 'high',
          goal: '收束',
          entryFacts: [],
          exitFacts: [],
          proposedBeatEnds: [],
        },
      ],
      issues: [],
    }),
  };
  const sceneBriefSeeds: Array<[string, string[]]> = [
    ['scene-1', ['b0', 'b1']],
    ['scene-2', ['b2']],
  ];
  const plan = JSON.stringify({
    chapterIntent: '收紧节奏',
    protectedFacts: [],
    sceneBriefs: sceneBriefSeeds.map(([sceneId, blockIds]) => ({
      sceneId,
      sourceBlockIds: blockIds,
      decision: 'rewrite',
      reason: '啰嗦',
      editIntent: '压缩',
      expectedChange: '更短',
      entryFacts: [],
      exitFacts: [],
      protectedSpanIds: [],
      targetLength: { direction: 'condense' },
      checks: [],
    })),
  });

  let rewriteCall = 0;
  const { gateway, requests } = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: inspectByWindow[inspectWindowId(request.prompt)] ?? '' };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: plan };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        rewriteCall += 1;
        return { text: `R${rewriteCall}` };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        return { text: REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const { result } = await runEngine(gateway, record);

  // 三个诊断窗 → 两个场景：跨窗的 scene-1 只产生一次改写
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY)
      .length,
    3
  );
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY)
      .length,
    2
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.checkpoint.acceptedDraftText, 'R1\n\nR2');
  assert.equal(result.checkpoint.coverage.processedChars, baseText.length);
});

// ── AQ-383：plan 合同违规的有界恢复 ──────────────────────────────────

/** inspect 提供一条带来源的事实，作为确定性回填的已验证索引 */
const INSPECT_WITH_FACT = JSON.stringify({
  windowId: 'w0',
  sceneFragments: [
    {
      startBlockId: 'b0',
      endBlockId: 'b2',
      startsNewScene: true,
      confidence: 'high',
      goal: '交代归来与夜境',
      entryFacts: [{ key: 'time', value: '夜幕', sourceBlockId: 'b0', anchorQuote: '夜幕' }],
      exitFacts: [],
      proposedBeatEnds: [],
    },
  ],
  issues: [],
});

/** 有值 Fact 缺 sourceBlockId/anchorQuote，但可在已验证索引中唯一匹配 */
const PLAN_MISSING_FACT_SOURCE = JSON.stringify({
  chapterIntent: '收紧节奏',
  protectedFacts: [{ key: 'time', value: '夜幕' }],
  sceneBriefs: [
    {
      sceneId: 'scene-1',
      sourceBlockIds: ['b0', 'b1', 'b2'],
      decision: 'rewrite',
      reason: '铺陈偏散',
      editIntent: '合并三段为一段连贯动作',
      expectedChange: '三段并作一段',
      entryFacts: [],
      exitFacts: [],
      protectedSpanIds: [],
      targetLength: { direction: 'condense' },
      checks: [],
    },
  ],
});

/** 缺来源字段且索引无匹配：不可回填、不可降级 */
const PLAN_UNRECOVERABLE = JSON.stringify({
  chapterIntent: '收紧节奏',
  protectedFacts: [{ key: 'ghost', value: '并不存在的证据' }],
  sceneBriefs: [
    {
      sceneId: 'scene-1',
      sourceBlockIds: ['b0', 'b1', 'b2'],
      decision: 'rewrite',
      reason: '铺陈偏散',
      editIntent: '合并三段',
      expectedChange: '三段并作一段',
      entryFacts: [],
      exitFacts: [],
      protectedSpanIds: [],
      targetLength: { direction: 'condense' },
      checks: [],
    },
  ],
});

test('AQ-383 单条事实缺来源且索引唯一匹配：确定性回填后通过，不额外调用 plan', async () => {
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_WITH_FACT },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_MISSING_FACT_SOURCE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready');
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY)
      .length,
    1
  );
  assert.equal(result.checkpoint.planRecovery?.backfillCount, 1);
  assert.equal(result.checkpoint.planRecovery?.extraPlanCalls, 0);
  assert.equal(
    result.checkpoint.issues.some((issue) => issue.message.includes('确定性回填')),
    true
  );
});

test('AQ-383 缺来源无法回填：仅一次额外 plan 调用，第二版合法则继续且不重跑 inspect', async () => {
  let planCalls = 0;
  const { gateway, requests } = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: INSPECT_WITH_FACT };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        planCalls += 1;
        return { text: planCalls === 1 ? PLAN_UNRECOVERABLE : PLAN_REWRITE };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY:
        return { text: REWRITE_OK };
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        return { text: REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready');
  assert.equal(planCalls, 2);
  assert.equal(result.checkpoint.planRecovery?.extraPlanCalls, 1);
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY)
      .length,
    1
  );
  // 重试 prompt 带上合同错误路径，要求重新输出完整 JSON
  const retryPrompt = requests.filter(
    (request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY
  )[1].prompt;
  assert.equal(retryPrompt.includes('未通过合同校验'), true);
});

test('AQ-383 两次 plan 都不合法：不再自动调用、不进入改写，暂停并保留诊断', async () => {
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_WITH_FACT },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_UNRECOVERABLE },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'invalid_model_output');
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY)
      .length,
    2
  );
  assert.equal(
    requests.some((request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY),
    false
  );
  assert.equal(result.checkpoint.planRecovery?.extraPlanCalls, 1);
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  // 可观测性：违规详情固化到 issues 与暂停消息，不再是笼统一句
  assert.equal(
    result.checkpoint.issues.some((issue) => issue.message.includes('plan 合同违规')),
    true
  );
  assert.equal(result.checkpoint.progress.message.includes('未通过合同校验'), true);
  assert.equal(result.checkpoint.progress.message.includes('missing_fact_source'), true);
});

test('AQ-383 恢复名额已消耗：不重置计数，直接暂停', async () => {
  const record = makeRecord();
  record.checkpoint = {
    ...createInitialRefinementCheckpoint(BASE_TEXT),
    planRecovery: { backfillCount: 1, extraPlanCalls: 1, degradedSceneIds: [] },
  };
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_WITH_FACT },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_UNRECOVERABLE },
    })
  );

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'invalid_model_output');
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY)
      .length,
    1
  );
  assert.equal(result.checkpoint.planRecovery?.extraPlanCalls, 1);
});

test('AQ-383 额外 plan 名额受预算约束：预留最终检查预算不足时暂停', async () => {
  const record = makeRecord();
  record.snapshot.resolvedPolicy = {
    ...record.snapshot.resolvedPolicy,
    maxCallsPerAttempt: 3,
  };
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_WITH_FACT },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_UNRECOVERABLE },
    })
  );

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'budget_exhausted');
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY)
      .length,
    1
  );
  assert.equal(result.checkpoint.planRecovery?.extraPlanCalls, 0);
});

test('AQ-383 仅局部场景编辑指令不合法：整场 keep，其余场景继续改写', async () => {
  const inspectTwoScenes = JSON.stringify({
    windowId: 'w0',
    sceneFragments: [
      {
        startBlockId: 'b0',
        endBlockId: 'b0',
        startsNewScene: true,
        confidence: 'high',
        goal: '开场',
        entryFacts: [],
        exitFacts: [],
        proposedBeatEnds: [],
      },
      {
        startBlockId: 'b1',
        endBlockId: 'b2',
        startsNewScene: true,
        confidence: 'high',
        goal: '收束',
        entryFacts: [],
        exitFacts: [],
        proposedBeatEnds: [],
      },
    ],
    issues: [],
  });
  const seedBrief = (
    sceneId: string,
    blockIds: string[],
    checks: Array<{ targetBlockId: string; expectedFact: string }>
  ) => ({
    sceneId,
    sourceBlockIds: blockIds,
    decision: 'rewrite',
    reason: '',
    editIntent: '压缩',
    expectedChange: '更紧凑',
    entryFacts: [],
    exitFacts: [],
    protectedSpanIds: [],
    targetLength: { direction: 'hold' },
    checks,
  });
  // scene-2 的 checks 指向不存在的 block：仅该场编辑指令无法验证
  const plan = JSON.stringify({
    chapterIntent: '收紧节奏',
    protectedFacts: [],
    sceneBriefs: [
      seedBrief('scene-1', ['b0'], []),
      seedBrief('scene-2', ['b1', 'b2'], [{ targetBlockId: 'b99', expectedFact: 'x' }]),
    ],
  });

  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: inspectTwoScenes },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: plan },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: 'R1' },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready_with_issues');
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY)
      .length,
    2
  );
  // 只有 scene-1 进入改写，scene-2 整场保留
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY)
      .length,
    1
  );
  assert.deepEqual(result.checkpoint.planRecovery?.degradedSceneIds, ['scene-2']);
  assert.equal(result.checkpoint.changes.length, 1);
  assert.equal(
    result.checkpoint.issues.some(
      (issue) => issue.sceneId === 'scene-2' && issue.disposition === 'retained_original'
    ),
    true
  );
});

// ── 4.1：有限补修、严格完成判定与预算 ────────────────────────────────

/** 一条可在 REWRITE_OK 中唯一命中的可定位阻断缺口 */
const REVIEW_BLOCKING = JSON.stringify({
  issues: [
    {
      kind: 'continuity',
      severity: 'high',
      anchorQuote: '他推门而入',
      expectedFact: '推门后屋内的反应',
      sourceEvidence: '原文「他推开门，屋内一片寂静」',
      fixIntent: '补回推门后屋内的即时反应',
    },
  ],
  exitStateFacts: [],
});

const REWRITE_REPAIRED =
  '夜幕降临，城中灯火次第亮起。他推门而入，屋内的寂静扑面而来，远处打更声隐约传来。';

function singleSceneScripts(
  overrides: Record<
    string,
    (request: RefinementGenerationRequest) => Partial<RefinementGenerationResult>
  >
) {
  return (request: RefinementGenerationRequest): Partial<RefinementGenerationResult> => {
    const override = overrides[request.templateKey];
    if (override) {
      return override(request);
    }
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: INSPECT_OK };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: PLAN_REWRITE };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY:
        return { text: REWRITE_OK };
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        return { text: REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  };
}

test('4.1 可定位阻断缺口触发一次补修：补修稿通过门禁与复检后接受，缺口记为已解决', async () => {
  let reviewCalls = 0;
  const { gateway, requests } = makeGateway(
    singleSceneScripts({
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: () => {
        reviewCalls += 1;
        return { text: reviewCalls === 1 ? REVIEW_BLOCKING : REVIEW_OK };
      },
      [CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY]: () => ({ text: REWRITE_REPAIRED }),
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready');
  assert.equal(result.checkpoint.acceptedDraftText, REWRITE_REPAIRED);
  assert.equal(result.checkpoint.unitRecovery?.repairCount, 1);
  assert.deepEqual(result.checkpoint.unitRecovery?.repairedUnitIds, ['u0']);
  assert.equal(
    result.checkpoint.issues.some((issue) => issue.disposition === 'resolved'),
    true
  );
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY)
      .length,
    1
  );
  // 补修后复检使用补修稿，而不是原候选；第 3 次为整章最终检查
  const reviewRequests = requests.filter(
    (request) => request.templateKey === CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY
  );
  assert.equal(reviewRequests.length, 3);
  assert.equal(reviewRequests[1]?.prompt.includes(REWRITE_REPAIRED), true);
});

test('4.1 补修后复检仍报可定位阻断缺口：不接受补修稿，回退该单位原文', async () => {
  const { gateway, requests } = makeGateway(
    singleSceneScripts({
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: () => ({ text: REVIEW_BLOCKING }),
      [CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY]: () => ({ text: REWRITE_REPAIRED }),
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready_with_issues');
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  assert.equal(result.checkpoint.changes.length, 0);
  assert.equal(result.checkpoint.unitRecovery?.repairCount, 1);
  assert.equal(
    result.checkpoint.issues.some(
      (issue) =>
        issue.disposition === 'retained_original' && issue.message.includes('回退该单位原文')
    ),
    true
  );
  // 只补修一次：复检失败后不再发起第二轮补修
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY)
      .length,
    1
  );
});

test('4.1 补修稿未通过程序门禁：保留补修前候选，不再复检', async () => {
  const { gateway, requests } = makeGateway(
    singleSceneScripts({
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: () => ({ text: REVIEW_BLOCKING }),
      [CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY]: () => ({ text: '（此处省略）他推门而入。' }),
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready_with_issues');
  // 单位补修门禁失败保留候选；整章最终接缝修复同样门禁失败 → 回退该范围原文
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  assert.equal(result.checkpoint.unitRecovery?.repairCount, 1);
  assert.equal(result.checkpoint.unitRecovery?.seamRepairCount, 1);
  assert.equal(
    result.checkpoint.issues.some((issue) => issue.message.includes('补修未通过程序门禁')),
    true
  );
  assert.equal(
    result.checkpoint.issues.some((issue) =>
      issue.message.includes('整章最终接缝修复未通过程序门禁')
    ),
    true
  );
  // 单位 review 1 次 + 整章最终检查 1 次
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY)
      .length,
    2
  );
});

test('4.1 纯主观风格建议不触发补修：接受候选并记为提示', async () => {
  const styleOnly = JSON.stringify({
    issues: [
      {
        kind: 'style',
        severity: 'low',
        anchorQuote: '打更声',
        expectedFact: '',
        sourceEvidence: '',
        fixIntent: '可以写得更细腻',
      },
    ],
    exitStateFacts: [],
  });
  const { gateway, requests } = makeGateway(
    singleSceneScripts({
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: () => ({ text: styleOnly }),
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready');
  assert.equal(result.checkpoint.acceptedDraftText, REWRITE_OK);
  assert.equal(result.checkpoint.unitRecovery?.repairCount, 0);
  assert.equal(
    requests.some((request) => request.templateKey === CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY),
    false
  );
  assert.equal(
    result.checkpoint.issues.some(
      (issue) => issue.disposition === 'warning' && issue.category === 'style'
    ),
    true
  );
});

test('4.1 用量跨尝试累计展示，但预算按本次尝试独立计算', async () => {
  const record = makeRecord();
  record.checkpoint = {
    ...createInitialRefinementCheckpoint(BASE_TEXT),
    usage: { callCount: 100, activeElapsedMs: 5000, tokenAccounting: 'unavailable' },
  };
  const { gateway } = makeGateway(singleSceneScripts({}));

  const { result } = await runEngine(gateway, record);

  // 历史 100 次不占用本次额度：仍能跑完 inspect/plan/rewrite/review/最终检查 五次调用
  assert.equal(result.status, 'ready');
  assert.equal(result.checkpoint.usage.callCount, 105);
  assert.equal(result.checkpoint.usage.activeElapsedMs >= 5000, true);
});

test('4.1 inspect 输出未完整收束：重试一次后按上游失败暂停并说明完成原因', async () => {
  const { gateway, requests } = makeGateway(
    singleSceneScripts({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: () => ({
        ok: false,
        text: '{"windowId":"w0"',
        completionFailure: 'incomplete_stream',
        errorMessage: '上游流未正常结束（缺少完成事件），候选不可用',
      }),
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'upstream_failure');
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY)
      .length,
    2
  );
});

// ── 5.1：续跑复用已持久化计划，跳过已接受单位 ──────────────────────────

const MULTI_BLOCK_TEXT = 'AAAA\n\nBBBB\n\nCCCC';

function multiSceneInspectScript(): string {
  return JSON.stringify({
    windowId: 'w0',
    sceneFragments: ['b0', 'b1', 'b2'].map((blockId) => ({
      startBlockId: blockId,
      endBlockId: blockId,
      startsNewScene: true,
      confidence: 'high',
      goal: `推进 ${blockId}`,
      entryFacts: [],
      exitFacts: [],
      proposedBeatEnds: [],
    })),
    issues: [],
  });
}

function multiScenePlanScript(): string {
  return JSON.stringify({
    chapterIntent: '收紧节奏',
    protectedFacts: [],
    sceneBriefs: ['scene-1', 'scene-2', 'scene-3'].map((sceneId, index) => ({
      sceneId,
      sourceBlockIds: [`b${index}`],
      decision: 'rewrite',
      reason: '啰嗦',
      editIntent: '压缩',
      expectedChange: '更短',
      entryFacts: [],
      exitFacts: [],
      protectedSpanIds: [],
      targetLength: { direction: 'condense' },
      checks: [],
    })),
  });
}

test('5.1 续跑：复用持久化计划从下一单位继续，不重跑 inspect/plan 且保留前缀成果', async () => {
  // 首次尝试：预算只够 inspect+plan+第 1 段改写，在第 2 段 review 前暂停
  const first = makeRecord();
  first.snapshot.baseText = MULTI_BLOCK_TEXT;
  first.checkpoint = createInitialRefinementCheckpoint(MULTI_BLOCK_TEXT);
  first.snapshot.resolvedPolicy = { ...first.snapshot.resolvedPolicy, maxCallsPerAttempt: 6 };

  const firstRewrites = ['AAAAA', 'BB', 'CCCCCC'];
  let firstRewriteCall = 0;
  const firstRun = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: multiSceneInspectScript() };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: multiScenePlanScript() };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = firstRewrites[firstRewriteCall] ?? '';
        firstRewriteCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        return { text: REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const { result: paused } = await runEngine(firstRun.gateway, first);

  assert.equal(paused.status, 'paused');
  assert.equal(paused.pauseReason, 'budget_exhausted');
  assert.equal(paused.resumable, true);
  const resumeState = paused.checkpoint.resumeState;
  assert.ok(resumeState, '暂停时应写入可续跑计划');
  assert.equal(resumeState?.units.length, 3);
  assert.equal(resumeState?.nextUnitIndex, 1);
  assert.equal(resumeState?.replacements.length, 1);
  assert.equal(paused.checkpoint.changes.length, 1);
  // 第 1 段已接受，未处理部分逐码元保留原文
  assert.equal(paused.checkpoint.acceptedDraftText, 'AAAAA\n\nBBBB\n\nCCCC');

  // 续跑：以暂停时的 checkpoint 重新进入，预算放宽以跑完整章
  const resumed = makeRecord();
  resumed.snapshot.baseText = MULTI_BLOCK_TEXT;
  resumed.snapshot.resolvedPolicy = { ...resumed.snapshot.resolvedPolicy, maxCallsPerAttempt: 80 };
  resumed.status = 'paused';
  resumed.pauseReason = 'budget_exhausted';
  resumed.resumable = true;
  resumed.checkpoint = paused.checkpoint;

  const resumeRewrites = ['BB', 'CCCCCC'];
  let resumeRewriteCall = 0;
  const resumeRun = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = resumeRewrites[resumeRewriteCall] ?? '';
        resumeRewriteCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        return { text: REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const { result: completed } = await runEngine(resumeRun.gateway, resumed);

  // 续跑不得重跑 inspect / plan（计划已持久化）
  assert.equal(
    resumeRun.requests.some(
      (request) =>
        request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY ||
        request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY
    ),
    false
  );
  // 只改写剩余的第 2、3 段，第 1 段不重跑
  assert.equal(resumeRewriteCall, 2);
  assert.equal(completed.status, 'ready');
  assert.equal(completed.checkpoint.acceptedDraftText, 'AAAAA\n\nBB\n\nCCCCCC');
  // 前缀段落的变更随 checkpoint 还原：三段改写全部在册
  assert.equal(completed.checkpoint.changes.length, 3);
  assert.equal(completed.checkpoint.coverage.processedChars, MULTI_BLOCK_TEXT.length);
  // 终态不再保留续跑计划
  assert.equal(completed.checkpoint.resumeState, null);
});

test('5.1 续跑：计划全部推进完后仅剩最终检查时，续跑不重发改写', async () => {
  const first = makeRecord();
  first.snapshot.baseText = MULTI_BLOCK_TEXT;
  first.checkpoint = createInitialRefinementCheckpoint(MULTI_BLOCK_TEXT);

  const firstRewrites = ['AAAAA', 'BB', 'CCCCCC'];
  let firstRewriteCall = 0;
  let firstReviewCall = 0;
  const firstRun = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: multiSceneInspectScript() };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: multiScenePlanScript() };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = firstRewrites[firstRewriteCall] ?? '';
        firstRewriteCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY: {
        firstReviewCall += 1;
        // 前三次是逐段检查；第四次起是整章最终检查，此处在首次运行时令其上游失败
        return firstReviewCall <= 3 ? { text: REVIEW_OK } : { ok: false, errorMessage: '上游 502' };
      }
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const { result: paused } = await runEngine(firstRun.gateway, first);

  // 三段全部改写并接受，仅整章最终检查失败 → 暂停
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pauseReason, 'upstream_failure');
  assert.equal(paused.checkpoint.resumeState?.nextUnitIndex, 3);
  assert.equal(paused.checkpoint.resumeState?.replacements.length, 3);
  assert.equal(paused.checkpoint.changes.length, 3);
  assert.equal(paused.checkpoint.acceptedDraftText, 'AAAAA\n\nBB\n\nCCCCCC');

  const resumed = makeRecord();
  resumed.snapshot.baseText = MULTI_BLOCK_TEXT;
  resumed.snapshot.resolvedPolicy = { ...resumed.snapshot.resolvedPolicy, maxCallsPerAttempt: 80 };
  resumed.status = 'paused';
  resumed.resumable = true;
  resumed.checkpoint = paused.checkpoint;

  const resumeRun = makeGateway(
    scriptByKey({ [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK } })
  );

  const { result: completed } = await runEngine(resumeRun.gateway, resumed);

  // 所有单位都已完成：续跑只做最终检查，不重发 rewrite
  assert.equal(
    resumeRun.requests.some(
      (request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY
    ),
    false
  );
  assert.equal(resumeRun.requests.length, 1);
  assert.equal(completed.status, 'ready');
  assert.equal(completed.checkpoint.acceptedDraftText, 'AAAAA\n\nBB\n\nCCCCCC');
  assert.equal(completed.checkpoint.changes.length, 3);
});

// ── F1：中途持久化 checkpoint，进程重启不丢已接受稿 ──────────────────────

test('F1 计划冻结与每个已接受单位都提交 checkpoint，重启可从上一个已接受单位恢复', async () => {
  const record = makeRecord();
  record.snapshot.baseText = MULTI_BLOCK_TEXT;
  record.checkpoint = createInitialRefinementCheckpoint(MULTI_BLOCK_TEXT);

  const rewrites = ['AAAAA', 'BB', 'CCCCCC'];
  let call = 0;
  const { gateway } = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: multiSceneInspectScript() };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: multiScenePlanScript() };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = rewrites[call] ?? '';
        call += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        return { text: REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const checkpoints: RefinementCheckpoint[] = [];
  const { result } = await runEngine(gateway, record, undefined, {
    onCheckpoint: (checkpoint) => {
      checkpoints.push(checkpoint);
    },
  });

  assert.equal(result.status, 'ready');
  // 计划冻结后提交一次（重启无需重跑诊断 / 规划）
  assert.ok(
    checkpoints.some((checkpoint) => checkpoint.progress.message.includes('冻结整章计划')),
    '计划冻结后应提交 checkpoint'
  );
  // 每个已接受单位后提交一次
  assert.equal(
    checkpoints.filter((checkpoint) => checkpoint.progress.message.includes('已接受第')).length,
    3
  );

  // 模拟进程重启：取「已接受第 1/3 段」之后的 checkpoint 作为持久化状态
  const afterUnit1 = checkpoints.find((checkpoint) =>
    checkpoint.progress.message.includes('已接受第 1/3 段')
  );
  assert.ok(afterUnit1, '第 1 段接受后应有 checkpoint');
  assert.equal(afterUnit1?.resumeState?.nextUnitIndex, 1);
  assert.equal(afterUnit1?.resumeState?.replacements.length, 1);
  // 中途持久化的候选 = 已接受前缀 + 剩余原文
  assert.equal(afterUnit1?.acceptedDraftText, 'AAAAA\n\nBBBB\n\nCCCC');

  const restarted = makeRecord();
  restarted.snapshot.baseText = MULTI_BLOCK_TEXT;
  restarted.checkpoint = afterUnit1!;
  restarted.status = 'paused';
  restarted.resumable = true;

  const resumeRewrites = ['BB', 'CCCCCC'];
  let resumeCall = 0;
  const resumeRun = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = resumeRewrites[resumeCall] ?? '';
        resumeCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        return { text: REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const { result: resumed } = await runEngine(resumeRun.gateway, restarted);

  // 重启后不重跑 inspect/plan，也不重做已接受的第 1 段
  assert.equal(
    resumeRun.requests.some(
      (request) =>
        request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY ||
        request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY
    ),
    false
  );
  assert.equal(resumeCall, 2);
  assert.equal(resumed.status, 'ready');
  assert.equal(resumed.checkpoint.acceptedDraftText, 'AAAAA\n\nBB\n\nCCCCCC');
});

// ── F3：必要检查未完成不得接受 ─────────────────────────────────────────

test('F3 必要 review 未完成：不得接受候选，暂停在检查阶段并保留原文', async () => {
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { ok: false, errorMessage: '上游 502' },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'upstream_failure');
  // 未完成检查的候选不得写入：候选仍等于冻结原文、零变更
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  assert.equal(result.checkpoint.changes.length, 0);
  // 检查调用确实重试过（2 次），随后暂停
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY)
      .length,
    2
  );
});

// ── F4：冻结模型路由必须真正传到模型调用 ───────────────────────────────

test('F4 引擎按档位传入冻结模型路由（utility / writing 分档）', async () => {
  const record = makeRecord();
  record.snapshot.modelRoutes = {
    utility: { tier: 'utility', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.2 },
    writing: {
      tier: 'writing',
      provider: 'siliconflow',
      model: 'deepseek-ai/DeepSeek-V3',
      temperature: 0.9,
    },
  };

  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'ready');
  const inspectRequest = requests.find(
    (request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY
  );
  const rewriteRequest = requests.find(
    (request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY
  );
  assert.deepEqual(inspectRequest?.modelRoute, {
    tier: 'utility',
    provider: 'deepseek',
    model: 'deepseek-chat',
    temperature: 0.2,
  });
  assert.deepEqual(rewriteRequest?.modelRoute, {
    tier: 'writing',
    provider: 'siliconflow',
    model: 'deepseek-ai/DeepSeek-V3',
    temperature: 0.9,
  });
});

test('F4 冻结模型路由不完整：显式暂停，不发起任何调用（不静默回退当前设置）', async () => {
  const record = makeRecord();
  record.snapshot.modelRoutes = {
    writing: { tier: 'writing', provider: 'deepseek', model: 'w', temperature: 0.7 },
  };

  const { gateway, requests } = makeGateway(scriptByKey({}));
  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'paused');
  assert.equal(requests.length, 0);
});

// ── F5：散场状态事实必须有证据并通过 checkpoint 向下游传递 ──────────────

test('F5 有据状态传递给后续单位，凭空状态被拒绝且记为非阻断提示', async () => {
  const record = makeRecord();
  record.snapshot.baseText = MULTI_BLOCK_TEXT;
  record.checkpoint = createInitialRefinementCheckpoint(MULTI_BLOCK_TEXT);

  // 第 1 段候选中含「夜幕灯火」；review 报出一项有据状态与一项凭空状态
  const reviewWithFacts = JSON.stringify({
    issues: [],
    exitStateFacts: [
      {
        key: 'time',
        value: '夜幕灯火',
        sourceBlockId: 'b0',
        anchorQuote: '夜幕灯火',
        exitAnchorQuote: '夜幕灯火',
      },
      { key: 'crowd', value: '人群喧闹', sourceBlockId: 'b0', anchorQuote: '人群喧闹' },
    ],
  });

  const rewrites = ['夜幕灯火亮起', 'BB', 'CCCCCC'];
  let rewriteCall = 0;
  let reviewCall = 0;
  const { gateway, requests } = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: multiSceneInspectScript() };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: multiScenePlanScript() };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = rewrites[rewriteCall] ?? '';
        rewriteCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY: {
        reviewCall += 1;
        return { text: reviewCall === 1 ? reviewWithFacts : REVIEW_OK };
      }
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const { result } = await runEngine(gateway, record);

  const rewriteRequests = requests.filter(
    (request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY
  );
  assert.equal(rewriteRequests.length, 3);
  const secondRewritePrompt = rewriteRequests[1]!.prompt;
  // 有据状态进入后续单位提示
  assert.ok(secondRewritePrompt.includes('夜幕灯火'), '有据状态应传递给后续单位');
  // 凭空状态不得传播
  assert.equal(secondRewritePrompt.includes('人群喧闹'), false, '凭空状态不得传递');

  // 凭空状态记为**非阻断**提示（continuity / warning），不阻断应用
  const crowdIssue = result.checkpoint.issues.find(
    (issue) => issue.category === 'continuity' && issue.message.includes('crowd')
  );
  assert.ok(crowdIssue, '凭空状态应记为 continuity 问题');
  assert.equal(crowdIssue?.disposition, 'warning');
  assert.equal(crowdIssue?.severity, 'low');
  assert.equal(result.status, 'ready');
});

// ── B2：散场状态证据的可信边界（W6 收口） ────────────────────────────

/** 多场脚本 + 逐段改写文本，便于按单位返回不同候选。 */
function multiSceneScripts(args: {
  rewrites: string[];
  reviews: Array<(call: number) => string>;
  repair?: () => string;
}) {
  let rewriteCall = 0;
  let reviewCall = 0;
  return (request: RefinementGenerationRequest): Partial<RefinementGenerationResult> => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: multiSceneInspectScript() };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: multiScenePlanScript() };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = args.rewrites[rewriteCall] ?? '';
        rewriteCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY: {
        const index = reviewCall;
        reviewCall += 1;
        return { text: (args.reviews[index] ?? (() => REVIEW_OK))(index) };
      }
      case CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY:
        return args.repair
          ? { text: args.repair() }
          : { ok: false, errorMessage: 'no repair script' };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  };
}

/** 改写提示中「前文已确认状态」小节的标题；断言按小节判定，避免与已接受前缀正文混淆。 */
const STATE_FACT_SECTION = '【前文已确认的当前状态';

function rewritePrompts(requests: RefinementGenerationRequest[]): string[] {
  return requests
    .filter((request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY)
    .map((request) => request.prompt);
}

test('B2/W6 入场引文冒充末态锚点：真实运行中不进入确定状态，也不传给后续单位', async () => {
  // 第 1 段候选后面明确改变同一状态；review 却把入场片段填成末态锚点
  const unitOne = '甲拿着钥匙入场，散场时把钥匙留在桌上。';
  const entryAsExitAnchor = JSON.stringify({
    issues: [],
    exitStateFacts: [
      {
        key: 'holding',
        value: '拿着钥匙',
        sourceBlockId: 'b0',
        anchorQuote: '甲拿着钥匙入场',
        exitAnchorQuote: '甲拿着钥匙入场',
      },
    ],
  });

  const { gateway, requests } = makeGateway(
    multiSceneScripts({
      rewrites: [unitOne, 'BB', 'CCCCCC'],
      reviews: [() => entryAsExitAnchor],
    })
  );

  const { result } = await runEngine(gateway, multiSceneRecord());

  const prompts = rewritePrompts(requests);
  assert.equal(prompts.length, 3);
  assert.equal(
    prompts[1]?.includes(STATE_FACT_SECTION),
    false,
    '被后续变化取代的入场状态不得作为已确认状态传给第 2 段'
  );
  assert.equal(
    (result.checkpoint.resumeState?.stateFacts ?? []).some((fact) => fact.key === 'holding'),
    false,
    '账本不得把它记为确定状态'
  );
  const supersededWarning = result.checkpoint.issues.find(
    (issue) => issue.category === 'continuity' && issue.message.includes('holding')
  );
  assert.ok(supersededWarning, '应登记一条不传播的提示');
  assert.equal(supersededWarning?.disposition, 'warning');
  assert.equal(supersededWarning?.severity, 'low');
  // 末态证据不确定不应阻断应用（正文已过门禁，只是状态不传播）
  assert.equal(result.status, 'ready');
});

test('B2 补修改变候选后旧末态证据失效：不为新候选沿用旧候选的末态', async () => {
  const CANDIDATE_V1 = '夜幕灯火亮起，街上无人。';
  const CANDIDATE_V2 = '夜幕落下，街上无人。';
  const reviewV1 = JSON.stringify({
    issues: [
      {
        kind: 'continuity',
        severity: 'high',
        anchorQuote: '街上无人',
        expectedFact: '补回灯火的具体变化',
        sourceEvidence: '原文「城中灯火次第亮起」',
        fixIntent: '把夜色与灯火的变化写具体',
      },
    ],
    exitStateFacts: [
      {
        key: 'light',
        value: '灯火亮起',
        sourceBlockId: 'b0',
        anchorQuote: '灯火亮起',
        exitAnchorQuote: '灯火亮起',
      },
    ],
  });

  const { gateway, requests } = makeGateway(
    multiSceneScripts({
      rewrites: [CANDIDATE_V1, 'BB', 'CCCCCC'],
      reviews: [() => reviewV1],
      repair: () => CANDIDATE_V2,
    })
  );

  const { result } = await runEngine(gateway, multiSceneRecord());

  assert.equal(result.checkpoint.acceptedDraftText.includes(CANDIDATE_V2), true);
  const prompts = rewritePrompts(requests);
  assert.equal(prompts.length, 3);
  assert.equal(
    prompts[1]?.includes(STATE_FACT_SECTION),
    false,
    '补修稿上未重新确认的旧末态不得传给第 2 段'
  );
  assert.equal(
    prompts[2]?.includes(STATE_FACT_SECTION),
    false,
    '补修稿上未重新确认的旧末态不得传给第 3 段'
  );
});

test('B2 整章接缝回退后：该范围旧候选上的末态证据失效，不再随 checkpoint 传播', async () => {
  const UNIT_ONE = '夜幕灯火亮起，街上无人。';
  const factReview = JSON.stringify({
    issues: [],
    exitStateFacts: [
      {
        key: 'light',
        value: '灯火亮起',
        sourceBlockId: 'b0',
        anchorQuote: '灯火亮起',
        exitAnchorQuote: '灯火亮起',
      },
    ],
  });
  /** 整章最终检查：按当前分组中实际出现的候选片段给出可定位阻断缺口。 */
  const seamBlockingFor = (prompt: string): string => {
    const anchor = ['街上无人', 'BB', 'CCCCCC'].find((quote) => prompt.includes(quote)) ?? 'BB';
    return JSON.stringify({
      issues: [
        {
          kind: 'continuity',
          severity: 'high',
          anchorQuote: anchor,
          expectedFact: '与邻文的接缝状态一致',
          sourceEvidence: '原文',
          fixIntent: '修复当前范围与邻文的接缝状态',
        },
      ],
      exitStateFacts: [],
    });
  };

  let reviewCall = 0;
  let rewriteCall = 0;
  const { gateway } = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: multiSceneInspectScript() };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: multiScenePlanScript() };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = [UNIT_ONE, 'BB', 'CCCCCC'][rewriteCall] ?? 'X';
        rewriteCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY: {
        const index = reviewCall;
        reviewCall += 1;
        // 0~2 为逐段检查；3 起为整章最终检查（两轮都返回阻断，触发回退后暂停）
        if (index === 0) {
          return { text: factReview };
        }
        if (index <= 2) {
          return { text: REVIEW_OK };
        }
        return { text: seamBlockingFor(request.prompt) };
      }
      case CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY:
        // 整章接缝补修上游失败 → 该范围回退原文
        return { ok: false, errorMessage: '接缝补修上游失败' };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const { result } = await runEngine(gateway, multiSceneRecord());

  // 整章接缝回退后暂停（回退 + 重检仍阻断），此时 checkpoint 仍带续跑计划
  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'boundary_conflict');
  const resumeState = result.checkpoint.resumeState;
  assert.ok(resumeState, '暂停时应保留续跑计划');
  assert.equal(
    resumeState?.stateFacts.some((fact) => fact.key === 'light'),
    false,
    '回退范围的旧候选末态证据必须失效，不得继续随 checkpoint 传播'
  );
  assert.ok(
    result.checkpoint.issues.some((issue) => issue.message.includes('回退该范围原文')),
    '应登记范围回退'
  );
});

test('B2 续跑：checkpoint 保存同一候选版本的状态证据，恢复后继续传播', async () => {
  const reviewWithFact = JSON.stringify({
    issues: [],
    exitStateFacts: [
      {
        key: 'light',
        value: '灯火亮起',
        sourceBlockId: 'b0',
        anchorQuote: '灯火亮起',
        exitAnchorQuote: '灯火亮起',
      },
    ],
  });

  const first = multiSceneRecord();
  first.snapshot.resolvedPolicy = { ...first.snapshot.resolvedPolicy, maxCallsPerAttempt: 6 };
  const firstRun = makeGateway(
    multiSceneScripts({
      rewrites: ['夜幕灯火亮起', 'BB', 'CCCCCC'],
      reviews: [() => reviewWithFact],
    })
  );
  const { result: paused } = await runEngine(firstRun.gateway, first);

  const savedFact = paused.checkpoint.resumeState?.stateFacts.find((fact) => fact.key === 'light');
  assert.ok(savedFact, '暂停时应把确定状态随 checkpoint 持久化');
  assert.equal(savedFact?.candidateRevision, 1, '证据应绑定候选版本');
  assert.ok(savedFact?.candidateHash, '证据应绑定候选 hash');
  assert.equal(typeof savedFact?.anchorStart, 'number');

  const resumed = multiSceneRecord();
  resumed.snapshot.resolvedPolicy = { ...resumed.snapshot.resolvedPolicy, maxCallsPerAttempt: 80 };
  resumed.status = 'paused';
  resumed.pauseReason = 'budget_exhausted';
  resumed.resumable = true;
  resumed.checkpoint = paused.checkpoint;
  const resumeRun = makeGateway(multiSceneScripts({ rewrites: ['BB', 'CCCCCC'], reviews: [] }));

  const { result: completed } = await runEngine(resumeRun.gateway, resumed);
  assert.equal(completed.status, 'ready');
  const resumePrompts = rewritePrompts(resumeRun.requests);
  assert.equal(resumePrompts.length, 2);
  assert.equal(resumePrompts[0]?.includes('灯火亮起'), true, '同一版本的事实应在恢复后继续承接');
});

test('B2 旧 checkpoint 缺候选版本的状态证据：保守不传播，不默认同源', async () => {
  const first = multiSceneRecord();
  first.snapshot.resolvedPolicy = { ...first.snapshot.resolvedPolicy, maxCallsPerAttempt: 6 };
  const firstRun = makeGateway(
    multiSceneScripts({
      rewrites: ['夜幕灯火亮起', 'BB', 'CCCCCC'],
      reviews: [
        () =>
          JSON.stringify({
            issues: [],
            exitStateFacts: [
              {
                key: 'light',
                value: '灯火亮起',
                sourceBlockId: 'b0',
                anchorQuote: '灯火亮起',
                exitAnchorQuote: '灯火亮起',
              },
            ],
          }),
      ],
    })
  );
  const { result: paused } = await runEngine(firstRun.gateway, first);

  // 模拟旧记录：状态事实没有候选版本信息，无法证明与当前候选同源
  const legacy = structuredClone(paused.checkpoint);
  assert.ok(legacy.resumeState);
  for (const fact of legacy.resumeState!.stateFacts) {
    delete fact.candidateRevision;
    delete fact.candidateHash;
  }

  const resumed = multiSceneRecord();
  resumed.snapshot.resolvedPolicy = { ...resumed.snapshot.resolvedPolicy, maxCallsPerAttempt: 80 };
  resumed.status = 'paused';
  resumed.pauseReason = 'budget_exhausted';
  resumed.resumable = true;
  resumed.checkpoint = legacy;
  const resumeRun = makeGateway(multiSceneScripts({ rewrites: ['BB', 'CCCCCC'], reviews: [] }));

  const { result: completed } = await runEngine(resumeRun.gateway, resumed);
  assert.equal(completed.status, 'ready');
  const resumePrompts = rewritePrompts(resumeRun.requests);
  assert.equal(
    resumePrompts[0]?.includes(STATE_FACT_SECTION),
    false,
    '缺候选版本的证据不得作为已确认状态传播'
  );
});

test('B2 逐字锁与必要事实不因“状态不确定”被放松：有值锁仍拦住，null 不作为锁', async () => {
  // ① 逐字锁（protectedSpanIds）仍按原合同强制：改写丢掉整块锁定时回退原文
  const planWithLock = JSON.stringify({
    chapterIntent: '收紧节奏',
    protectedFacts: [],
    sceneBriefs: [
      {
        sceneId: 's1',
        sourceBlockIds: ['b0', 'b1', 'b2'],
        decision: 'rewrite',
        reason: '啰嗦',
        editIntent: '压缩',
        expectedChange: '更短',
        entryFacts: [],
        exitFacts: [],
        protectedSpanIds: ['b0'],
        targetLength: { direction: 'condense' },
        checks: [],
      },
    ],
  });
  const { gateway } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: planWithLock },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: '他推门而入，屋内寂静无声。' },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );
  const { result } = await runEngine(gateway, makeRecord());
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT, '逐字锁被丢掉时不得放行候选');
  assert.ok(
    result.checkpoint.issues.some(
      (issue) => issue.category === 'hard_constraint' && issue.severity === 'high'
    ),
    '应登记逐字锁缺失的阻断提示'
  );

  // ② value=null 的事实不是锁：候选不含也不据此拒绝；有值锁不因此被降为 null
  const planWithNull = JSON.stringify({
    chapterIntent: '收紧节奏',
    protectedFacts: [{ key: 'time', value: null }],
    sceneBriefs: [
      {
        sceneId: 's1',
        sourceBlockIds: ['b0', 'b1', 'b2'],
        decision: 'rewrite',
        reason: '啰嗦',
        editIntent: '压缩',
        expectedChange: '更短',
        entryFacts: [],
        exitFacts: [],
        protectedSpanIds: [],
        targetLength: { direction: 'condense' },
        checks: [],
      },
    ],
  });
  const { gateway: nullGateway } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: planWithNull },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );
  const { result: nullResult } = await runEngine(nullGateway, makeRecord());
  assert.equal(nullResult.status, 'ready');
  assert.equal(nullResult.checkpoint.acceptedDraftText, REWRITE_OK);
});

// ── F6：重试共享同一调用上限 ───────────────────────────────────────────

test('F6 重试共享调用上限：实际调用数不超过 maxCallsPerAttempt', async () => {
  const record = makeRecord();
  record.snapshot.resolvedPolicy = { ...record.snapshot.resolvedPolicy, maxCallsPerAttempt: 4 };

  const { gateway, requests } = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: INSPECT_OK };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: PLAN_REWRITE };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY:
        return { ok: false, errorMessage: '上游 502' };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const { result } = await runEngine(gateway, record);

  // inspect + plan + rewrite 首调 + rewrite 重试 = 4，恰好封顶
  assert.equal(requests.length, 4);
  assert.ok(requests.length <= record.snapshot.resolvedPolicy.maxCallsPerAttempt);
  assert.equal(result.checkpoint.coverage.retainedOriginalChars > 0, true);
});

test('F6 预算不足时在改写前原子拒绝，不再发起调用', async () => {
  const record = makeRecord();
  record.snapshot.resolvedPolicy = { ...record.snapshot.resolvedPolicy, maxCallsPerAttempt: 3 };

  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
    })
  );

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'budget_exhausted');
  // 仅 inspect + plan 两次调用；改写未发起
  assert.equal(requests.length, 2);
});

// ── F1：调用前原子持久化名额与用量；存储失败明确停止；复用已完成诊断 ──────

/** 可挂起指定模板调用的网关：命中挂起模板时等待 signal 中止。 */
function makeHangingGateway(args: {
  hangOn: string;
  script: Record<string, string>;
  onRequest?: (templateKey: string) => void;
}) {
  let resolveHanging!: () => void;
  const hanging = new Promise<void>((resolve) => {
    resolveHanging = resolve;
  });
  let hungOnce = false;
  const gateway: RefinementGenerationGateway = {
    async generate(request) {
      args.onRequest?.(request.templateKey);
      if (request.templateKey === args.hangOn) {
        if (!hungOnce) {
          hungOnce = true;
          resolveHanging();
        }
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) {
            resolve();
            return;
          }
          request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { ok: false, text: '', traceId: 't', aborted: true };
      }
      const text = args.script[request.templateKey];
      if (text === undefined) {
        return { ok: false, text: '', traceId: 't', aborted: false, errorMessage: 'no script' };
      }
      return { ok: true, text, traceId: 't', aborted: false };
    },
  };
  return { gateway, hanging };
}

test('F1 补修在途取消：已消耗补修名额与累计用量均已落库，不因取消重置', async () => {
  const controller = new AbortController();
  let actualCalls = 0;
  const { gateway, hanging } = makeHangingGateway({
    hangOn: CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
    script: {
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: INSPECT_OK,
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: PLAN_REWRITE,
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: REWRITE_OK,
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: REVIEW_BLOCKING,
    },
    onRequest: () => {
      actualCalls += 1;
    },
  });

  const checkpoints: RefinementCheckpoint[] = [];
  const runPromise = runEngine(gateway, makeRecord(), controller.signal, {
    onCheckpoint: (checkpoint) => {
      checkpoints.push(checkpoint);
    },
  });

  await hanging;
  // 补修调用发起前，名额与用量已落库
  const reserved = checkpoints[checkpoints.length - 1];
  assert.equal(reserved.unitRecovery?.repairCount, 1, '补修名额应在调用前落库');
  assert.equal(reserved.usage.callCount, actualCalls, '累计用量应在调用前落库');

  controller.abort();
  const { result } = await runPromise;

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'user_cancelled');
  // 取消后仍保留已消耗名额与历史用量
  assert.equal(result.checkpoint.unitRecovery?.repairCount, 1);
  assert.equal(result.checkpoint.usage.callCount, actualCalls);
});

test('F1 最终接缝修复在途取消：seamRepairCount 已落库，不因取消重置', async () => {
  const controller = new AbortController();
  let reviewCalls = 0;
  let actualCalls = 0;
  const { gateway, hanging } = makeHangingGateway({
    hangOn: CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
    script: {
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: INSPECT_OK,
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: PLAN_REWRITE,
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: REWRITE_OK,
    },
    onRequest: (key) => {
      actualCalls += 1;
      if (key === CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY) {
        reviewCalls += 1;
      }
    },
  });

  // review：第 1 次为单位检查通过；第 2 次为整章最终检查，报出可定位阻断缺口 → 触发接缝修复
  const reviewGateway: RefinementGenerationGateway = {
    async generate(request) {
      if (request.templateKey === CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY) {
        actualCalls += 1;
        reviewCalls += 1;
        const text = reviewCalls === 1 ? REVIEW_OK : REVIEW_BLOCKING;
        return { ok: true, text, traceId: 't', aborted: false };
      }
      return gateway.generate(request);
    },
  };

  const checkpoints: RefinementCheckpoint[] = [];
  const runPromise = runEngine(reviewGateway, makeRecord(), controller.signal, {
    onCheckpoint: (checkpoint) => {
      checkpoints.push(checkpoint);
    },
  });

  await hanging;
  const reserved = checkpoints[checkpoints.length - 1];
  assert.equal(reserved.unitRecovery?.seamRepairCount, 1, '接缝修复名额应在调用前落库');
  assert.equal(reserved.usage.callCount, actualCalls);

  controller.abort();
  const { result } = await runPromise;
  assert.equal(result.status, 'paused');
  assert.equal(result.checkpoint.unitRecovery?.seamRepairCount, 1);
  assert.equal(result.checkpoint.usage.callCount, actualCalls);
});

test('F1 存储故障：发起调用前 checkpoint 未落库即明确停止，不发起任何调用', async () => {
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
    })
  );

  const { result } = await runEngine(gateway, makeRecord(), undefined, {
    onCheckpoint: () => {
      throw new Error('storage unavailable');
    },
  });

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'persistence_failed');
  assert.equal(result.resumable, false);
  // 存储失败发生在任何调用发起之前
  assert.equal(requests.length, 0);
});

test('F1 逐窗持久化诊断结果；恢复时复用已完成窗口，不重跑 inspect', async () => {
  const record = makeRecord();
  const inspections: RefinementCheckpoint[] = [];
  const first = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );
  const { result } = await runEngine(first.gateway, record, undefined, {
    onCheckpoint: (checkpoint) => {
      inspections.push(checkpoint);
    },
  });
  assert.equal(result.status, 'ready');
  const diagnosed = inspections.find((checkpoint) => checkpoint.diagnosis?.completedWindows === 1);
  assert.ok(diagnosed, '诊断完成后应持久化窗口结果');

  // 以该 checkpoint 作为恢复起点：不应再调用 inspect
  const resumed = makeRecord();
  resumed.checkpoint = diagnosed!;
  const second = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );
  const { result: resumedResult } = await runEngine(second.gateway, resumed);
  assert.equal(resumedResult.status, 'ready');
  assert.equal(
    second.requests.some(
      (request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY
    ),
    false,
    '恢复时不得重跑已完成的诊断窗口'
  );
  assert.equal(
    second.requests.filter(
      (request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY
    ).length,
    1
  );
});

// ── F3：最终修复 / 回退后必须按最终候选重检接缝 ────────────────────────

function multiSceneRecord() {
  const record = makeRecord();
  record.snapshot.baseText = MULTI_BLOCK_TEXT;
  record.checkpoint = createInitialRefinementCheckpoint(MULTI_BLOCK_TEXT);
  return record;
}

/** 3 场景全部改写成功；review 按顺序返回脚本。 */
function multiSceneRewrites(scripts: Array<Record<string, unknown>>) {
  let rewriteCall = 0;
  let reviewCall = 0;
  return (request: RefinementGenerationRequest): Partial<RefinementGenerationResult> => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: multiSceneInspectScript() };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: multiScenePlanScript() };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = ['AAAAA', 'BB', 'CCCCCC'][rewriteCall] ?? '';
        rewriteCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY: {
        const script = scripts[reviewCall] ?? REVIEW_OK;
        reviewCall += 1;
        return { text: JSON.stringify(script) };
      }
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  };
}

test('F3 最终检查报阻断 → 回退后按最终候选重检相邻接缝（不再沿用旧检查）', async () => {
  // 第 4 次 review 为整章最终检查，报出只在第 1 段候选（AAAAA）中命中的阻断缺口
  const finalBlocking = {
    issues: [
      {
        kind: 'hard_constraint',
        severity: 'high',
        anchorQuote: 'AAAAA',
        expectedFact: '接缝一致',
        fixIntent: '修复第 1 段与后文接缝',
      },
    ],
    exitStateFacts: [],
  };
  const { gateway, requests } = makeGateway(
    multiSceneRewrites([
      { issues: [], exitStateFacts: [] },
      { issues: [], exitStateFacts: [] },
      { issues: [], exitStateFacts: [] },
      finalBlocking,
      { issues: [], exitStateFacts: [] }, // 回退后重检
    ])
  );

  const { result } = await runEngine(gateway, multiSceneRecord());

  const reviewRequests = requests.filter(
    (request) => request.templateKey === CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY
  );
  // 3 段单位检查 + 1 次整章检查 + 回退后 1 次重检
  assert.equal(reviewRequests.length, 5, '回退后必须重检新接缝');
  assert.equal(result.status, 'ready_with_issues');
  // 第 1 段回退原文，第 2、3 段保留改写
  assert.equal(result.checkpoint.acceptedDraftText, 'AAAA\n\nBB\n\nCCCCCC');
  assert.equal(result.checkpoint.changes.length, 2);
});

test('F3 回退后重检仍报阻断：暂停，候选不可应用', async () => {
  const finalBlocking = {
    issues: [
      {
        kind: 'hard_constraint',
        severity: 'high',
        anchorQuote: 'AAAAA',
        expectedFact: '接缝一致',
        fixIntent: '修复第 1 段与后文接缝',
      },
    ],
    exitStateFacts: [],
  };
  const recheckBlocking = {
    issues: [
      {
        kind: 'continuity',
        severity: 'high',
        anchorQuote: 'BB',
        expectedFact: '接缝一致',
        fixIntent: '修复第 2 段与后文接缝',
      },
    ],
    exitStateFacts: [],
  };
  const { gateway, requests } = makeGateway(
    multiSceneRewrites([
      { issues: [], exitStateFacts: [] },
      { issues: [], exitStateFacts: [] },
      { issues: [], exitStateFacts: [] },
      finalBlocking,
      recheckBlocking,
    ])
  );

  const { result } = await runEngine(gateway, multiSceneRecord());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'boundary_conflict');
  // 确已发起回退后重检
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY)
      .length,
    5
  );
});

// ── F6：完整输入预算覆盖所有调用（inspect / plan / 未登记模型能力）─────────

for (const resumed of [false, true]) {
  test(`V4 Pro 冻结路由：${resumed ? '零调用预算暂停后续跑' : '新建运行'}通过 inspect 与成稿`, async () => {
    const record = makeRecord(
      resumed
        ? { status: 'paused', pauseReason: 'context_budget', resumable: true, attemptId: 'a2' }
        : {}
    );
    record.snapshot.modelRoutes = {
      utility: {
        tier: 'utility',
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        temperature: 0.5,
      },
      writing: {
        tier: 'writing',
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        temperature: 0.7,
      },
    };
    const { gateway, requests } = makeGateway(
      scriptByKey({
        [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
        [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
        [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
        [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
      })
    );
    const { result } = await runEngine(gateway, record);
    assert.equal(result.status, 'ready');
    assert.equal(result.pauseReason ?? null, null);
    assert.equal(result.checkpoint.acceptedDraftText, REWRITE_OK);
    assert.deepEqual(
      requests.map((request) => request.templateKey),
      [
        CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
        CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
        CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
        CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
        CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
      ]
    );
    for (const request of requests) {
      assert.equal(request.modelRoute?.provider, 'deepseek');
      assert.equal(request.modelRoute?.model, 'deepseek-v4-pro');
      assert.equal(request.maxTokens, 4_096);
    }
  });
}

test('plan 截断后扩容重试：第二次请求的 maxTokens 大于首次', async () => {
  const record = makeRecord();
  record.snapshot.modelRoutes = {
    utility: { tier: 'utility', provider: 'deepseek', model: 'deepseek-v4-pro', temperature: 0.5 },
    writing: { tier: 'writing', provider: 'deepseek', model: 'deepseek-v4-pro', temperature: 0.7 },
  };
  let planCalls = 0;
  const { gateway, requests } = makeGateway((request) => {
    if (request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY) {
      planCalls += 1;
      if (planCalls === 1) {
        // 首次以 4096 估算额度被 length 截断
        return {
          ok: false,
          text: '{"chapterIntent":"截断"}',
          completionFailure: 'truncated',
          errorMessage: '输出达到长度上限被截断，候选不可用',
        };
      }
      return { ok: true, text: PLAN_REWRITE };
    }
    if (request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY) {
      return { ok: true, text: INSPECT_OK };
    }
    if (request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY) {
      return { ok: true, text: REWRITE_OK };
    }
    if (request.templateKey === CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY) {
      return { ok: true, text: REVIEW_OK };
    }
    return { ok: false, errorMessage: 'unexpected' };
  });

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'ready');
  const planRequests = requests.filter(
    (request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY
  );
  assert.equal(planRequests.length, 2);
  // 首次为估算值（单场景 = 4096），第二次扩容到 16K
  assert.equal(planRequests[0].maxTokens, 4_096);
  assert.equal(planRequests[1].maxTokens, 16_384);
  // 扩容额度确实生效且被记录到 planRecovery 供观测
  assert.equal(result.checkpoint.planRecovery?.expandedPlanTokens, 16_384);
});

test('plan 连续截断到上限仍失败：暂停为 upstream_failure，不静默钳低', async () => {
  const record = makeRecord();
  record.snapshot.modelRoutes = {
    utility: { tier: 'utility', provider: 'deepseek', model: 'deepseek-v4-pro', temperature: 0.5 },
    writing: { tier: 'writing', provider: 'deepseek', model: 'deepseek-v4-pro', temperature: 0.7 },
  };
  const { gateway, requests } = makeGateway((request) => {
    if (request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY) {
      return {
        ok: false,
        text: '{"chapterIntent":"截断"}',
        completionFailure: 'truncated',
        errorMessage: '输出达到长度上限被截断，候选不可用',
      };
    }
    if (request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY) {
      return { ok: true, text: INSPECT_OK };
    }
    return { ok: false, errorMessage: 'unexpected' };
  });

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'upstream_failure');
  const planRequests = requests.filter(
    (request) => request.templateKey === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY
  );
  // 首次 4096 → 扩 16K → 再扩 32K，共 3 次，额度递增
  assert.equal(planRequests.length, 3);
  assert.equal(planRequests[0].maxTokens, 4_096);
  assert.equal(planRequests[1].maxTokens, 16_384);
  assert.equal(planRequests[2].maxTokens, 32_768);
});

test('F6 未登记冻结模型能力：inspect 前即暂停为不可判断路径，不发起任何调用', async () => {
  const record = makeRecord();
  record.snapshot.modelRoutes = {
    utility: { tier: 'utility', provider: 'unknown-vendor', model: 'mystery', temperature: 0.5 },
    writing: { tier: 'writing', provider: 'unknown-vendor', model: 'mystery', temperature: 0.7 },
  };
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'context_budget');
  // 能力未知即不可判断：不得向网关发起任何调用
  assert.equal(requests.length, 0);
});

test('C2 已知 provider、未登记 model：按不可判断路径暂停，不回落 provider 级猜测值', async () => {
  const record = makeRecord();
  record.snapshot.modelRoutes = {
    utility: {
      tier: 'utility',
      provider: 'deepseek',
      model: 'unknown-small-model',
      temperature: 0.5,
    },
    writing: {
      tier: 'writing',
      provider: 'deepseek',
      model: 'unknown-small-model',
      temperature: 0.7,
    },
  };
  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'context_budget');
  assert.equal(requests.length, 0);
});

test('F6 超长冻结项目指导：inspect 完整输入超预算，准入即暂停而非把超限输入发给模型', async () => {
  const record = makeRecord();
  record.snapshot.systemPromptText = '指导'.repeat(100_000); // ≈ 20 万字符
  record.snapshot.modelRoutes = {
    utility: { tier: 'utility', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.5 },
    writing: { tier: 'writing', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.7 },
  };
  let sentInspectChars = 0;
  const { gateway, requests } = makeGateway((request) => {
    if (request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY) {
      sentInspectChars = request.prompt.length;
    }
    return scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })(request);
  });

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'context_budget');
  // 超限输入在准入阶段被拒绝：从未发送给模型
  assert.equal(sentInspectChars, 0);
  assert.equal(requests.length, 0);
});

test('F6 plan 调用同样受完整输入预算约束：超长指导在规划阶段也会被拒绝', async () => {
  const record = makeRecord();
  // 让 inspect 通过（短指导），但在 inspect 完成后把指导放大到超预算（模拟运行中追加材料）
  record.snapshot.modelRoutes = {
    utility: { tier: 'utility', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.5 },
    writing: { tier: 'writing', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.7 },
  };
  const { gateway, requests } = makeGateway((request) => {
    if (request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY) {
      // 模拟 inspect 之后注入的超长参考材料，使 plan 的完整输入超出预算
      record.snapshot.systemPromptText = '材料'.repeat(100_000);
      return { text: INSPECT_OK };
    }
    return scriptByKey({
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
    })(request);
  });

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'context_budget');
  // 只发起了 inspect 一次；plan 因超预算在准入即被拒绝
  assert.equal(requests.length, 1);
  assert.equal(requests[0].templateKey, CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY);
});

// ── F4：冻结参考材料随每次调用下发，运行中修改来源不影响已冻结 run ──────────

test('F4 冻结参考材料随每次调用下发，运行中改人物/知识/样本不改变已冻结 run', async () => {
  const record = makeRecord();
  record.snapshot.modelRoutes = {
    utility: { tier: 'utility', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.5 },
    writing: { tier: 'writing', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.7 },
  };
  record.snapshot.referenceMaterials = {
    materials: [
      { kind: 'persona', id: 'p1', title: '甲', text: '冻结角色卡' },
      { kind: 'style', id: 's1', title: '样本', text: '冻结样本' },
    ],
    promptText: '冻结材料全文本',
    personaText: '【人物设定】甲：冻结角色卡',
    knowledgeText: '冻结知识：钥匙在桌上',
    styleSampleBlock: '【文风参照】\n冻结样本',
    frozenAt: '2026-10-06T00:00:00.000Z',
  };

  const { gateway, requests } = makeGateway(
    scriptByKey({
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: { text: INSPECT_OK },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: { text: PLAN_REWRITE },
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: { text: REWRITE_OK },
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: { text: REVIEW_OK },
    })
  );

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'ready');
  // 每次调用都携带同一份冻结参考材料（inspect + plan + rewrite + review）
  assert.ok(requests.length >= 4);
  for (const request of requests) {
    assert.deepEqual(request.frozenReferenceMaterials, record.snapshot.referenceMaterials);
  }
  // 冻结文本确实随请求下发给网关，而不是留在 API 内部
  assert.equal(requests[0].frozenReferenceMaterials?.personaText, '【人物设定】甲：冻结角色卡');
});

// ── C1：最终修复 / 回退结果不得被 checkpoint 写回旧稿（真实 service 回调路径）────

const C1_BASE = 'AAAA\n\nBBBB\n\nCCCC';

function c1Record(): RefinementRunRecord {
  const record = makeRecord();
  record.snapshot.baseText = C1_BASE;
  record.checkpoint = createInitialRefinementCheckpoint(C1_BASE);
  return record;
}

/**
 * C1 场景：3 段改写；最终整章检查报出**只在第 1 段候选可定位**的阻断。
 * - mode=repair：接缝修复成功并被接受；
 * - mode=revert：接缝修复未通过程序门禁 → 回退第 1 段原文。
 * 每次都带 `onCheckpoint`（真实 service 路径），用于验证终态与最后落库的候选一致。
 */
function c1Gateway(mode: 'repair' | 'revert', opts?: { unlocatableRound2?: boolean }) {
  const rewrites = ['AAAAA', 'BB', 'CCCCCC'];
  let rewriteCall = 0;
  let reviewCall = 0;
  const requests: RefinementGenerationRequest[] = [];
  const gateway: RefinementGenerationGateway = {
    async generate(request) {
      requests.push(request);
      const ok = (text: string): RefinementGenerationResult => ({
        ok: true,
        text,
        aborted: false,
        traceId: 'c1',
      });
      switch (request.templateKey) {
        case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
          return ok(multiSceneInspectScript());
        case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
          return ok(multiScenePlanScript());
        case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
          const text = rewrites[rewriteCall] ?? '';
          rewriteCall += 1;
          return ok(text);
        }
        case CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY:
          return mode === 'repair'
            ? ok('AAAAAAA')
            : { ok: false, text: '', aborted: false, traceId: 'c1', errorMessage: '补修失败' };
        case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY: {
          reviewCall += 1;
          if (reviewCall <= 3) {
            return ok(REVIEW_OK);
          }
          if (reviewCall === 4) {
            return ok(
              JSON.stringify({
                issues: [
                  {
                    kind: 'hard_constraint',
                    severity: 'high',
                    anchorQuote: 'AAAAA',
                    expectedFact: '接缝一致',
                    fixIntent: '修复第 1 段接缝',
                  },
                ],
                exitStateFacts: [],
              })
            );
          }
          if (opts?.unlocatableRound2) {
            // 第 1 段候选已回退：该引文只落在回退正文 / 旧候选上，无法定位到单一活动候选
            return ok(
              JSON.stringify({
                issues: [
                  {
                    kind: 'hard_constraint',
                    severity: 'high',
                    anchorQuote: 'AAAA',
                    expectedFact: '接缝一致',
                    fixIntent: '修复回退后的接缝',
                  },
                ],
                exitStateFacts: [],
              })
            );
          }
          return ok(REVIEW_OK);
        }
        default:
          return { ok: false, text: '', aborted: false, traceId: 'c1', errorMessage: 'no script' };
      }
    },
  };
  return { gateway, requests, reviewCalls: () => reviewCall };
}

test('C1 最终接缝修复成功：带 onCheckpoint 的终态与最后落库候选一致，不丢修复稿', async () => {
  const { gateway } = c1Gateway('repair');
  const checkpoints: RefinementCheckpoint[] = [];
  const { result } = await runEngine(gateway, c1Record(), undefined, {
    onCheckpoint: (checkpoint) => checkpoints.push(structuredClone(checkpoint)),
  });

  assert.equal(result.status, 'ready');
  assert.ok(
    result.checkpoint.acceptedDraftText.startsWith('AAAAAAA'),
    '最终正文须含已接受的接缝修复稿'
  );
  assert.ok(result.checkpoint.acceptedDraftText.endsWith('CCCCCC'));
  assert.ok(result.checkpoint.issues.some((issue) => issue.disposition === 'resolved'));

  // 关键：最后一次 checkpoint 落库的候选必须等于终态候选（不得被写回旧稿）
  const lastPersisted = checkpoints.at(-1);
  assert.ok(lastPersisted, '应至少提交一次 checkpoint');
  assert.equal(lastPersisted?.acceptedDraftText, result.checkpoint.acceptedDraftText);
  assert.ok(lastPersisted?.acceptedDraftText.startsWith('AAAAAAA'));
});

test('C1 最终接缝修复失败回退：终态正文回退原文，且不与变更清单 / 落库候选矛盾', async () => {
  const { gateway } = c1Gateway('revert');
  const checkpoints: RefinementCheckpoint[] = [];
  const { result } = await runEngine(gateway, c1Record(), undefined, {
    onCheckpoint: (checkpoint) => checkpoints.push(structuredClone(checkpoint)),
  });

  assert.equal(result.status, 'ready_with_issues');
  // 第 1 段已回退原文：正文以原文 'AAAA' 开头，且不再包含被回退的改写 'AAAAA'
  assert.ok(result.checkpoint.acceptedDraftText.startsWith('AAAA\n\n'));
  assert.equal(result.checkpoint.acceptedDraftText.includes('AAAAA'), false);
  assert.ok(result.checkpoint.acceptedDraftText.endsWith('CCCCCC'));
  // 变更清单已剔除被回退范围
  assert.equal(result.checkpoint.changes.length, 2);
  assert.equal(result.checkpoint.coverage.retainedOriginalChars, 4);

  // 最后一次落库候选同样不得复活已回退的旧稿
  const lastPersisted = checkpoints.at(-1);
  assert.equal(lastPersisted?.acceptedDraftText, result.checkpoint.acceptedDraftText);
  assert.equal(lastPersisted?.changes.length, 2);
});

test('C1 无法定位到单一活动候选的阻断不得降级为提示：暂停而非可应用', async () => {
  const { gateway } = c1Gateway('revert', { unlocatableRound2: true });
  const { result } = await runEngine(gateway, c1Record());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'boundary_conflict');
  assert.ok(
    result.checkpoint.issues.some(
      (issue) => issue.anchorQuote === 'AAAA' && issue.disposition === 'unresolved'
    ),
    '无法定位的阻断必须记为 unresolved，而不是降级为 warning'
  );
});

// ── 第四轮回归：正常范围预算误杀 / 最终复检保存失败 / unresolved 阻断可应用 ──────

test('D1 正常 3500+ 字范围在已登记模型能力下可以改写（预算不得误杀）', async () => {
  // 3 个块、每块约 1222 字，整单位约 3670 字——报告中的「正常 3500 字范围」
  const paragraph = '夜幕低垂，城中灯火次第亮起，长街尽头传来更鼓声声。'.repeat(47);
  const bigBase = [paragraph, paragraph, paragraph].join('\n\n');
  const record = makeRecord();
  record.snapshot.baseText = bigBase;
  record.checkpoint = createInitialRefinementCheckpoint(bigBase);
  // 已登记能力：deepseek/deepseek-chat（单次输出上限 8192）
  const route = {
    tier: 'writing' as const,
    provider: 'deepseek',
    model: 'deepseek-chat',
    temperature: 0.7,
  };
  record.snapshot.modelRoutes = {
    writing: route,
    utility: { ...route, tier: 'utility' as const },
  };

  const rewriteText = '夜幕降临，灯火亮起。他推门而入，屋内寂静无声。';
  const { gateway, requests } = makeGateway(
    singleSceneScripts({
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: () => ({ text: rewriteText }),
    })
  );

  const { result } = await runEngine(gateway, record);

  assert.equal(result.status, 'ready');
  assert.equal(result.checkpoint.acceptedDraftText, rewriteText);
  // rewrite 必须真的被调用——不得因预算误判保留原文就标记就绪
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY)
      .length,
    1
  );
});

test('D2 整章最终接缝修复后复检保存失败：暂停 persistence_failed，不得回退后放行', async () => {
  let reviewCalls = 0;
  const { gateway } = makeGateway(
    singleSceneScripts({
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: () => {
        reviewCalls += 1;
        // 单位 review 阻断 → 单位补修通过；整章最终检查再阻断 → 触发接缝修复
        return { text: reviewCalls === 1 || reviewCalls === 3 ? REVIEW_BLOCKING : REVIEW_OK };
      },
      [CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY]: () => ({ text: REWRITE_REPAIRED }),
    })
  );
  // 调用序列：1 inspect / 2 plan / 3 rewrite / 4 review(单位) / 5 repair(单位) /
  // 6 review(单位复检) / 7 review(整章最终) / 8 repair(接缝) / 9 review(接缝复检)
  // 让第 9 次调用前的 checkpoint 落库失败
  let preCallCommits = 0;
  const { result } = await runEngine(gateway, makeRecord(), undefined, {
    onCheckpoint: (checkpoint) => {
      if (checkpoint.progress.message.startsWith('调用前保存进度')) {
        preCallCommits += 1;
        if (preCallCommits === 9) {
          throw new Error('storage unavailable');
        }
      }
    },
  });

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'persistence_failed');
  assert.equal(reviewCalls >= 3, true, '应已进入整章最终接缝复检');
});

test('D3 仍生效候选携带未解决阻断：返回暂停而非可应用终态', async () => {
  let reviewCalls = 0;
  const { gateway } = makeGateway(
    singleSceneScripts({
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: () => {
        reviewCalls += 1;
        // 单位 review 阻断；补修上游失败（候选仍生效、阻断未消解）；整章最终检查无阻断
        return { text: reviewCalls === 1 ? REVIEW_BLOCKING : REVIEW_OK };
      },
      [CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY]: () => ({
        ok: false,
        errorMessage: 'upstream timeout',
      }),
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'paused');
  assert.equal(result.pauseReason, 'boundary_conflict');
  assert.equal(
    result.checkpoint.issues.some(
      (issue) => issue.disposition === 'unresolved' && issue.severity === 'high'
    ),
    true
  );
  // 流程确实走完了整章最终检查（单位 review + 最终检查），不是中途夭折
  assert.equal(reviewCalls >= 2, true);
});

// ── B1：应用资格与问题生命周期（AQ-383）─────────────────────────────────

/**
 * B1/E1 场景：两场。第 2 场规划未给出 brief → 程序生成**没有 unitId** 的
 * coverage/retained_original 提示，且该场保留原文；第 1 场正常改写。
 * 整章最终检查报出**无法定位到单一活动候选**的全章 hard_constraint/high（同样没有 unitId）。
 */
const E1_BASE = [
  '甲推开门，屋内一片寂静，远处传来打更声。',
  '乙静候门外，灯火渐次亮起，街角有人低声交谈。',
].join('\n\n');

const E1_INSPECT = JSON.stringify({
  windowId: 'w0',
  sceneFragments: [
    {
      startBlockId: 'b0',
      endBlockId: 'b0',
      startsNewScene: true,
      confidence: 'high',
      goal: '甲入场',
      entryFacts: [],
      exitFacts: [],
      proposedBeatEnds: [],
    },
    {
      startBlockId: 'b1',
      endBlockId: 'b1',
      startsNewScene: true,
      confidence: 'high',
      goal: '乙候于门外',
      entryFacts: [],
      exitFacts: [],
      proposedBeatEnds: [],
    },
  ],
  issues: [],
});

/** 只给 scene-1（b0）brief：scene-2 无 brief → 保留原文并生成无 unitId 的覆盖提示 */
const E1_PLAN = JSON.stringify({
  chapterIntent: '收紧节奏，强化归来时的落寞',
  protectedFacts: [],
  sceneBriefs: [
    {
      sceneId: 'scene-1',
      sourceBlockIds: ['b0'],
      decision: 'rewrite',
      reason: '铺陈偏散',
      editIntent: '压缩为一句连贯动作',
      expectedChange: '更紧凑',
      entryFacts: [],
      exitFacts: [],
      protectedSpanIds: [],
      targetLength: { direction: 'condense' },
      checks: [],
    },
  ],
});

const E1_REWRITE = '甲推门而入，屋内寂静无声，远处打更声隐约传来。';

/** 引文在候选与原文中都找不到 → 无法定位到单一活动候选 */
const E1_FINAL_BLOCKING = JSON.stringify({
  issues: [
    {
      kind: 'hard_constraint',
      severity: 'high',
      anchorQuote: '不存在于正文中的引文',
      expectedFact: '整章首尾状态一致',
      sourceEvidence: '整章',
      fixIntent: '修复整章层面的状态冲突',
    },
  ],
  exitStateFacts: [],
});

function e1Record(): RefinementRunRecord {
  const record = makeRecord();
  record.snapshot.baseText = E1_BASE;
  record.checkpoint = createInitialRefinementCheckpoint(E1_BASE);
  return record;
}

/** 首轮：单位 review 通过，整章最终检查报出无法定位的全章阻断 */
function e1FirstGateway() {
  let reviewCalls = 0;
  return makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: E1_INSPECT };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: E1_PLAN };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY:
        return { text: E1_REWRITE };
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        reviewCalls += 1;
        return { text: reviewCalls >= 2 ? E1_FINAL_BLOCKING : REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });
}

test('E1 无 unitId 的全章保留提示不得豁免全章阻断：暂停后继续仍必须暂停', async () => {
  const first = e1FirstGateway();
  const paused = await runEngine(first.gateway, e1Record());

  assert.equal(paused.result.status, 'paused');
  assert.equal(paused.result.pauseReason, 'boundary_conflict');
  // 确实存在「没有 unitId」的 retained_original 覆盖提示（第 2 场保留原文）
  assert.equal(
    paused.result.checkpoint.issues.some(
      (issue) => issue.disposition === 'retained_original' && issue.unitId === undefined
    ),
    true,
    '第 2 场应生成无 unitId 的保留原文提示'
  );
  // 确实存在「没有 unitId」的未解决全章阻断
  assert.equal(
    paused.result.checkpoint.issues.some(
      (issue) =>
        issue.disposition === 'unresolved' &&
        issue.severity === 'high' &&
        issue.unitId === undefined
    ),
    true,
    '无法定位的全章阻断应记为无 unitId 的 unresolved'
  );

  // 续跑：本轮 review 全部返回无问题——旧阻断仍 unresolved，不得因其他保留提示而放行
  const resumedRecord = e1Record();
  resumedRecord.status = 'paused';
  resumedRecord.pauseReason = 'boundary_conflict';
  resumedRecord.resumable = true;
  resumedRecord.checkpoint = paused.result.checkpoint;

  let resumeReviews = 0;
  const resumed = makeGateway(() => {
    resumeReviews += 1;
    return { text: REVIEW_OK };
  });
  const again = await runEngine(resumed.gateway, resumedRecord);

  assert.equal(resumeReviews >= 1, true, '续跑应重新执行整章最终检查');
  assert.equal(
    again.result.status,
    'paused',
    '无 unitId 的全章阻断不得被其他无 unitId 的保留提示豁免'
  );
  assert.equal(again.result.pauseReason, 'boundary_conflict');
  assert.equal(
    again.result.checkpoint.issues.some(
      (issue) => issue.disposition === 'unresolved' && issue.severity === 'high'
    ),
    true
  );
});

test('B1 同一单位旧候选被回退：旧阻断显式结案，终态 ready_with_issues', async () => {
  // 单位 review 报可定位阻断 → 单位补修输出未完整收束（unresolved，带候选版本）
  // → 整章最终检查再报同一范围阻断 → 接缝补修未过门禁 → 回退该范围原文 → 旧阻断随之失效
  let reviewCalls = 0;
  let repairCalls = 0;
  const { gateway } = makeGateway(
    singleSceneScripts({
      [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: () => {
        reviewCalls += 1;
        return { text: reviewCalls <= 2 ? REVIEW_BLOCKING : REVIEW_OK };
      },
      [CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY]: () => {
        repairCalls += 1;
        // 第 1 次（单位补修）输出未完整收束；第 2 次（接缝补修）未通过程序门禁
        return repairCalls === 1
          ? { ok: false, text: '', completionFailure: 'incomplete_stream' as const }
          : { text: '（此处省略）他推门而入。' };
      },
    })
  );

  const { result } = await runEngine(gateway, makeRecord());

  assert.equal(result.status, 'ready_with_issues');
  assert.equal(result.checkpoint.acceptedDraftText, BASE_TEXT);
  // 旧阻断必须**显式结案**并留下处置依据，而不是继续 unresolved 靠推断豁免
  const closed = result.checkpoint.issues.filter(
    (issue) => issue.unitId === 'u0' && issue.message.includes('已失效')
  );
  assert.equal(closed.length >= 1, true, '被回退的旧候选问题必须显式结案并记录依据');
  assert.equal(
    closed.every((issue) => issue.disposition !== 'unresolved'),
    true
  );
  assert.equal(
    result.checkpoint.issues.some(
      (issue) => issue.disposition === 'unresolved' && issue.severity === 'high'
    ),
    false,
    '不应残留未解决的高危阻断'
  );
});

test('B1 旧 checkpoint 声称最终检查已完成但覆盖记录缺失：续跑必须重跑最终检查', async () => {
  // 首次：预算只够跑到第 1 段接受，随后暂停
  const first = makeRecord();
  first.snapshot.baseText = MULTI_BLOCK_TEXT;
  first.checkpoint = createInitialRefinementCheckpoint(MULTI_BLOCK_TEXT);
  first.snapshot.resolvedPolicy = { ...first.snapshot.resolvedPolicy, maxCallsPerAttempt: 6 };

  let firstRewriteCall = 0;
  const firstRun = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
        return { text: multiSceneInspectScript() };
      case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
        return { text: multiScenePlanScript() };
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = ['AAAAA', 'BB', 'CCCCCC'][firstRewriteCall] ?? '';
        firstRewriteCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        return { text: REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });
  const paused = await runEngine(firstRun.gateway, first);
  assert.equal(paused.result.status, 'paused');

  // 伪造一个「声称已完成最终检查」但覆盖记录为空的旧 checkpoint
  const staleCheckpoint = structuredClone(paused.result.checkpoint);
  assert.ok(staleCheckpoint.resumeState);
  staleCheckpoint.resumeState = {
    ...staleCheckpoint.resumeState!,
    finalCheckCompleted: true,
    finalCheckCoveredUnitIds: [],
  };

  const resumedRecord = makeRecord();
  resumedRecord.snapshot.baseText = MULTI_BLOCK_TEXT;
  resumedRecord.snapshot.resolvedPolicy = {
    ...resumedRecord.snapshot.resolvedPolicy,
    maxCallsPerAttempt: 80,
  };
  resumedRecord.status = 'paused';
  resumedRecord.pauseReason = 'budget_exhausted';
  resumedRecord.resumable = true;
  resumedRecord.checkpoint = staleCheckpoint;

  let resumeRewriteCall = 0;
  let resumeReviewCalls = 0;
  const resumeRun = makeGateway((request) => {
    switch (request.templateKey) {
      case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
        const text = ['BB', 'CCCCCC'][resumeRewriteCall] ?? '';
        resumeRewriteCall += 1;
        return { text };
      }
      case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
        resumeReviewCalls += 1;
        return { text: REVIEW_OK };
      default:
        return { ok: false, errorMessage: `no script for ${request.templateKey}` };
    }
  });

  const completed = await runEngine(resumeRun.gateway, resumedRecord);

  assert.equal(completed.result.status, 'ready');
  // 剩余 2 段的单位 review（2 次）+ 被强制重跑的整章最终检查（至少 1 次）
  assert.equal(
    resumeReviewCalls >= 3,
    true,
    `覆盖记录不完整时必须保守重跑整章最终检查（实际 review ${resumeReviewCalls} 次）`
  );
});

test('R2 同句后续转移：不得登记错误确定状态，也不得传给下一范围', async () => {
  // 中性复现正文：同一句内先拿钥匙、后放下，句中没有逗号分隔
  const unitOne = '甲手里拿着钥匙走到门边后把钥匙放在桌上。';
  const sameSentenceAnchor = JSON.stringify({
    issues: [],
    exitStateFacts: [
      {
        key: 'holding',
        value: '拿着钥匙',
        sourceBlockId: 'b0',
        anchorQuote: '甲手里拿着钥匙',
        exitAnchorQuote: '甲手里拿着钥匙',
      },
    ],
  });

  const { gateway, requests } = makeGateway(
    multiSceneScripts({
      rewrites: [unitOne, 'BB', 'CCCCCC'],
      reviews: [() => sameSentenceAnchor],
    })
  );

  const { result } = await runEngine(gateway, multiSceneRecord());

  const prompts = rewritePrompts(requests);
  assert.equal(prompts.length, 3);
  const nextConfirmedSection = prompts[1]?.split(STATE_FACT_SECTION)[1]?.split('【')[0] ?? '';
  assert.equal(
    prompts[1]?.includes(STATE_FACT_SECTION),
    false,
    '同句后续变化取代的状态不得进入下一范围的已确认状态小节'
  );
  assert.equal(
    nextConfirmedSection.includes('拿着钥匙'),
    false,
    '已确认状态小节不得出现该状态（不按全文是否含词判定）'
  );
  assert.equal(
    (result.checkpoint.resumeState?.stateFacts ?? []).some(
      (fact) => fact.key === 'holding' && fact.value === '拿着钥匙'
    ),
    false,
    'checkpoint 不得把它记为确定状态'
  );
  assert.equal(result.status, 'ready');
});
