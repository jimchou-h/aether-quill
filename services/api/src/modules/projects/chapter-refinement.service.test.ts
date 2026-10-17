import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { ChapterRefinementService } from './chapter-refinement.service';
import { MapChapterRefinementRunRepository } from './chapter-refinement-run.repository';
import {
  KeepOnlyRefinementEngine,
  OrchestratedRefinementEngine,
  type ChapterRefinementEngine,
  type RefinementEngineInput,
  type RefinementEngineResult,
} from './chapter-refinement.engine';
import { ChapterRefinementEventBus } from './chapter-refinement-event-bus';
import type { ChapterRefinementMaterialsProvider } from './chapter-refinement.materials';
import {
  createInitialRefinementCheckpoint,
  resolveRefinementPolicy,
  type RefinementRunRecord,
  type RefinementStatus,
} from './chapter-refinement.types';
import type { ProjectsService } from './projects.service';

const STUB_REFERENCE_MATERIALS = {
  materials: [],
  promptText: '',
  personaText: '',
  knowledgeText: '',
  styleSampleBlock: '',
  frozenAt: '2026-10-06T10:00:00.000Z',
};

const STUB_MATERIALS: ChapterRefinementMaterialsProvider = {
  resolve: () => ({
    systemPromptText: '你是资深小说写作助手。',
    templateVersions: [],
    templateTexts: {},
    modelRoutes: {
      writing: { tier: 'writing', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.7 },
      utility: { tier: 'utility', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.7 },
    },
    referenceMaterials: STUB_REFERENCE_MATERIALS,
  }),
};

const CHAPTER_UPDATED_AT = new Date('2026-10-06T10:00:00.000Z');
const BASE_TEXT = '第一章正文。这里是一段用于冻结的原文。';

interface HarnessOptions {
  members?: Array<{ userId: string; role: 'owner' | 'editor' | 'viewer' }>;
  source?: {
    chapterNo: number;
    title: string;
    content: string;
    updatedAt: Date;
    systemPromptText: string;
    chapterOptimizeSegmentCharSize: number;
  } | null;
  engine?: ChapterRefinementEngine;
  materials?: ChapterRefinementMaterialsProvider;
}

function createHarness(options: HarnessOptions = {}) {
  const members = options.members ?? [
    { userId: 'user-1', role: 'editor' as const },
    { userId: 'user-2', role: 'editor' as const },
  ];
  const source =
    options.source === undefined
      ? {
          chapterNo: 1,
          title: '第一章',
          content: BASE_TEXT,
          updatedAt: CHAPTER_UPDATED_AT,
          systemPromptText: '你是资深小说写作助手。',
          chapterOptimizeSegmentCharSize: 0,
        }
      : options.source;

  const repository = new MapChapterRefinementRunRepository();
  const eventBus = new ChapterRefinementEventBus();

  const projectsService = {
    checkAccess(projectId: string, userId: string, allowedRoles?: string[]) {
      const member = members.find((item) => item.userId === userId);
      if (!member) {
        throw new NotFoundException(`用户无权访问项目: ${projectId}`);
      }
      if (allowedRoles && !allowedRoles.includes(member.role)) {
        throw new NotFoundException(`用户权限不足，需要: ${allowedRoles.join('或')}`);
      }
      return member;
    },
    getChapterRefinementSource() {
      return source;
    },
  } as unknown as ProjectsService;

  const service = new ChapterRefinementService(
    projectsService,
    repository,
    options.engine ?? new KeepOnlyRefinementEngine(),
    eventBus,
    options.materials ?? STUB_MATERIALS
  );

  return { service, repository, eventBus, members };
}

function createPayload(
  overrides: Partial<{
    clientRequestId: string;
    instruction: string;
    expectedChapterUpdatedAt: string;
  }> = {}
) {
  return {
    clientRequestId: 'req-1',
    expectedChapterUpdatedAt: CHAPTER_UPDATED_AT.toISOString(),
    instruction: '收紧节奏，保持剧情不变。',
    ...overrides,
  };
}

async function waitForTerminal(
  repository: MapChapterRefinementRunRepository,
  runId: string,
  timeoutMs = 2000
): Promise<RefinementRunRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await repository.getById(runId);
    if (
      record &&
      ['ready', 'ready_with_issues', 'failed', 'discarded', 'expired'].includes(record.status)
    ) {
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`run ${runId} 未在 ${timeoutMs}ms 内进入终态`);
}

async function seedActiveRun(
  repository: MapChapterRefinementRunRepository,
  overrides: Partial<RefinementRunRecord> = {}
): Promise<RefinementRunRecord> {
  const now = new Date();
  const record: RefinementRunRecord = {
    runId: 'seeded-active-run',
    projectId: 'p1',
    chapterNo: 1,
    creatorId: 'user-1',
    clientRequestId: 'seeded-req',
    payloadHash: 'seeded-hash',
    status: 'running',
    phase: 'reading',
    revision: 2,
    attemptId: 'attempt-1',
    pauseReason: null,
    resumable: false,
    baseUpdatedAt: CHAPTER_UPDATED_AT.toISOString(),
    baseHash: 'seeded-base-hash',
    rewritePolicy: 'preserve-plot',
    snapshot: {
      instruction: 'seeded',
      baseTitle: '第一章',
      baseText: BASE_TEXT,
      systemPromptText: '',
      templateVersions: [],
      modelRoute: null,
      resolvedPolicy: resolveRefinementPolicy({ requested: undefined, projectSegmentCharSize: 0 }),
      frozenAt: now.toISOString(),
    },
    checkpoint: createInitialRefinementCheckpoint(BASE_TEXT),
    tombstone: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
  await repository.create(record);
  return record;
}

test('创建 run：冻结原文并返回独立 summary，章节无副作用', async () => {
  const { service, repository } = createHarness();

  const summary = await service.createRun('p1', 1, createPayload(), 'user-1');

  assert.equal(summary.chapterNo, 1);
  assert.equal(summary.storageMode, 'memory');
  assert.equal(summary.rewritePolicy, 'preserve-plot');
  assert.ok(['queued', 'running'].includes(summary.status));

  const finished = await waitForTerminal(repository, summary.runId);
  assert.equal(finished.status, 'ready');
  // keep-only 基线：候选与冻结原文逐字一致，且不写回章节
  assert.equal(finished.checkpoint.acceptedDraftText, BASE_TEXT);
  assert.equal(finished.snapshot.baseText, BASE_TEXT);
});

test('非项目成员不能创建或读取 run', async () => {
  const { service } = createHarness();

  await assert.rejects(
    () => service.createRun('p1', 1, createPayload(), 'outsider'),
    NotFoundException
  );
});

test('同一 clientRequestId 相同参数幂等返回同一 run', async () => {
  const { service } = createHarness();

  const first = await service.createRun('p1', 1, createPayload(), 'user-1');
  const replay = await service.createRun('p1', 1, createPayload(), 'user-1');

  assert.equal(replay.runId, first.runId);
});

test('同一 clientRequestId 不同参数返回 1409', async () => {
  const { service } = createHarness();

  await service.createRun('p1', 1, createPayload(), 'user-1');

  await assert.rejects(
    () =>
      service.createRun(
        'p1',
        1,
        createPayload({ instruction: '换一份完全不同的要求。' }),
        'user-1'
      ),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      const body = error.getResponse() as { code?: number };
      assert.equal(body.code, 1409);
      return true;
    }
  );
});

test('同章同作者只允许一个活动 run', async () => {
  const { service, repository } = createHarness();
  const seeded = await seedActiveRun(repository);

  await assert.rejects(
    () => service.createRun('p1', 1, createPayload({ clientRequestId: 'req-2' }), 'user-1'),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      const body = error.getResponse() as { code?: number; runId?: string };
      assert.equal(body.code, 1409);
      assert.equal(body.runId, seeded.runId);
      return true;
    }
  );
});

test('其他创建者读取 run 返回 404，避免泄露冻结原文', async () => {
  const { service, repository } = createHarness();
  const seeded = await seedActiveRun(repository);

  await assert.rejects(() => service.getRun('p1', 1, seeded.runId, 'user-2'), NotFoundException);
});

test('章节不存在时返回 404', async () => {
  const { service } = createHarness({ source: null });

  await assert.rejects(
    () => service.createRun('p1', 1, createPayload(), 'user-1'),
    NotFoundException
  );
});

test('章节版本不一致返回 1307', async () => {
  const { service } = createHarness();

  await assert.rejects(
    () =>
      service.createRun(
        'p1',
        1,
        createPayload({ expectedChapterUpdatedAt: '2026-10-05T10:00:00.000Z' }),
        'user-1'
      ),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      const body = error.getResponse() as { code?: number };
      assert.equal(body.code, 1307);
      return true;
    }
  );
});

test('空要求与超长正文被拒绝', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.createRun('p1', 1, createPayload({ instruction: '   ' }), 'user-1'),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal((error.getResponse() as { code?: number }).code, 1400);
      return true;
    }
  );

  const oversized = createHarness({
    source: {
      chapterNo: 1,
      title: '第一章',
      content: '字'.repeat(30001),
      updatedAt: CHAPTER_UPDATED_AT,
      systemPromptText: '',
      chapterOptimizeSegmentCharSize: 0,
    },
  });
  await assert.rejects(
    () => oversized.service.createRun('p1', 1, createPayload(), 'user-1'),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal((error.getResponse() as { code?: number }).code, 1400);
      return true;
    }
  );
});

test('listRuns 只返回创建者自己的 run', async () => {
  const { service, repository } = createHarness();
  await seedActiveRun(repository);
  await seedActiveRun(repository, {
    runId: 'other-run',
    creatorId: 'user-2',
    clientRequestId: 'other-req',
    status: 'ready',
    phase: 'finished',
    attemptId: null,
  });

  const mine = await service.listRuns('p1', 1, 'user-1', 10);
  assert.deepEqual(
    mine.map((item) => item.runId),
    ['seeded-active-run']
  );
});

// ── 5.1 取消 / 继续 / 放弃 / 恢复 / 清理 ─────────────────────────────

const TERMINAL_OR_PAUSED: RefinementStatus[] = [
  'paused',
  'ready',
  'ready_with_issues',
  'failed',
  'discarded',
  'expired',
];

async function waitForStatus(
  repository: MapChapterRefinementRunRepository,
  runId: string,
  statuses: RefinementStatus[],
  timeoutMs = 2000
): Promise<RefinementRunRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await repository.getById(runId);
    if (record && statuses.includes(record.status)) {
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`run ${runId} 未在 ${timeoutMs}ms 内进入 ${statuses.join('/')}`);
}

function expectCode(error: unknown, code: number): boolean {
  assert.ok(error instanceof BadRequestException);
  assert.equal((error.getResponse() as { code?: number }).code, code);
  return true;
}

/** 触发一次 onBeforeCall 后按 abort 收束的探针引擎（不调用模型）。 */
class GatedProbeEngine implements ChapterRefinementEngine {
  readonly kind = 'gated-probe';
  open = false;

  async run(input: RefinementEngineInput): Promise<RefinementEngineResult> {
    await input.onStage({ phase: 'reading', unitIndex: 0, unitTotal: 0, message: '等待放行' });
    while (!this.open) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await input.onBeforeCall?.();
    if (input.signal.aborted) {
      return {
        status: 'paused',
        phase: 'reading',
        pauseReason: 'user_cancelled',
        resumable: true,
        checkpoint: input.record.checkpoint,
      };
    }
    return {
      status: 'ready',
      phase: 'finished',
      resumable: false,
      checkpoint: input.record.checkpoint,
    };
  }
}

/** 故意忽略 abort、延迟返回 ready 的引擎，用于验证迟到回调隔离。 */
class SlowEngine implements ChapterRefinementEngine {
  readonly kind = 'slow';
  async run(input: RefinementEngineInput): Promise<RefinementEngineResult> {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return {
      status: 'ready',
      phase: 'finished',
      resumable: false,
      checkpoint: input.record.checkpoint,
    };
  }
}

test('5.1 取消进行中的 run：转 paused/user_cancelled 且保留已接受稿', async () => {
  const { service, repository } = createHarness();
  const seeded = await seedActiveRun(repository, {
    runId: 'cancel-run',
    clientRequestId: 'cancel-req',
    checkpoint: {
      ...createInitialRefinementCheckpoint(BASE_TEXT),
      acceptedDraftText: '已接受的前半段。',
    },
  });

  const summary = await service.cancelRun('p1', 1, seeded.runId, 'user-1', {
    expectedAttemptId: seeded.attemptId,
  });
  assert.equal(summary.status, 'paused');
  assert.equal(summary.pauseReason, 'user_cancelled');
  assert.equal(summary.resumable, true);

  const record = await repository.getById(seeded.runId);
  assert.equal(record?.checkpoint.acceptedDraftText, '已接受的前半段。');

  // 幂等：再次取消返回同一状态
  const again = await service.cancelRun('p1', 1, seeded.runId, 'user-1', {});
  assert.equal(again.status, 'paused');
  assert.equal(again.pauseReason, 'user_cancelled');
});

test('5.1 取消与已进入新一轮的尝试不匹配时返回 409', async () => {
  const { service, repository } = createHarness();
  const seeded = await seedActiveRun(repository, {
    runId: 'cancel-guard',
    clientRequestId: 'cancel-guard-req',
  });

  await assert.rejects(
    () =>
      service.cancelRun('p1', 1, seeded.runId, 'user-1', {
        expectedAttemptId: 'other-attempt',
      }),
    (error: unknown) => expectCode(error, 1409)
  );
});

test('5.1 继续暂停的 run：另开执行尝试并进入终态', async () => {
  const { service, repository } = createHarness();
  const seeded = await seedActiveRun(repository, {
    runId: 'resume-run',
    clientRequestId: 'resume-req',
    status: 'paused',
    attemptId: null,
    pauseReason: 'budget_exhausted',
    resumable: true,
    revision: 2,
  });

  await service.resumeRun('p1', 1, seeded.runId, 'user-1', { expectedRunRevision: 2 });
  const finished = await waitForStatus(repository, seeded.runId, ['ready', 'ready_with_issues']);
  assert.equal(finished.status, 'ready');
});

test('5.1 继续前原文已变更：暂停为 source_changed 且不可继续', async () => {
  const { service, repository } = createHarness();
  const seeded = await seedActiveRun(repository, {
    runId: 'resume-src',
    clientRequestId: 'resume-src-req',
    status: 'paused',
    attemptId: null,
    resumable: true,
    revision: 2,
    baseUpdatedAt: '2026-10-01T00:00:00.000Z',
  });

  await assert.rejects(
    () => service.resumeRun('p1', 1, seeded.runId, 'user-1', { expectedRunRevision: 2 }),
    (error: unknown) => expectCode(error, 1307)
  );
  const record = await repository.getById(seeded.runId);
  assert.equal(record?.status, 'paused');
  assert.equal(record?.pauseReason, 'source_changed');
  assert.equal(record?.resumable, false);
});

test('5.1 继续的 revision 失配或不可恢复时返回 409', async () => {
  const mismatch = createHarness();
  const seededMismatch = await seedActiveRun(mismatch.repository, {
    runId: 'resume-rev',
    clientRequestId: 'resume-rev-req',
    status: 'paused',
    attemptId: null,
    resumable: true,
    revision: 2,
  });
  await assert.rejects(
    () =>
      mismatch.service.resumeRun('p1', 1, seededMismatch.runId, 'user-1', {
        expectedRunRevision: 99,
      }),
    (error: unknown) => expectCode(error, 1409)
  );

  const blocked = createHarness();
  const seededBlocked = await seedActiveRun(blocked.repository, {
    runId: 'resume-blocked',
    clientRequestId: 'resume-blocked-req',
    status: 'paused',
    attemptId: null,
    pauseReason: 'boundary_conflict',
    resumable: false,
    revision: 2,
  });
  await assert.rejects(
    () =>
      blocked.service.resumeRun('p1', 1, seededBlocked.runId, 'user-1', {
        expectedRunRevision: 2,
      }),
    (error: unknown) => expectCode(error, 1409)
  );
});

test('5.1 放弃：清理候选材料、保留最小墓碑，且重复放弃幂等', async () => {
  const { service, repository } = createHarness();
  const seeded = await seedActiveRun(repository, {
    runId: 'discard-run',
    clientRequestId: 'discard-req',
  });

  const summary = await service.discardRun('p1', 1, seeded.runId, 'user-1', {
    expectedRunRevision: seeded.revision,
  });
  assert.equal(summary.status, 'discarded');

  const record = await repository.getById(seeded.runId);
  assert.equal(record?.tombstone, true);
  assert.equal(record?.snapshot.baseText, '');
  assert.equal(record?.snapshot.instruction, '');
  assert.equal(record?.checkpoint.acceptedDraftText, '');
  // RunSummary 仍可构建：保留 resolvedPolicy
  assert.equal(record?.snapshot.resolvedPolicy.diagnosisTargetChars, 3000);

  await assert.rejects(
    () => service.getRun('p1', 1, seeded.runId, 'user-1'),
    GoneException,
    '丢弃后 RunView 应返回 410'
  );

  const again = await service.discardRun('p1', 1, seeded.runId, 'user-1', {
    expectedRunRevision: record?.revision ?? 0,
  });
  assert.equal(again.status, 'discarded');
});

test('5.1 放弃 revision 失配返回 409', async () => {
  const { service, repository } = createHarness();
  const seeded = await seedActiveRun(repository, {
    runId: 'discard-rev',
    clientRequestId: 'discard-rev-req',
  });
  await assert.rejects(
    () => service.discardRun('p1', 1, seeded.runId, 'user-1', { expectedRunRevision: 999 }),
    (error: unknown) => expectCode(error, 1409)
  );
});

test('5.1 服务重启恢复：遗留 queued/running 收敛为 paused/process_restart', async () => {
  const { service, repository } = createHarness();
  const running = await seedActiveRun(repository, {
    runId: 'recover-running',
    clientRequestId: 'recover-req',
  });

  await service.onModuleInit();
  try {
    const record = await repository.getById(running.runId);
    assert.equal(record?.status, 'paused');
    assert.equal(record?.pauseReason, 'process_restart');
    assert.equal(record?.resumable, true);
    assert.equal(record?.attemptId, null);
  } finally {
    service.onModuleDestroy();
  }
});

test('5.1 过期清理：终态到期转墓碑并二次清除，活动 run 不误删', async () => {
  const { service, repository } = createHarness();
  const past = '2020-01-01T00:00:00.000Z';
  await seedActiveRun(repository, {
    runId: 'expired-ready',
    clientRequestId: 'expired-req',
    status: 'ready',
    phase: 'finished',
    attemptId: null,
    revision: 2,
    expiresAt: past,
  });
  const active = await seedActiveRun(repository, {
    runId: 'keep-running',
    clientRequestId: 'keep-req',
    expiresAt: '2099-01-01T00:00:00.000Z',
  });

  const first = await service.cleanupExpiredRuns();
  assert.equal(first, 1);
  const expired = await repository.getById('expired-ready');
  assert.equal(expired?.status, 'expired');
  assert.equal(expired?.tombstone, true);
  assert.equal(expired?.snapshot.baseText, '');
  assert.equal((await repository.getById(active.runId))?.status, 'running', '活动 run 不应被清理');

  // 墓碑二次到期后彻底删除
  assert.ok(expired);
  await repository.save(
    { ...expired, expiresAt: past, revision: expired.revision + 1 },
    expired.revision
  );
  const second = await service.cleanupExpiredRuns();
  assert.equal(second, 1);
  assert.equal(await repository.getById('expired-ready'), undefined);
});

test('5.1 每个新调用前权限撤销：暂停为 permission_revoked 且不可继续', async () => {
  const members = [{ userId: 'user-1', role: 'editor' as const }];
  const engine = new GatedProbeEngine();
  const { service, repository } = createHarness({ members, engine });

  const summary = await service.createRun(
    'p1',
    1,
    createPayload({ clientRequestId: 'guard-req' }),
    'user-1'
  );

  members.length = 0; // 首个模型调用前撤销权限
  engine.open = true;

  const record = await waitForStatus(repository, summary.runId, TERMINAL_OR_PAUSED);
  assert.equal(record.status, 'paused');
  assert.equal(record.pauseReason, 'permission_revoked');
  assert.equal(record.resumable, false);
});

test('5.1 取消后的迟到回调不覆写 checkpoint', async () => {
  const { service, repository } = createHarness({ engine: new SlowEngine() });
  const summary = await service.createRun(
    'p1',
    1,
    createPayload({ clientRequestId: 'late-req' }),
    'user-1'
  );
  await new Promise((resolve) => setTimeout(resolve, 5));

  await service.cancelRun('p1', 1, summary.runId, 'user-1', {});
  await new Promise((resolve) => setTimeout(resolve, 80));

  const record = await repository.getById(summary.runId);
  assert.equal(record?.status, 'paused');
  assert.equal(record?.pauseReason, 'user_cancelled');
});

test('6.1 创建 run 冻结 trace id 与模板版本，运行详情可追溯', async () => {
  const materials: ChapterRefinementMaterialsProvider = {
    resolve: () => ({
      systemPromptText: 'system',
      templateVersions: [
        { key: 'chapter.refinement.rewrite', version: 3, hash: 'abcdef0123456789' },
      ],
      templateTexts: {},
      modelRoutes: {
        writing: {
          tier: 'writing',
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.7,
        },
        utility: {
          tier: 'utility',
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.5,
        },
      },
      referenceMaterials: STUB_REFERENCE_MATERIALS,
    }),
  };
  const { service } = createHarness({ materials });

  const summary = await service.createRun(
    'p1',
    1,
    createPayload({ clientRequestId: 'trace-req' }),
    'user-1',
    'trace-abc-123'
  );
  assert.equal(summary.creationTraceId, 'trace-abc-123');

  const view = await service.getRun('p1', 1, summary.runId, 'user-1');
  assert.equal(view.creationTraceId, 'trace-abc-123');
  assert.deepEqual(view.frozenTemplateVersions, [
    { key: 'chapter.refinement.rewrite', version: 3, hash: 'abcdef0123456789' },
  ]);
});

test('6.1 未提供 trace id 时记录为 null，不伪造关联', async () => {
  const { service } = createHarness();
  const summary = await service.createRun(
    'p1',
    1,
    createPayload({ clientRequestId: 'no-trace-req' }),
    'user-1'
  );
  assert.equal(summary.creationTraceId, null);
  const view = await service.getRun('p1', 1, summary.runId, 'user-1');
  assert.equal(view.creationTraceId, null);
  assert.deepEqual(view.frozenTemplateVersions, []);
});

test('6.1 discard 墓碑保留 trace id 但清空冻结模板版本', async () => {
  const materials: ChapterRefinementMaterialsProvider = {
    resolve: () => ({
      systemPromptText: 'system',
      templateVersions: [{ key: 'chapter.refinement.plan', version: 1, hash: 'deadbeefcafe' }],
      templateTexts: {},
      modelRoutes: {
        writing: {
          tier: 'writing',
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.7,
        },
        utility: {
          tier: 'utility',
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.5,
        },
      },
      referenceMaterials: STUB_REFERENCE_MATERIALS,
    }),
  };
  const { service, repository } = createHarness({ materials });
  const summary = await service.createRun(
    'p1',
    1,
    createPayload({ clientRequestId: 'trace-discard' }),
    'user-1',
    'trace-discard-xyz'
  );
  const terminal = await waitForTerminal(repository, summary.runId);

  await service.discardRun('p1', 1, summary.runId, 'user-1', {
    expectedRunRevision: terminal.revision,
  });

  const record = await repository.getById(summary.runId);
  assert.equal(record?.tombstone, true);
  assert.equal(record?.snapshot.creationTraceId, 'trace-discard-xyz');
  assert.deepEqual(record?.snapshot.templateVersions, []);
});

// ── F1：中途持久化 checkpoint，取消不丢已接受稿；取消后拒绝迟到候选 ──────

async function waitForPersistedCheckpoint(
  repository: MapChapterRefinementRunRepository,
  runId: string,
  expectedDraft: string,
  timeoutMs = 2000
): Promise<RefinementRunRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await repository.getById(runId);
    if (record && record.checkpoint.acceptedDraftText === expectedDraft) {
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`run ${runId} 的中途 checkpoint 未在 ${timeoutMs}ms 内落库`);
}

/** 先提交一次中途 checkpoint（模拟第一个单位接受），再等待被取消。 */
class CheckpointThenWaitEngine implements ChapterRefinementEngine {
  readonly kind = 'checkpoint-then-wait';
  async run(input: RefinementEngineInput): Promise<RefinementEngineResult> {
    await input.onStage({
      phase: 'rewriting',
      unitIndex: 1,
      unitTotal: 2,
      message: '正在改写第 1/2 段…',
    });
    await input.onCheckpoint?.({
      ...input.record.checkpoint,
      acceptedDraftText: '已接受的前半段。',
      changes: [{ sceneId: 's1', startOffset: 0, endOffset: 4, summary: '改写第 1 段' }],
      progress: { unitIndex: 1, unitTotal: 2, message: '已接受第 1/2 段候选' },
    });
    await new Promise<void>((resolve) => {
      if (input.signal.aborted) {
        resolve();
        return;
      }
      input.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return {
      status: 'paused',
      phase: 'rewriting',
      pauseReason: 'user_cancelled',
      resumable: true,
      checkpoint: input.record.checkpoint,
    };
  }
}

test('F1 中途 checkpoint 落库：取消后仓库仍保留已接受稿，不丢进度', async () => {
  const { service, repository } = createHarness({ engine: new CheckpointThenWaitEngine() });
  const summary = await service.createRun(
    'p1',
    1,
    createPayload({ clientRequestId: 'f1-req' }),
    'user-1'
  );

  // 引擎到达第一个单位接受点后 checkpoint 已落库（无需等待整个 run 结束）
  const persisted = await waitForPersistedCheckpoint(repository, summary.runId, '已接受的前半段。');
  assert.equal(persisted.checkpoint.progress.unitIndex, 1);
  assert.equal(persisted.checkpoint.changes.length, 1);

  // 显式取消：保存最后有效 checkpoint
  const cancelled = await service.cancelRun('p1', 1, summary.runId, 'user-1', {});
  assert.equal(cancelled.status, 'paused');
  assert.equal(cancelled.pauseReason, 'user_cancelled');

  const finalRecord = await repository.getById(summary.runId);
  assert.equal(finalRecord?.checkpoint.acceptedDraftText, '已接受的前半段。');
  assert.equal(finalRecord?.checkpoint.changes.length, 1);
});

/** 忽略 abort、晚到的引擎：取消后仍尝试提交 checkpoint（迟到回调）。 */
class LateCheckpointEngine implements ChapterRefinementEngine {
  readonly kind = 'late-checkpoint';
  async run(input: RefinementEngineInput): Promise<RefinementEngineResult> {
    await new Promise((resolve) => setTimeout(resolve, 40));
    await input.onCheckpoint?.({
      ...input.record.checkpoint,
      acceptedDraftText: '迟到候选，不应落库。',
      progress: { unitIndex: 9, unitTotal: 9, message: '迟到' },
    });
    return {
      status: 'ready',
      phase: 'finished',
      resumable: false,
      checkpoint: input.record.checkpoint,
    };
  }
}

test('F1 取消后的迟到 checkpoint 被拒绝：不得覆写已保存成果', async () => {
  const { service, repository } = createHarness({ engine: new LateCheckpointEngine() });
  const summary = await service.createRun(
    'p1',
    1,
    createPayload({ clientRequestId: 'f1-late' }),
    'user-1'
  );

  await service.cancelRun('p1', 1, summary.runId, 'user-1', {});
  // 等迟到回调尝试写入
  await new Promise((resolve) => setTimeout(resolve, 80));

  const record = await repository.getById(summary.runId);
  assert.equal(record?.status, 'paused');
  assert.notEqual(record?.checkpoint.acceptedDraftText, '迟到候选，不应落库。');
  assert.equal(record?.checkpoint.progress.unitIndex !== 9, true);
});

// ── C1：真实 service + engine 路径下最终修复稿不得被 checkpoint 写回 ────────

const C1_SERVICE_BASE = '甲推开门，放下钥匙。\n\n乙走进院子，关好门。';
const C1_SERVICE_REPAIRED = '甲推门进屋，郑重地将钥匙放下。';

function c1ServiceGateway() {
  const rewrites = ['甲推门进屋，将钥匙放下。', '乙来到院中，将门关好。'];
  let rewriteCall = 0;
  let reviewCall = 0;
  const inspect = JSON.stringify({
    windowId: 'w0',
    sceneFragments: [0, 1].map((i) => ({
      startBlockId: `b${i}`,
      endBlockId: `b${i}`,
      startsNewScene: true,
      confidence: 'high',
      goal: '保持事件',
      entryFacts: [],
      exitFacts: [],
      proposedBeatEnds: [],
    })),
    issues: [],
  });
  const plan = JSON.stringify({
    chapterIntent: '改善表达',
    protectedFacts: [],
    sceneBriefs: [0, 1].map((i) => ({
      sceneId: `s${i + 1}`,
      sourceBlockIds: [`b${i}`],
      decision: 'rewrite',
      reason: '改善表达',
      editIntent: '改善表达',
      expectedChange: '改善表达',
      entryFacts: [],
      exitFacts: [],
      protectedSpanIds: [],
      targetLength: { direction: 'hold' },
      checks: [],
    })),
  });
  const review = JSON.stringify({ issues: [], exitStateFacts: [] });
  const gateway = {
    async generate(request: { templateKey: string }) {
      const key = request.templateKey.split('.').at(-1);
      const ok = (text: string) => ({ ok: true, text, aborted: false, traceId: 'svc-c1' });
      if (key === 'inspect') return ok(inspect);
      if (key === 'plan') return ok(plan);
      if (key === 'rewrite') {
        const text = rewrites[rewriteCall] ?? '';
        rewriteCall += 1;
        return ok(text);
      }
      if (key === 'repair') return ok(C1_SERVICE_REPAIRED);
      if (key === 'review') {
        reviewCall += 1;
        if (reviewCall === 3) {
          return ok(
            JSON.stringify({
              issues: [
                {
                  kind: 'hard_constraint',
                  severity: 'high',
                  anchorQuote: '甲推门进屋',
                  expectedFact: '接缝一致',
                  fixIntent: '修复第 1 段接缝',
                },
              ],
              exitStateFacts: [],
            })
          );
        }
        return ok(review);
      }
      return { ok: false, text: '', aborted: false, traceId: 'svc-c1', errorMessage: 'no script' };
    },
  };
  return { gateway, reviewCalls: () => reviewCall };
}

test('C1 真实 service + engine：最终接缝修复稿进入终态候选，未被 checkpoint 写回旧稿', async () => {
  const { gateway } = c1ServiceGateway();
  const engine = new OrchestratedRefinementEngine(gateway);
  const { service, repository } = createHarness({
    engine,
    source: {
      chapterNo: 1,
      title: '第一章',
      content: C1_SERVICE_BASE,
      updatedAt: CHAPTER_UPDATED_AT,
      systemPromptText: '你是资深小说写作助手。',
      chapterOptimizeSegmentCharSize: 0,
    },
  });

  const summary = await service.createRun('p1', 1, createPayload(), 'user-1');
  const finished = await waitForTerminal(repository, summary.runId);

  assert.equal(finished.status, 'ready');
  // 终态正文必须包含已接受的接缝修复稿（真实 service 的 onCheckpoint 路径）
  assert.ok(
    finished.checkpoint.acceptedDraftText.startsWith(C1_SERVICE_REPAIRED),
    `终态正文应含接缝修复稿，实际：${finished.checkpoint.acceptedDraftText}`
  );
  assert.ok(
    finished.checkpoint.issues.some((issue) => issue.disposition === 'resolved'),
    '修复应登记为 resolved'
  );
});

// ── B1：真实 service + engine 下的应用资格收口（AQ-383）────────────────

const B1_SERVICE_BASE = '甲推开门，屋内一片寂静。\n\n乙静候门外，灯火渐次亮起。';
const B1_UNLOCATABLE = JSON.stringify({
  issues: [
    {
      kind: 'hard_constraint',
      severity: 'high',
      anchorQuote: '不在正文中的引文',
      expectedFact: '整章首尾状态一致',
      sourceEvidence: '整章',
      fixIntent: '修复整章层面的状态冲突',
    },
  ],
  exitStateFacts: [],
});

/** 单位 review 通过；整章最终检查报出无法定位到单一活动候选的全章阻断 */
function b1ServiceGateway() {
  let reviewCall = 0;
  const gateway = {
    async generate(request: { templateKey: string }) {
      const key = request.templateKey.split('.').at(-1);
      const ok = (text: string) => ({ ok: true, text, aborted: false, traceId: 'svc-b1' });
      if (key === 'inspect') {
        return ok(
          JSON.stringify({
            windowId: 'w0',
            sceneFragments: [
              {
                startBlockId: 'b0',
                endBlockId: 'b1',
                startsNewScene: true,
                confidence: 'high',
                goal: '交代归来',
                entryFacts: [],
                exitFacts: [],
                proposedBeatEnds: [],
              },
            ],
            issues: [],
          })
        );
      }
      if (key === 'plan') {
        return ok(
          JSON.stringify({
            chapterIntent: '收紧节奏',
            protectedFacts: [],
            sceneBriefs: [
              {
                sceneId: 'scene-1',
                sourceBlockIds: ['b0', 'b1'],
                decision: 'rewrite',
                reason: '铺陈偏散',
                editIntent: '压缩为一句',
                expectedChange: '更紧凑',
                entryFacts: [],
                exitFacts: [],
                protectedSpanIds: [],
                targetLength: { direction: 'condense' },
                checks: [],
              },
            ],
          })
        );
      }
      if (key === 'rewrite') return ok('甲推门进屋，屋内寂静无声。乙静候门外，灯火渐次亮起。');
      if (key === 'review') {
        reviewCall += 1;
        // 第 1 次为的单位 review；第 2 次起（整章最终检查 / 续跑重检）报无法定位的全章阻断
        return ok(
          reviewCall === 1 ? JSON.stringify({ issues: [], exitStateFacts: [] }) : B1_UNLOCATABLE
        );
      }
      return { ok: false, text: '', aborted: false, traceId: 'svc-b1', errorMessage: 'no script' };
    },
  };
  return { gateway };
}

test('B1 真实 service + engine：无法定位的全章阻断暂停后继续仍不可应用', async () => {
  const { gateway } = b1ServiceGateway();
  const engine = new OrchestratedRefinementEngine(gateway);
  const { service, repository } = createHarness({
    engine,
    source: {
      chapterNo: 1,
      title: '第一章',
      content: B1_SERVICE_BASE,
      updatedAt: CHAPTER_UPDATED_AT,
      systemPromptText: '你是资深小说写作助手。',
      chapterOptimizeSegmentCharSize: 0,
    },
  });

  const summary = await service.createRun('p1', 1, createPayload(), 'user-1');
  const paused = await waitForStatus(repository, summary.runId, TERMINAL_OR_PAUSED);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pauseReason, 'boundary_conflict');
  assert.equal(
    paused.checkpoint.issues.some(
      (issue) => issue.disposition === 'unresolved' && issue.severity === 'high'
    ),
    true
  );

  // 继续：整章最终检查仍会报同一阻断 → 依旧不可应用，不得落到 ready_with_issues
  await service.resumeRun('p1', 1, summary.runId, 'user-1', {
    expectedRunRevision: paused.revision,
  });
  const resumed = await waitForStatus(repository, summary.runId, TERMINAL_OR_PAUSED);
  assert.equal(resumed.status, 'paused');
  assert.equal(resumed.pauseReason, 'boundary_conflict');
  assert.equal(
    resumed.checkpoint.issues.some(
      (issue) => issue.disposition === 'unresolved' && issue.severity === 'high'
    ),
    true,
    '账本必须保留未解决阻断，UI 应用资格据此关闭'
  );
});
