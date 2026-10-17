/**
 * 5.1 / AQ-384：真实 PG 上的 **service + engine 中途重建** 断言。
 *
 * 与 `chapter-refinement-run.repository.test.ts` 的仓库契约不同：这里重建的是
 * **整个服务对象、仓库与引擎实例**（模拟进程被杀后新进程接手），启动恢复把遗留
 * running 收敛为 paused/process_restart，再由作者 resume 继续。
 *
 * 不允许用同一个 service 或 Map 仓库替代重建——那只能证明 checkpoint 序列化正确，
 * 不能证明「新进程从持久化的断点接得上」。
 *
 * 停靠点覆盖：诊断部分完成 / 已接受一单位且在途 / 单位补修在途 / 最终接缝补修在途。
 *
 * 运行（services/api）：
 *
 * ```powershell
 * $env:REFINEMENT_PG_TEST_URL='postgresql://aether:aether_password@127.0.0.1:5432/aether_quill'
 * node --import tsx --test src/modules/projects/chapter-refinement.pg-rebuild.test.ts
 * ```
 *
 * 未配置 `REFINEMENT_PG_TEST_URL` 时全部显式 skip（不算通过）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ChapterRefinementService } from './chapter-refinement.service';
import {
  PgChapterRefinementRunRepository,
  type ChapterRefinementRunRepository,
} from './chapter-refinement-run.repository';
import { OrchestratedRefinementEngine } from './chapter-refinement.engine';
import { ChapterRefinementEventBus } from './chapter-refinement-event-bus';
import type { ChapterRefinementMaterialsProvider } from './chapter-refinement.materials';
import {
  CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
} from './chapter-refinement.util';
import type { RefinementRunRecord } from './chapter-refinement.types';
import type { ProjectsService } from './projects.service';
import type {
  RefinementGenerationGateway,
  RefinementGenerationRequest,
  RefinementGenerationResult,
} from './chapter-refinement.gateway';

const PG_TEST_URL = process.env.REFINEMENT_PG_TEST_URL?.trim();
const SKIP_REASON = 'REFINEMENT_PG_TEST_URL 未配置，跳过真实 PG service/engine 重建断言';

const CHAPTER_UPDATED_AT = new Date('2026-10-06T10:00:00.000Z');

/** 短章：三块正文 → 三个写作单位。 */
const SHORT_TEXT = ['AAAA', '', 'BBBB', '', 'CCCC'].join('\n');

/** 长章：每块约 2200 字，配合 diagnosisTargetChars=2000 可分出多个诊断窗。 */
function longChapterText(): string {
  const unit = '夜色渐深，街上的灯火一盏盏亮起，行人陆续散去，巷口只剩下风声。';
  const block = unit.repeat(90);
  return [block, '', block.replace(/夜色/g, '天色'), '', block.replace(/灯火/g, '灯影')].join('\n');
}

// 通用断言开关：模拟「重建后权限被撤销」与「重建后 Settings / 材料已变更」
let accessRevoked = false;
let materialsRotated = false;

const STUB_MATERIALS: ChapterRefinementMaterialsProvider = {
  resolve: () => ({
    systemPromptText: materialsRotated ? '（变更后的项目文风）' : '你是资深小说写作助手。',
    templateVersions: [
      {
        key: 'chapter.refinement.rewrite',
        version: 1,
        hash: materialsRotated ? 'rotated-hash' : 'frozen-hash',
      },
    ],
    templateTexts: {},
    modelRoutes: {
      writing: {
        tier: 'writing',
        provider: 'deepseek',
        model: materialsRotated ? 'rotated-model' : 'deepseek-chat',
        temperature: 0.7,
      },
      utility: { tier: 'utility', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.7 },
    },
    referenceMaterials: {
      materials: [],
      promptText: '',
      personaText: materialsRotated ? '（变更后的人物）' : '',
      knowledgeText: '',
      styleSampleBlock: '',
      frozenAt: materialsRotated ? '2026-10-07T10:00:00.000Z' : '2026-10-06T10:00:00.000Z',
    },
  }),
};

function inspectScript(blockIds: string[]): string {
  return JSON.stringify({
    windowId: 'w0',
    sceneFragments: blockIds.map((blockId) => ({
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

function planScript(blockIds: string[]): string {
  return JSON.stringify({
    chapterIntent: '收紧节奏',
    protectedFacts: [],
    sceneBriefs: blockIds.map((blockId, index) => ({
      sceneId: `scene-${index + 1}`,
      sourceBlockIds: [blockId],
      decision: 'rewrite',
      reason: '啰嗦',
      editIntent: '压缩',
      expectedChange: '更短',
      entryFacts: [],
      exitFacts: [],
      protectedSpanIds: [],
      targetLength: { direction: 'hold' },
      checks: [],
    })),
  });
}

const REVIEW_OK = JSON.stringify({ issues: [], exitStateFacts: [] });

/** 一条可在第 1 段候选中唯一命中的可定位阻断缺口（用于触发单位补修）。 */
const REVIEW_BLOCKING = JSON.stringify({
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
  exitStateFacts: [],
});

const REPAIRED_UNIT = '夜幕灯火亮起，街上无人。';

interface ScriptedGateway extends RefinementGenerationGateway {
  calls: RefinementGenerationRequest[];
  /** 第 n 次（1-based）命中指定模板时挂起，等待外部取消；返回“已发起”信号。 */
  hangOnNth: (templateKey: string, nth: number) => Promise<void>;
}

interface GatewayScript {
  inspect?: (call: number, prompt: string) => string;
  plan?: string;
  rewrites?: string[];
  reviews?: Array<(call: number) => string>;
  repair?: () => string;
}

/** 可控假网关：按模板返回脚本；挂起的调用等到 signal 中止才返回。 */
function createScriptedGateway(script: GatewayScript): ScriptedGateway {
  const calls: RefinementGenerationRequest[] = [];
  const counters = new Map<string, number>();
  const pending = new Map<string, () => void>();
  let inspectCall = 0;
  let rewriteCall = 0;
  let reviewCall = 0;
  const bump = (key: string): number => {
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return next;
  };
  return {
    calls,
    hangOnNth(templateKey: string, nth: number) {
      return new Promise<void>((resolve) => {
        pending.set(`${templateKey}#${nth}`, resolve);
      });
    },
    async generate(request: RefinementGenerationRequest): Promise<RefinementGenerationResult> {
      calls.push(request);
      const key = request.templateKey;
      const nth = bump(key);
      const wait = pending.get(`${key}#${nth}`);
      if (wait) {
        pending.delete(`${key}#${nth}`);
        wait();
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) {
            resolve();
            return;
          }
          request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { ok: false, text: '', traceId: 'hang', aborted: true, errorMessage: 'aborted' };
      }
      if (key === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY) {
        const index = inspectCall;
        inspectCall += 1;
        const text = script.inspect
          ? script.inspect(index, request.prompt)
          : inspectScript(['b0', 'b1', 'b2']);
        return { ok: true, text, traceId: 't', aborted: false };
      }
      if (key === CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY) {
        return {
          ok: true,
          text: script.plan ?? planScript(['b0', 'b1', 'b2']),
          traceId: 't',
          aborted: false,
        };
      }
      if (key === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY) {
        const text = script.rewrites?.[rewriteCall] ?? '';
        rewriteCall += 1;
        return { ok: true, text, traceId: 't', aborted: false };
      }
      if (key === CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY) {
        const index = reviewCall;
        reviewCall += 1;
        const text = (script.reviews?.[index] ?? (() => REVIEW_OK))(index);
        return { ok: true, text, traceId: 't', aborted: false };
      }
      if (key === CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY) {
        return script.repair
          ? { ok: true, text: script.repair(), traceId: 't', aborted: false }
          : { ok: false, text: '', traceId: 't', aborted: false, errorMessage: 'no repair script' };
      }
      return {
        ok: false,
        text: '',
        traceId: 't',
        aborted: false,
        errorMessage: `no script ${key}`,
      };
    },
  };
}

interface Lifecycle {
  service: ChapterRefinementService;
  repository: ChapterRefinementRunRepository;
  gateway: ScriptedGateway;
  dispose: () => Promise<void>;
}

interface CaseConfig {
  baseText?: string;
  diagnosisTargetChars?: number;
  script?: GatewayScript;
}

interface CaseContext {
  source: { updatedAt: Date };
  start: (clientRequestId: string) => Promise<{ runId: string; lifecycle: Lifecycle }>;
  rebuild: (
    record: RefinementRunRecord
  ) => Promise<{ lifecycle: Lifecycle; recovered: RefinementRunRecord }>;
}

/** 每个生命周期都新建 repository / service / engine——不复用上一进程的任何内存状态。 */
function createLifecycle(
  prisma: unknown,
  source: { updatedAt: Date; content: string },
  script: GatewayScript
): Lifecycle {
  const repository = new PgChapterRefinementRunRepository(
    prisma as ConstructorParameters<typeof PgChapterRefinementRunRepository>[0]
  );
  const gateway = createScriptedGateway(script);
  const engine = new OrchestratedRefinementEngine(gateway);
  const eventBus = new ChapterRefinementEventBus();
  const projectsService = {
    checkAccess() {
      if (accessRevoked) {
        // 模拟重建后作者权限被撤销：继续必须被拒绝
        const error = new Error('FORBIDDEN: 无权访问该项目') as Error & { status?: number };
        error.status = 403;
        throw error;
      }
      return { userId: 'user-1', role: 'editor' as const };
    },
    getChapterRefinementSource() {
      return {
        chapterNo: 1,
        title: '第一章',
        content: source.content,
        updatedAt: source.updatedAt,
        systemPromptText: '你是资深小说写作助手。',
        chapterOptimizeSegmentCharSize: 0,
      };
    },
  } as unknown as ProjectsService;
  const service = new ChapterRefinementService(
    projectsService,
    repository,
    engine,
    eventBus,
    STUB_MATERIALS
  );
  return {
    service,
    repository,
    gateway,
    dispose: async () => {
      service.clearForTest();
      service.onModuleDestroy();
    },
  };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  label: string,
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等待超时：${label}`);
}

/** 等待新尝试真正接手：不再是「启动恢复留下的 process_restart 暂停」。 */
async function waitForResumed(
  repository: ChapterRefinementRunRepository,
  runId: string
): Promise<RefinementRunRecord> {
  await waitFor(async () => {
    const record = await repository.getById(runId);
    return (
      Boolean(record) &&
      !['queued', 'running'].includes(record!.status) &&
      !(record!.status === 'paused' && record!.pauseReason === 'process_restart')
    );
  }, '新尝试应接手运行');
  const record = await repository.getById(runId);
  assert.ok(record);
  return record;
}

async function loadRun(
  repository: ChapterRefinementRunRepository,
  runId: string
): Promise<RefinementRunRecord> {
  const record = await repository.getById(runId);
  assert.ok(record, `run ${runId} 应存在`);
  return record;
}

const resumeInput = (record: RefinementRunRecord) => ({ expectedRunRevision: record.revision });

async function withSchema(fn: (prisma: unknown) => Promise<void>): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const schema = `refinement_rebuild_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const admin = new PrismaClient({ datasources: { db: { url: PG_TEST_URL } } });
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    const scopedUrl = `${PG_TEST_URL}${PG_TEST_URL!.includes('?') ? '&' : '?'}schema=${schema}`;
    const scoped = new PrismaClient({ datasources: { db: { url: scopedUrl } } });
    try {
      const migrationSql = readFileSync(
        path.resolve(
          __dirname,
          '../../../prisma/migrations/20261006120000_aq380_chapter_refinement_runs/migration.sql'
        ),
        'utf8'
      );
      for (const statement of migrationSql
        .split(';')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)) {
        await scoped.$executeRawUnsafe(statement);
      }
      await fn(scoped);
    } finally {
      await scoped.$disconnect();
    }
  } finally {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}

/** 每个用例一套全新 schema；用例之间不共享任何数据。 */
async function runRebuildCase(
  config: CaseConfig,
  body: (ctx: CaseContext) => Promise<void>
): Promise<void> {
  await withSchema(async (prisma) => {
    const source = {
      updatedAt: new Date(CHAPTER_UPDATED_AT),
      content: config.baseText ?? SHORT_TEXT,
    };
    const active: Lifecycle[] = [];
    const disposeAll = async (): Promise<void> => {
      for (const lifecycle of active) {
        await lifecycle.dispose();
      }
      active.length = 0;
    };
    const ctx: CaseContext = {
      source,
      start: async (clientRequestId: string) => {
        const lifecycle = createLifecycle(prisma, source, config.script ?? {});
        active.push(lifecycle);
        const summary = await lifecycle.service.createRun(
          'p1',
          1,
          {
            clientRequestId,
            expectedChapterUpdatedAt: source.updatedAt.toISOString(),
            instruction: '收紧节奏，保持剧情不变。',
            ...(typeof config.diagnosisTargetChars === 'number'
              ? { diagnosisTargetChars: config.diagnosisTargetChars }
              : {}),
          },
          'user-1'
        );
        return { runId: summary.runId, lifecycle };
      },
      rebuild: async (record: RefinementRunRecord) => {
        await disposeAll();
        // 模拟进程被杀：把记录置回 running，新进程启动时必须收敛为 process_restart
        const killer = new PgChapterRefinementRunRepository(
          prisma as ConstructorParameters<typeof PgChapterRefinementRunRepository>[0]
        );
        const killed = await killer.save({ ...record, status: 'running' }, record.revision);
        assert.ok(killed, '模拟进程被杀：应能把状态置回 running');
        const lifecycle = createLifecycle(prisma, source, config.script ?? {});
        active.push(lifecycle);
        await lifecycle.service.onModuleInit();
        const recovered = await loadRun(lifecycle.repository, killed.runId);
        return { lifecycle, recovered };
      },
    };
    try {
      await body(ctx);
    } finally {
      await disposeAll();
    }
  });
}

test(
  'B3 真实 PG 重建 · 停靠点 1：诊断部分完成后重启，已完成窗口不重跑且成果保留',
  { skip: PG_TEST_URL ? false : SKIP_REASON },
  async () => {
    await runRebuildCase(
      {
        baseText: longChapterText(),
        diagnosisTargetChars: 2000,
        script: {
          inspect: (_call, prompt) => {
            // 按程序规划的当前诊断窗里实际出现的 block id 生成脚本
            const ids = [...prompt.matchAll(/<block id="(b\d+)"/g)].map((match) => match[1] ?? '');
            return inspectScript(ids.length > 0 ? ids : ['b0']);
          },
          plan: planScript(['b0', 'b1', 'b2']),
          rewrites: ['段一改', '段二改', '段三改'],
        },
      },
      async ({ start, rebuild }) => {
        const { runId, lifecycle } = await start('req-diagnosis');
        // 第一个诊断窗完成；第二个窗在途时取消
        const started = lifecycle.gateway.hangOnNth(CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY, 2);
        await waitFor(async () => lifecycle.gateway.calls.length >= 1, '首个 inspect 已发起');
        await started;
        await lifecycle.service.cancelRun('p1', 1, runId, 'user-1', {
          expectedAttemptId: (await loadRun(lifecycle.repository, runId)).attemptId,
        });
        await waitFor(
          async () => (await loadRun(lifecycle.repository, runId)).status === 'paused',
          '取消后进入 paused'
        );
        const paused = await loadRun(lifecycle.repository, runId);
        assert.equal(paused.checkpoint.diagnosis?.completedWindows, 1, '第 1 个诊断窗应已完成');
        const callsBefore = paused.checkpoint.usage.callCount;

        const { lifecycle: next, recovered } = await rebuild(paused);
        assert.equal(recovered.status, 'paused');
        assert.equal(recovered.pauseReason, 'process_restart');
        assert.equal(recovered.resumable, true);
        assert.equal(recovered.checkpoint.diagnosis?.completedWindows, 1, '已完成诊断应保留');
        assert.equal(next.gateway.calls.length, 0, '作者未继续前不应有任何模型调用');
        assert.deepEqual(recovered.snapshot.templateVersions, [
          { key: 'chapter.refinement.rewrite', version: 1, hash: 'frozen-hash' },
        ]);
        assert.ok(recovered.checkpoint.usage.callCount >= callsBefore, '历史用量不因重建归零');

        await next.service.resumeRun('p1', 1, runId, 'user-1', resumeInput(recovered));
        await waitFor(async () => next.gateway.calls.length > 0, '恢复后应发起模型调用');
        await waitFor(async () => {
          const record = await loadRun(next.repository, runId);
          return ['ready', 'ready_with_issues', 'paused'].includes(record.status);
        }, 'resume 后推进');
        const after = await loadRun(next.repository, runId);
        assert.ok(after.checkpoint.usage.callCount >= callsBefore, '新尝试用量应在历史基础上累加');
        const resumedInspects = next.gateway.calls.filter(
          (request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY
        );
        assert.ok(resumedInspects.length >= 1, '恢复后应继续未完成的诊断');
        assert.equal(
          resumedInspects[0]?.prompt.includes('<block id="b0"'),
          false,
          '已完成窗口不得重复诊断'
        );
      }
    );
  }
);

test(
  'B3 真实 PG 重建 · 停靠点 2：已接受一单位且在途重启，接受稿保留、临时稿舍弃、旧回调不覆写',
  { skip: PG_TEST_URL ? false : SKIP_REASON },
  async () => {
    await runRebuildCase(
      { script: { rewrites: ['AAAAA', 'BB', 'CCCCCC'] } },
      async ({ start, rebuild }) => {
        const { runId, lifecycle } = await start('req-accepted');
        // 第 1 段已接受；第 2 段改写调用在途时取消
        const started = lifecycle.gateway.hangOnNth(CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY, 2);
        await started;
        await lifecycle.service.cancelRun('p1', 1, runId, 'user-1', {
          expectedAttemptId: (await loadRun(lifecycle.repository, runId)).attemptId,
        });
        await waitFor(
          async () => (await loadRun(lifecycle.repository, runId)).status === 'paused',
          '取消后进入 paused'
        );
        const paused = await loadRun(lifecycle.repository, runId);
        assert.equal(paused.checkpoint.resumeState?.replacements.length, 1, '第 1 段应已接受');
        const acceptedAfterFirst = paused.checkpoint.acceptedDraftText;
        assert.equal(acceptedAfterFirst.startsWith('AAAAA'), true);

        const { lifecycle: next, recovered } = await rebuild(paused);
        assert.equal(recovered.checkpoint.acceptedDraftText, acceptedAfterFirst);
        assert.equal(recovered.checkpoint.resumeState?.replacements.length, 1);
        assert.equal(next.gateway.calls.length, 0, '作者未继续前不应有任何模型调用');

        const before = recovered.checkpoint.usage.callCount;
        const attemptBefore = recovered.attemptId;
        await next.service.resumeRun('p1', 1, runId, 'user-1', resumeInput(recovered));
        await waitFor(async () => next.gateway.calls.length > 0, '恢复后应发起模型调用');
        await waitFor(async () => {
          const record = await loadRun(next.repository, runId);
          return ['ready', 'ready_with_issues'].includes(record.status);
        }, 'resume 后完成');
        const after = await loadRun(next.repository, runId);
        assert.notEqual(after.attemptId, attemptBefore, '继续应开启新尝试');
        assert.ok(after.checkpoint.usage.callCount > before, '新尝试用量应在历史基础上累加');
        // 旧尝试的迟到回调没有把新正文覆写成旧稿
        assert.notEqual(after.checkpoint.acceptedDraftText, acceptedAfterFirst);
        assert.equal(after.checkpoint.changes.length, 3, '三段改写应全部在册');
      }
    );
  }
);

test(
  'B3 真实 PG 重建 · 停靠点 3：单位补修在途重启，补修名额与历史调用数保留且同单位不再获得补修',
  { skip: PG_TEST_URL ? false : SKIP_REASON },
  async () => {
    await runRebuildCase(
      {
        script: {
          rewrites: ['夜幕灯火亮起，街上无人。', 'BB', 'CCCCCC'],
          reviews: [() => REVIEW_BLOCKING],
          repair: () => REPAIRED_UNIT,
        },
      },
      async ({ start, rebuild }) => {
        const { runId, lifecycle } = await start('req-repair');
        // 单位补修调用在途时取消（名额已在调用前落库）
        const started = lifecycle.gateway.hangOnNth(CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY, 1);
        await started;
        await lifecycle.service.cancelRun('p1', 1, runId, 'user-1', {
          expectedAttemptId: (await loadRun(lifecycle.repository, runId)).attemptId,
        });
        await waitFor(
          async () => (await loadRun(lifecycle.repository, runId)).status === 'paused',
          '取消后进入 paused'
        );
        const paused = await loadRun(lifecycle.repository, runId);
        assert.equal(paused.checkpoint.unitRecovery?.repairCount, 1);
        assert.deepEqual(paused.checkpoint.unitRecovery?.repairedUnitIds, ['u0']);

        const { lifecycle: next, recovered } = await rebuild(paused);
        assert.equal(recovered.checkpoint.unitRecovery?.repairCount, 1, '名额不得因重建重置');
        assert.deepEqual(recovered.checkpoint.unitRecovery?.repairedUnitIds, ['u0']);
        assert.equal(next.gateway.calls.length, 0);

        await next.service.resumeRun('p1', 1, runId, 'user-1', resumeInput(recovered));
        await waitFor(async () => next.gateway.calls.length > 0, '恢复后应发起模型调用');
        await waitFor(async () => {
          const record = await loadRun(next.repository, runId);
          return ['ready', 'ready_with_issues', 'paused'].includes(record.status);
        }, 'resume 后推进');
        const after = await loadRun(next.repository, runId);
        // 同一单位不会重新获得补修次数（不会无限循环）
        assert.equal(after.checkpoint.unitRecovery?.repairCount, 1);
        assert.deepEqual(after.checkpoint.unitRecovery?.repairedUnitIds, ['u0']);
      }
    );
  }
);

test(
  'B3 真实 PG 重建 · 停靠点 4：最终接缝补修在途重启，名额/问题账本保留且继续后检查完成才可应用',
  { skip: PG_TEST_URL ? false : SKIP_REASON },
  async () => {
    await runRebuildCase(
      {
        script: {
          rewrites: ['AAAAA', 'BB', 'CCCCCC'],
          // 逐段检查通过；整章最终检查（第 4 次 review 起）报出可定位阻断 → 触发接缝补修
          reviews: [
            () => REVIEW_OK,
            () => REVIEW_OK,
            () => REVIEW_OK,
            () =>
              JSON.stringify({
                issues: [
                  {
                    kind: 'continuity',
                    severity: 'high',
                    anchorQuote: 'AAAAA',
                    expectedFact: '与邻文接缝状态一致',
                    sourceEvidence: '原文',
                    fixIntent: '修复接缝状态',
                  },
                ],
                exitStateFacts: [],
              }),
          ],
          repair: () => 'AAAAA-fixed',
        },
      },
      async ({ start, rebuild }) => {
        const { runId, lifecycle } = await start('req-seam');
        const started = lifecycle.gateway.hangOnNth(CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY, 1);
        await started;
        await lifecycle.service.cancelRun('p1', 1, runId, 'user-1', {
          expectedAttemptId: (await loadRun(lifecycle.repository, runId)).attemptId,
        });
        await waitFor(
          async () => (await loadRun(lifecycle.repository, runId)).status === 'paused',
          '取消后进入 paused'
        );
        const paused = await loadRun(lifecycle.repository, runId);
        assert.equal(paused.checkpoint.unitRecovery?.seamRepairCount, 1, '接缝名额应在调用前落库');
        const issuesBefore = paused.checkpoint.issues.length;

        const { lifecycle: next, recovered } = await rebuild(paused);
        assert.equal(recovered.checkpoint.unitRecovery?.seamRepairCount, 1, '名额不得因重建重置');
        assert.equal(recovered.checkpoint.issues.length, issuesBefore, '问题账本应完整保留');
        assert.equal(recovered.checkpoint.resumeState?.finalCheckCompleted, false);
        assert.equal(next.gateway.calls.length, 0);

        await next.service.resumeRun('p1', 1, runId, 'user-1', resumeInput(recovered));
        await waitFor(async () => next.gateway.calls.length > 0, '恢复后应发起模型调用');
        await waitFor(async () => {
          const record = await loadRun(next.repository, runId);
          return ['ready', 'ready_with_issues', 'paused'].includes(record.status);
        }, 'resume 后推进');
        const after = await loadRun(next.repository, runId);
        assert.equal(after.checkpoint.unitRecovery?.seamRepairCount, 1);
        if (['ready', 'ready_with_issues'].includes(after.status)) {
          assert.equal(after.checkpoint.resumeState, null, '终态不应保留续跑计划');
        } else {
          assert.equal(after.status, 'paused', '检查未完成必须暂停');
        }
      }
    );
  }
);

test(
  'B3 真实 PG 重建 · 统一断言：原文版本变化后 resume 走 1307，不覆盖新正文',
  { skip: PG_TEST_URL ? false : SKIP_REASON },
  async () => {
    await runRebuildCase(
      { script: { rewrites: ['AAAAA', 'BB', 'CCCCCC'] } },
      async ({ source, start, rebuild }) => {
        const { runId, lifecycle } = await start('req-source');
        const started = lifecycle.gateway.hangOnNth(CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY, 2);
        await started;
        await lifecycle.service.cancelRun('p1', 1, runId, 'user-1', {
          expectedAttemptId: (await loadRun(lifecycle.repository, runId)).attemptId,
        });
        await waitFor(
          async () => (await loadRun(lifecycle.repository, runId)).status === 'paused',
          '取消后进入 paused'
        );
        const paused = await loadRun(lifecycle.repository, runId);

        // 重建前原文被其他操作更新
        source.updatedAt = new Date('2026-10-06T11:00:00.000Z');
        const { lifecycle: next, recovered } = await rebuild(paused);
        await assert.rejects(
          () => next.service.resumeRun('p1', 1, runId, 'user-1', resumeInput(recovered)),
          (error: unknown) => {
            const code = (error as { response?: { code?: number } }).response?.code;
            const status = (error as { status?: number }).status;
            return code === 1307 && status === 400;
          },
          '原文版本变化应拒绝继续'
        );
        const after = await loadRun(next.repository, runId);
        assert.equal(after.status, 'paused');
        assert.equal(after.pauseReason, 'source_changed');
        assert.equal(after.resumable, false, '原文已变更不得继续');
      }
    );
  }
);

test(
  'B3 真实 PG 重建 · 统一断言：E1 全章阻断在 PG 恢复下仍不可应用',
  { skip: PG_TEST_URL ? false : SKIP_REASON },
  async () => {
    await runRebuildCase(
      { script: { rewrites: ['AAAAA', 'BB', 'CCCCCC'] } },
      async ({ start, rebuild }) => {
        const { runId, lifecycle } = await start('req-e1');
        const started = lifecycle.gateway.hangOnNth(CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY, 2);
        await started;
        await lifecycle.service.cancelRun('p1', 1, runId, 'user-1', {
          expectedAttemptId: (await loadRun(lifecycle.repository, runId)).attemptId,
        });
        await waitFor(
          async () => (await loadRun(lifecycle.repository, runId)).status === 'paused',
          '取消后进入 paused'
        );
        const paused = await loadRun(lifecycle.repository, runId);

        const { lifecycle: next, recovered } = await rebuild(paused);
        // 写入 E1 场景：无 unitId 的全章高危未解决阻断 + 另一条无 unitId 的保留提示
        const withBlocking: RefinementRunRecord = {
          ...recovered,
          checkpoint: {
            ...recovered.checkpoint,
            issues: [
              ...recovered.checkpoint.issues,
              {
                id: 'i-e1',
                category: 'hard_constraint' as const,
                severity: 'high' as const,
                message: '整章最终检查：接缝状态冲突（无法定位到单一活动候选）',
                disposition: 'unresolved' as const,
              },
              {
                id: 'i-e1-retain',
                category: 'coverage' as const,
                severity: 'medium' as const,
                message: '另一场保留原文提示',
                disposition: 'retained_original' as const,
              },
            ],
          },
        };
        const saved = await next.repository.save(withBlocking, recovered.revision);
        assert.ok(saved, '注入 E1 阻断应写入成功');

        await next.service.resumeRun(
          'p1',
          1,
          runId,
          'user-1',
          resumeInput(saved as RefinementRunRecord)
        );
        const after = await waitForResumed(next.repository, runId);
        assert.equal(after.status, 'paused', 'E1：全章阻断未解决不得进入可应用终态');
        assert.equal(after.pauseReason, 'boundary_conflict');
        assert.ok(
          after.checkpoint.issues.some(
            (issue) => issue.disposition === 'unresolved' && issue.severity === 'high'
          )
        );
      }
    );
  }
);

test(
  'B3 真实 PG 重建 · 通用断言：重建后权限被撤销，继续必须被拒绝',
  { skip: PG_TEST_URL ? false : SKIP_REASON },
  async () => {
    await runRebuildCase(
      { script: { rewrites: ['AAAAA', 'BB', 'CCCCCC'] } },
      async ({ start, rebuild }) => {
        const { runId, lifecycle } = await start('req-access');
        const started = lifecycle.gateway.hangOnNth(CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY, 1);
        await started;
        await lifecycle.service.cancelRun('p1', 1, runId, 'user-1', {
          expectedAttemptId: (await loadRun(lifecycle.repository, runId)).attemptId,
        });
        await waitFor(
          async () => (await loadRun(lifecycle.repository, runId)).status === 'paused',
          '取消后进入 paused'
        );
        const paused = await loadRun(lifecycle.repository, runId);

        const { lifecycle: next, recovered } = await rebuild(paused);
        accessRevoked = true;
        try {
          await assert.rejects(
            () => next.service.resumeRun('p1', 1, runId, 'user-1', resumeInput(recovered)),
            /FORBIDDEN|无权访问|403/,
            '权限撤销后不得继续'
          );
          await waitFor(
            async () => (await loadRun(next.repository, runId)).status === 'paused',
            '被拒绝后仍是 paused'
          );
          assert.equal(next.gateway.calls.length, 0, '权限撤销后不得发起任何模型调用');
        } finally {
          accessRevoked = false;
        }
      }
    );
  }
);

test(
  'B3 真实 PG 重建 · 通用断言：重建后模型与参考材料仍用冻结版本（期间变更不生效）',
  { skip: PG_TEST_URL ? false : SKIP_REASON },
  async () => {
    await runRebuildCase(
      { script: { rewrites: ['AAAAA', 'BB', 'CCCCCC'] } },
      async ({ start, rebuild }) => {
        const { runId, lifecycle } = await start('req-frozen');
        const started = lifecycle.gateway.hangOnNth(CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY, 1);
        await started;
        await lifecycle.service.cancelRun('p1', 1, runId, 'user-1', {
          expectedAttemptId: (await loadRun(lifecycle.repository, runId)).attemptId,
        });
        await waitFor(
          async () => (await loadRun(lifecycle.repository, runId)).status === 'paused',
          '取消后进入 paused'
        );
        const paused = await loadRun(lifecycle.repository, runId);
        const frozenHash = paused.snapshot.templateVersions[0]?.hash;
        const frozenAt = paused.snapshot.referenceMaterials?.frozenAt ?? null;
        const frozenModel = paused.snapshot.modelRoutes?.writing?.model;

        // 重建发生在「项目设置已变更」之后：新进程仍必须用 run 冻结的那一份
        materialsRotated = true;
        try {
          const { lifecycle: next, recovered } = await rebuild(paused);
          assert.equal(recovered.snapshot.templateVersions[0]?.hash, frozenHash, '模板版本仍冻结');
          assert.equal(
            recovered.snapshot.referenceMaterials?.frozenAt ?? null,
            frozenAt,
            '参考材料冻结时间不变'
          );
          assert.equal(
            recovered.snapshot.modelRoutes?.writing?.model,
            frozenModel,
            '模型路由仍冻结'
          );
          await next.service.resumeRun('p1', 1, runId, 'user-1', resumeInput(recovered));
          await waitFor(async () => {
            const record = await loadRun(next.repository, runId);
            return ['ready', 'ready_with_issues'].includes(record.status);
          }, 'resume 后完成');
          const after = await loadRun(next.repository, runId);
          assert.equal(after.snapshot.templateVersions[0]?.hash, frozenHash, '完成后仍用冻结版本');
          assert.notEqual(after.snapshot.referenceMaterials?.personaText, '（变更后的人物）');
        } finally {
          materialsRotated = false;
        }
      }
    );
  }
);
