import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRefinementApplyConfirmCopy,
  buildRefinementApplyPayload,
  buildRefinementRunCorrelation,
  canCancelRefinementRun,
  canDiscardRefinementRun,
  canResumeRefinementRun,
  createRefinementClientRequestId,
  createRefinementStartRequestIdTracker,
  describeRefinementPauseState,
  formatRefinementCoverage,
  formatRefinementIssueSeverity,
  formatRefinementPauseReason,
  formatRefinementProgressText,
  formatRefinementRewritePolicyLabel,
  formatRefinementStatusLabel,
  formatRefinementStorageModeLabel,
  formatRefinementTemplateVersion,
  formatRefinementUsage,
  isChapterRefinementEntryEnabled,
  isRefinementActive,
  isRefinementCandidateReady,
  isRefinementTerminal,
  parseRefinementStreamEvent,
  resolveOptimizeEntryGuard,
  resolveRefinementApplyGate,
  resolveRefinementProgressPercent,
  resolveRefinementResumeRun,
  type RefinementRunSummary,
  type RefinementRunView,
  type RefinementPauseReason,
} from './chapterRefinement';

/** C3：暂停原因枚举全量清单，编译期强制与 schema 同步（新增值未登记即报错）。 */
const ALL_PAUSE_REASONS = [
  'user_cancelled',
  'budget_exhausted',
  'upstream_failure',
  'process_restart',
  'context_budget',
  'invalid_model_output',
  'boundary_conflict',
  'permission_revoked',
  'source_changed',
  'persistence_failed',
] as const satisfies readonly RefinementPauseReason[];

type MissingPauseReason = Exclude<RefinementPauseReason, (typeof ALL_PAUSE_REASONS)[number]>;
const PAUSE_REASON_LIST_IS_EXHAUSTIVE: MissingPauseReason extends never ? true : never = true;

function buildRun(patch: Partial<RefinementRunSummary>): RefinementRunSummary {
  return {
    runId: 'run-1',
    projectId: 'p1',
    chapterNo: 3,
    status: 'queued',
    phase: 'reading',
    revision: 1,
    attemptId: null,
    baseUpdatedAt: '2026-10-06T10:00:00.000Z',
    baseHash: 'hash',
    rewritePolicy: 'preserve-plot',
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    expiresAt: '2026-10-13T10:00:00.000Z',
    resumable: false,
    storageMode: 'memory',
    progress: { unitIndex: 0, unitTotal: 0, message: '已冻结原文，等待开始' },
    resolvedPolicy: {
      diagnosisTargetChars: 3000,
      rewriteTargetChars: 3500,
      rewriteMaxChars: 5200,
      maxRepairPasses: 1,
      maxCallsPerAttempt: 80,
      maxActiveMsPerAttempt: 1_800_000,
    },
    usage: { callCount: 0, activeElapsedMs: 0, tokenAccounting: 'unavailable' },
    ...patch,
  };
}

test('草稿入口默认不公开，仅显式 ?refinement=1 可见', () => {
  assert.equal(isChapterRefinementEntryEnabled(''), false);
  assert.equal(isChapterRefinementEntryEnabled('?foo=1'), false);
  assert.equal(isChapterRefinementEntryEnabled('?refinement=0'), false);
  assert.equal(isChapterRefinementEntryEnabled('?refinement=1'), true);
  assert.equal(isChapterRefinementEntryEnabled('?refinement=true'), true);
  assert.equal(isChapterRefinementEntryEnabled('refinement=1'), true);
  assert.equal(isChapterRefinementEntryEnabled('?a=1&refinement=1&b=2'), true);
});

test('状态分类：活动 / 终态 / 候选就绪互不混淆', () => {
  assert.equal(isRefinementActive('queued'), true);
  assert.equal(isRefinementActive('running'), true);
  assert.equal(isRefinementActive('paused'), false);
  assert.equal(isRefinementActive('ready'), false);

  assert.equal(isRefinementTerminal('ready'), true);
  assert.equal(isRefinementTerminal('ready_with_issues'), true);
  assert.equal(isRefinementTerminal('failed'), true);
  assert.equal(isRefinementTerminal('discarded'), true);
  assert.equal(isRefinementTerminal('expired'), true);
  assert.equal(isRefinementTerminal('running'), false);

  assert.equal(isRefinementCandidateReady('ready'), true);
  assert.equal(isRefinementCandidateReady('ready_with_issues'), true);
  assert.equal(isRefinementCandidateReady('paused'), false);
});

test('标签函数覆盖全部枚举值', () => {
  assert.equal(formatRefinementStatusLabel('ready_with_issues'), '候选已就绪（含提示）');
  assert.equal(formatRefinementStorageModeLabel('postgres'), 'PostgreSQL 持久化');
  assert.match(formatRefinementStorageModeLabel('memory'), /内存模式/);
  assert.equal(formatRefinementRewritePolicyLabel('scene-rewrite'), '场内创编');
  assert.equal(formatRefinementRewritePolicyLabel('preserve-plot'), '保留剧情');
  assert.equal(formatRefinementPauseReason('source_changed'), '原文已变更');
  assert.equal(formatRefinementPauseReason('persistence_failed'), '进度保存失败');
});

test('C3 暂停原因全部有中文标签，新增枚举不得回退为原始 key', () => {
  assert.equal(PAUSE_REASON_LIST_IS_EXHAUSTIVE, true);
  for (const reason of ALL_PAUSE_REASONS) {
    const label = formatRefinementPauseReason(reason);
    assert.notEqual(label, reason, `暂停原因 ${reason} 缺少中文标签`);
    assert.ok(label.trim().length > 0, `暂停原因 ${reason} 标签为空`);
  }
});

test('进度百分比：候选就绪为 100，按单位占比封顶 99，否则回落到阶段权重', () => {
  assert.equal(
    resolveRefinementProgressPercent(
      { unitIndex: 1, unitTotal: 4, message: '' },
      'running',
      'rewriting'
    ),
    25
  );
  assert.equal(
    resolveRefinementProgressPercent(
      { unitIndex: 9, unitTotal: 4, message: '' },
      'running',
      'rewriting'
    ),
    99
  );
  assert.equal(
    resolveRefinementProgressPercent(
      { unitIndex: 0, unitTotal: 0, message: '' },
      'ready',
      'finished'
    ),
    100
  );
  assert.equal(
    resolveRefinementProgressPercent(
      { unitIndex: 0, unitTotal: 0, message: '' },
      'running',
      'planning'
    ),
    30
  );
});

test('单位进度文案只在有总数时展示', () => {
  assert.equal(formatRefinementProgressText({ unitIndex: 0, unitTotal: 0, message: '' }), '');
  assert.equal(
    formatRefinementProgressText({ unitIndex: 2, unitTotal: 5, message: '' }),
    '第 2 / 5 个范围'
  );
});

test('用量与覆盖度文案区分估算与实测', () => {
  assert.match(
    formatRefinementUsage({ callCount: 3, activeElapsedMs: 12_000, tokenAccounting: 'estimated' }),
    /调用 3 次 · 活跃 12s · 估算用量/
  );
  assert.match(
    formatRefinementUsage({ callCount: 0, activeElapsedMs: 0, tokenAccounting: 'unavailable' }),
    /用量不可用/
  );
  assert.match(
    formatRefinementCoverage({
      sourceChars: 12000,
      plannedChars: 12000,
      processedChars: 0,
      retainedOriginalChars: 12000,
    }),
    /原文 12000 字/
  );
  // 未处理范围由程序推算：sourceChars - processedChars，供整章进度展示
  assert.match(
    formatRefinementCoverage({
      sourceChars: 12000,
      plannedChars: 12000,
      processedChars: 4000,
      retainedOriginalChars: 4000,
    }),
    /已处理 4000 字 · 保留原文 4000 字 · 未处理 8000 字/
  );
  assert.match(
    formatRefinementCoverage({
      sourceChars: 100,
      plannedChars: 100,
      processedChars: 100,
      retainedOriginalChars: 0,
    }),
    /未处理 0 字/
  );
});

test('恢复选择：优先活动 run，否则最近一次 run', () => {
  assert.equal(resolveRefinementResumeRun([]), null);

  const terminal = buildRun({ runId: 'r-terminal', status: 'ready' });
  const older = buildRun({ runId: 'r-older', status: 'ready' });
  assert.equal(resolveRefinementResumeRun([terminal, older])?.runId, 'r-terminal');

  const active = buildRun({ runId: 'r-active', status: 'running' });
  assert.equal(resolveRefinementResumeRun([terminal, active])?.runId, 'r-active');
});

test('SSE 解析：snapshot / stage / finished / error，未知与缺失字段安全忽略', () => {
  const snapshot = parseRefinementStreamEvent(
    JSON.stringify({
      event: 'snapshot',
      runId: 'run-1',
      revision: 2,
      attemptId: 'a1',
      seq: 0,
      run: { runId: 'run-1', baseText: 'x', acceptedDraftText: 'x' },
    })
  );
  assert.equal(snapshot?.event, 'snapshot');
  if (snapshot?.event === 'snapshot') {
    assert.equal(snapshot.run.runId, 'run-1');
  }

  const stage = parseRefinementStreamEvent(
    JSON.stringify({
      event: 'stage',
      runId: 'run-1',
      revision: 3,
      attemptId: 'a1',
      seq: 1,
      phase: 'rewriting',
      unitIndex: 1,
      unitTotal: 4,
      message: '处理第 1 段',
    })
  );
  assert.equal(stage?.event, 'stage');
  if (stage?.event === 'stage') {
    assert.equal(stage.phase, 'rewriting');
    assert.equal(stage.unitIndex, 1);
    assert.equal(stage.unitTotal, 4);
    assert.equal(stage.message, '处理第 1 段');
  }

  const finished = parseRefinementStreamEvent(
    JSON.stringify({
      event: 'finished',
      runId: 'run-1',
      revision: 4,
      attemptId: 'a1',
      seq: 2,
      run: { runId: 'run-1', status: 'ready' },
    })
  );
  assert.equal(finished?.event, 'finished');

  const error = parseRefinementStreamEvent(
    JSON.stringify({
      event: 'error',
      runId: 'run-1',
      revision: 4,
      attemptId: null,
      seq: 3,
      message: '炸了',
    })
  );
  assert.equal(error?.event, 'error');
  if (error?.event === 'error') {
    assert.equal(error.message, '炸了');
    assert.equal(error.attemptId, null);
  }

  // 后续任务预留事件不应打断当前客户端
  assert.equal(parseRefinementStreamEvent(JSON.stringify({ event: 'content', runId: 'r' })), null);
  assert.equal(parseRefinementStreamEvent(JSON.stringify({ event: 'stage', revision: 1 })), null);
  assert.equal(parseRefinementStreamEvent('not-json'), null);
  assert.equal(parseRefinementStreamEvent(JSON.stringify({ event: 'snapshot', runId: 'r' })), null);
});

test('clientRequestId 每次生成都不同且非空', () => {
  const first = createRefinementClientRequestId();
  const second = createRefinementClientRequestId();
  assert.ok(first.length > 0);
  assert.notEqual(first, second);
});

function buildView(patch: Partial<RefinementRunView> = {}): RefinementRunView {
  const summary = buildRun({ status: 'ready', phase: 'finished' });
  return {
    ...summary,
    instruction: '收紧节奏',
    baseText: '原文正文',
    acceptedDraftText: '改写后的正文',
    chapterBrief: null,
    changes: [],
    issues: [],
    coverage: {
      sourceChars: 4,
      plannedChars: 4,
      processedChars: 4,
      retainedOriginalChars: 0,
    },
    sourceCurrent: true,
    ...patch,
  };
}

test('应用请求：planId=runId、锁定 baseUpdatedAt、保留摘要', () => {
  const payload = buildRefinementApplyPayload({
    runId: 'run-9',
    baseUpdatedAt: '2026-10-06T10:00:00.000Z',
    draftText: '候选正文',
  });
  assert.deepEqual(payload, {
    draftText: '候选正文',
    expectedChapterUpdatedAt: '2026-10-06T10:00:00.000Z',
    planId: 'run-9',
    preserveSummary: true,
  });
});

test('应用门禁：仅整章已处理且候选异于原文的终态可应用', () => {
  assert.equal(resolveRefinementApplyGate(null).canApply, false);
  assert.equal(resolveRefinementApplyGate(buildView({ status: 'running' })).canApply, false);
  assert.equal(resolveRefinementApplyGate(buildView({ status: 'paused' })).canApply, false);
  assert.match(resolveRefinementApplyGate(buildView({ status: 'paused' })).reason, /已暂停/);
  assert.equal(resolveRefinementApplyGate(buildView({ acceptedDraftText: '   ' })).canApply, false);
  assert.match(
    resolveRefinementApplyGate(
      buildView({
        coverage: {
          sourceChars: 100,
          plannedChars: 100,
          processedChars: 40,
          retainedOriginalChars: 60,
        },
      })
    ).reason,
    /尚未全部处理/
  );
  assert.match(
    resolveRefinementApplyGate(buildView({ acceptedDraftText: '原文正文' })).reason,
    /一致/
  );
  assert.equal(resolveRefinementApplyGate(buildView()).canApply, true);
  assert.equal(
    resolveRefinementApplyGate(buildView({ status: 'ready_with_issues' })).canApply,
    true
  );
});

test('B1 应用门禁：账本仍有未解决的高/中危阻断时不可应用（含历史 ready_with_issues 运行）', () => {
  const blocking = {
    id: 'i9',
    category: 'hard_constraint' as const,
    severity: 'high' as const,
    message: '整章最终检查：首尾状态冲突（无法定位到单一活动候选）',
    disposition: 'unresolved' as const,
  };
  const gate = resolveRefinementApplyGate(
    buildView({ status: 'ready_with_issues', issues: [blocking] })
  );
  assert.equal(gate.canApply, false);
  assert.match(gate.reason, /未解决的阻断/);

  // 已结案的保留原文提示、低危提示都不阻断应用
  assert.equal(
    resolveRefinementApplyGate(
      buildView({
        status: 'ready_with_issues',
        issues: [
          { ...blocking, disposition: 'retained_original' },
          { ...blocking, severity: 'low' },
        ],
      })
    ).canApply,
    true
  );
});

test('应用确认文案：干净 ready 常规确认，ready_with_issues 列出问题与保留原文', () => {
  const clean = buildRefinementApplyConfirmCopy({ chapterNo: 3, run: buildView() });
  assert.equal(clean.requiresIssueAcknowledgement, false);
  assert.match(clean.content, /第 3 章/);
  assert.equal(clean.content.includes('未解决问题'), false);

  const withIssues = buildRefinementApplyConfirmCopy({
    chapterNo: 3,
    run: buildView({
      status: 'ready_with_issues',
      issues: [
        {
          id: 'i1',
          category: 'hard_constraint',
          severity: 'high',
          message: '第 2 段：候选丢失逐字锁内容',
          disposition: 'retained_original',
        },
        {
          id: 'i2',
          category: 'style',
          severity: 'low',
          message: '可更细腻',
          disposition: 'warning',
        },
      ],
      coverage: {
        sourceChars: 100,
        plannedChars: 100,
        processedChars: 100,
        retainedOriginalChars: 40,
      },
    }),
  });
  assert.equal(withIssues.requiresIssueAcknowledgement, true);
  // 只统计未解决／保留原文的问题：warning 不计入
  assert.match(withIssues.content, /1 条未解决问题/);
  assert.match(withIssues.content, /40 字保留原文/);
  assert.match(withIssues.okText, /我已阅读问题/);

  // 即使状态为 ready，只要存在保留原文或未解决问题，也要求确认
  const retainedOnly = buildRefinementApplyConfirmCopy({
    chapterNo: 3,
    run: buildView({
      coverage: {
        sourceChars: 100,
        plannedChars: 100,
        processedChars: 100,
        retainedOriginalChars: 20,
      },
    }),
  });
  assert.equal(retainedOnly.requiresIssueAcknowledgement, true);
});

test('问题严重度标签覆盖 high/medium/low', () => {
  assert.equal(formatRefinementIssueSeverity('high'), '严重');
  assert.equal(formatRefinementIssueSeverity('medium'), '中等');
  assert.equal(formatRefinementIssueSeverity('low'), '提示');
});

// ── 5.1：运行操作（取消 / 继续 / 放弃） ────────────────────────────────

test('取消入口：仅进行中的 run 可取消', () => {
  assert.equal(canCancelRefinementRun(null), false);
  assert.equal(canCancelRefinementRun(buildRun({ status: 'queued' })), true);
  assert.equal(canCancelRefinementRun(buildRun({ status: 'running' })), true);
  assert.equal(canCancelRefinementRun(buildRun({ status: 'paused' })), false);
  assert.equal(canCancelRefinementRun(buildRun({ status: 'ready' })), false);
  assert.equal(canCancelRefinementRun(buildRun({ status: 'discarded' })), false);
});

test('继续入口：仅可恢复的暂停态可继续', () => {
  assert.equal(canResumeRefinementRun(null), false);
  assert.equal(canResumeRefinementRun(buildRun({ status: 'running', resumable: false })), false);
  // 暂停但不可恢复（原文变更 / 权限撤销）不得展示继续
  assert.equal(
    canResumeRefinementRun(
      buildRun({ status: 'paused', resumable: false, pauseReason: 'source_changed' })
    ),
    false
  );
  assert.equal(
    canResumeRefinementRun(
      buildRun({ status: 'paused', resumable: true, pauseReason: 'budget_exhausted' })
    ),
    true
  );
  assert.equal(canResumeRefinementRun(buildRun({ status: 'ready', resumable: true })), false);
});

test('放弃入口：任意非已放弃 / 已过期状态都可放弃', () => {
  assert.equal(canDiscardRefinementRun(null), false);
  assert.equal(canDiscardRefinementRun(buildRun({ status: 'queued' })), true);
  assert.equal(canDiscardRefinementRun(buildRun({ status: 'running' })), true);
  assert.equal(canDiscardRefinementRun(buildRun({ status: 'paused' })), true);
  assert.equal(canDiscardRefinementRun(buildRun({ status: 'ready' })), true);
  assert.equal(canDiscardRefinementRun(buildRun({ status: 'ready_with_issues' })), true);
  assert.equal(canDiscardRefinementRun(buildRun({ status: 'failed' })), true);
  assert.equal(canDiscardRefinementRun(buildRun({ status: 'discarded' })), false);
  assert.equal(canDiscardRefinementRun(buildRun({ status: 'expired' })), false);
});

test('暂停提示：区分可继续、服务重启（内存不可恢复）与不可继续', () => {
  // 非暂停态不展示提示
  assert.equal(describeRefinementPauseState(buildRun({ status: 'running' })), '');
  // 普通暂停可继续
  assert.match(
    describeRefinementPauseState(
      buildRun({ status: 'paused', resumable: true, pauseReason: 'budget_exhausted' })
    ),
    /可点击继续/
  );
  // 服务重启 + PostgreSQL：进度保留可继续
  assert.match(
    describeRefinementPauseState(
      buildRun({
        status: 'paused',
        resumable: true,
        pauseReason: 'process_restart',
        storageMode: 'postgres',
      })
    ),
    /已保留进度，可点击继续/
  );
  // 服务重启 + 内存模式：不承诺恢复（R10）
  assert.match(
    describeRefinementPauseState(
      buildRun({
        status: 'paused',
        resumable: true,
        pauseReason: 'process_restart',
        storageMode: 'memory',
      })
    ),
    /内存模式无法恢复/
  );
  // 不可恢复：提示新建
  assert.match(
    describeRefinementPauseState(
      buildRun({ status: 'paused', resumable: false, pauseReason: 'source_changed' })
    ),
    /请新建精修/
  );
});

test('模板版本单行展示含 key / version / hash 前缀', () => {
  assert.equal(
    formatRefinementTemplateVersion({
      key: 'chapter.refinement.rewrite',
      version: 3,
      hash: 'abcdef0123456789',
    }),
    'chapter.refinement.rewrite v3 (abcdef01)'
  );
  // 无 hash 时不产生空括号
  assert.equal(
    formatRefinementTemplateVersion({ key: 'chapter.refinement.plan', version: 1, hash: '' }),
    'chapter.refinement.plan v1'
  );
});

test('运行关联信息汇总 runId / attemptId / trace / 模板版本，缺失项用占位', () => {
  const correlation = buildRefinementRunCorrelation(
    buildView({
      runId: 'run-42',
      attemptId: 'attempt-7',
      creationTraceId: 'trace-xyz',
      frozenTemplateVersions: [
        { key: 'chapter.refinement.rewrite', version: 2, hash: 'aaaaaaaa' },
        { key: 'chapter.refinement.review', version: 1, hash: 'bbbbbbbb' },
      ],
    })
  );
  assert.equal(correlation.runId, 'run-42');
  assert.equal(correlation.attemptId, 'attempt-7');
  assert.equal(correlation.creationTraceId, 'trace-xyz');
  assert.deepEqual(correlation.templateVersions, [
    'chapter.refinement.rewrite v2 (aaaaaaaa)',
    'chapter.refinement.review v1 (bbbbbbbb)',
  ]);
});

test('运行关联信息：无 run 与缺失字段时降级为占位，不抛错', () => {
  const empty = buildRefinementRunCorrelation(null);
  assert.deepEqual(empty, {
    runId: '',
    attemptId: '',
    creationTraceId: '',
    templateVersions: [],
  });

  const partial = buildRefinementRunCorrelation(
    buildView({ attemptId: null, creationTraceId: null, frozenTemplateVersions: undefined })
  );
  assert.equal(partial.attemptId, '无进行中的尝试');
  assert.equal(partial.creationTraceId, '未记录');
  assert.deepEqual(partial.templateVersions, []);
});

test('入口守卫：无未保存改动时不拦截', () => {
  const guard = resolveOptimizeEntryGuard({ chapterNo: 3, hasPendingEdit: false });
  assert.equal(guard.blocked, false);
  assert.equal(guard.okText, '');
});

test('入口守卫：有未保存改动时要求先保存或返回编辑器', () => {
  const guard = resolveOptimizeEntryGuard({ chapterNo: 3, hasPendingEdit: true });
  assert.equal(guard.blocked, true);
  assert.match(guard.title, /未保存/);
  assert.match(guard.content, /第 3 章/);
  assert.match(guard.content, /已保存正文/);
  assert.equal(guard.okText, '先保存并继续');
  assert.equal(guard.cancelText, '返回编辑器');
});

test('入口守卫：章节号缺失时用「当前章节」措辞', () => {
  const guard = resolveOptimizeEntryGuard({ chapterNo: null, hasPendingEdit: true });
  assert.equal(guard.blocked, true);
  assert.match(guard.content, /当前章节/);
});

// ── W2：启动幂等键生命周期 ────────────────────────────────────────────

function sequenceFactory(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

test('W2：创建成功后再次启动分配新的 clientRequestId', () => {
  const tracker = createRefinementStartRequestIdTracker(sequenceFactory('req'));

  const first = tracker.begin();
  tracker.commit(); // 模拟创建 run 成功
  const second = tracker.begin();

  assert.equal(first, 'req-1');
  assert.equal(second, 'req-2');
  assert.notEqual(first, second);
});

test('W2：同一次创建请求失败重试保留同一 clientRequestId（幂等）', () => {
  const tracker = createRefinementStartRequestIdTracker(sequenceFactory('req'));

  const first = tracker.begin(); // 请求发出
  // 请求失败 / 响应丢失：不 commit
  const retry = tracker.begin();
  const retryAgain = tracker.begin();

  assert.equal(first, 'req-1');
  assert.equal(retry, 'req-1');
  assert.equal(retryAgain, 'req-1');
});

test('W2：reset 立即分配新 key 并清除已消耗状态', () => {
  const tracker = createRefinementStartRequestIdTracker(sequenceFactory('req'));

  const first = tracker.begin();
  tracker.commit();
  tracker.reset();
  const afterReset = tracker.begin();

  assert.equal(first, 'req-1');
  assert.equal(afterReset, 'req-2');
  // reset 后即使不 commit，重复 begin 也保持同一 key
  assert.equal(tracker.begin(), 'req-2');
});

test('W2：多次「启动→成功」每次都得到不同 key', () => {
  const tracker = createRefinementStartRequestIdTracker(sequenceFactory('req'));
  const keys = new Set<string>();
  for (let i = 0; i < 5; i += 1) {
    keys.add(tracker.begin());
    tracker.commit();
  }
  assert.equal(keys.size, 5);
});
