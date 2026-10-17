/**
 * 章节精修编排服务（AQ-380 基线）。
 *
 * 职责：冻结已保存章节 → 创建独立 run → 后台顺序执行引擎 → 通过事件总线对外观察。
 * 不触碰章节存储：候选稿只存在于 run，应用仍由旧 apply 入口负责。
 */

import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProjectsService } from './projects.service';
import { hashChapterContent } from './chapter-content-hash.util';
import {
  ChapterVersionConflictError,
  ensureChapterVersionMatches,
  parseExpectedUpdatedAt,
} from './chapter-optimize.util';
import {
  assertRefinementInstruction,
  assertRefinementSourceText,
  buildRefinementRunSummary,
  buildRefinementRunView,
  computeRefinementExpiresAt,
  computeRefinementPayloadHash,
  createInitialRefinementCheckpoint,
  isRefinementActiveStatus,
  isRefinementResumable,
  isRefinementTerminalStatus,
  normalizeRefinementRewritePolicy,
  REFINEMENT_ACTIVE_STATUSES,
  RefinementValidationError,
  resolveRefinementPolicy,
  tombstoneRefinementRun,
  type RefinementCancelInput,
  type RefinementCreateInput,
  type RefinementDiscardInput,
  type RefinementPauseReason,
  type RefinementResumeInput,
  type RefinementRunRecord,
  type RefinementRunSummary,
  type RefinementRunView,
} from './chapter-refinement.types';
import {
  CHAPTER_REFINEMENT_RUN_REPOSITORY,
  RefinementRunConflictError,
  type ChapterRefinementRunRepository,
} from './chapter-refinement-run.repository';
import {
  CHAPTER_REFINEMENT_ENGINE,
  type ChapterRefinementEngine,
  type RefinementEngineResult,
} from './chapter-refinement.engine';
import {
  CHAPTER_REFINEMENT_MATERIALS,
  type ChapterRefinementMaterialsProvider,
} from './chapter-refinement.materials';
import { ChapterRefinementEventBus } from './chapter-refinement-event-bus';
import type { SseStreamContext } from '../../common/sse-stream.util';

const LIST_DEFAULT_LIMIT = 10;
const LIST_MAX_LIMIT = 20;
/** 5.1：终态 / 暂停记录 TTL 清理扫描周期 */
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

/** 5.1：每次模型调用前重新校验权限/原文版本发现变化时的暂停信号。 */
interface RefinementGuardStop {
  reason: RefinementPauseReason;
  message: string;
  resumable: boolean;
}

@Injectable()
export class ChapterRefinementService implements OnModuleInit, OnModuleDestroy {
  /** runId → 当前执行尝试的取消句柄；cancel 用它中止在途调用 */
  private readonly attempts = new Map<string, AbortController>();
  /** runId → 调用前校验发现的暂停原因（覆盖引擎默认的 user_cancelled） */
  private readonly guardStops = new Map<string, RefinementGuardStop>();
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly projectsService: ProjectsService,
    @Inject(CHAPTER_REFINEMENT_RUN_REPOSITORY)
    private readonly repository: ChapterRefinementRunRepository,
    @Inject(CHAPTER_REFINEMENT_ENGINE)
    private readonly engine: ChapterRefinementEngine,
    private readonly eventBus: ChapterRefinementEventBus,
    @Inject(CHAPTER_REFINEMENT_MATERIALS)
    private readonly materials: ChapterRefinementMaterialsProvider
  ) {}

  /**
   * 5.1：启动时把遗留 queued/running 收敛为 paused/process_restart（R10）。
   *
   * PG 模式可据此恢复已接受单位；内存模式启动时 Map 为空，天然无可恢复记录，
   * 前端按 `storageMode` 明确告知「服务重启无法恢复」。
   */
  async onModuleInit(): Promise<void> {
    await this.recoverInterruptedRuns();
    await this.cleanupExpiredRuns();
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredRuns().catch((error) => {
        console.error('[chapter-refinement] 过期清理失败:', error);
      });
    }, CLEANUP_INTERVAL_MS);
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  async createRun(
    projectId: string,
    chapterNo: number,
    payload: RefinementCreateInput,
    userId: string,
    traceId?: string
  ): Promise<RefinementRunSummary> {
    this.projectsService.checkAccess(projectId, userId, ['owner', 'editor']);

    const source = this.projectsService.getChapterRefinementSource(projectId, chapterNo);
    if (!source) {
      throw new NotFoundException(`未找到第${chapterNo}章`);
    }

    const clientRequestId =
      typeof payload?.clientRequestId === 'string' ? payload.clientRequestId.trim() : '';
    if (!clientRequestId) {
      throw new BadRequestException({ code: 1400, msg: 'clientRequestId 不能为空' });
    }

    let expectedAt: Date;
    try {
      expectedAt = parseExpectedUpdatedAt(payload?.expectedChapterUpdatedAt);
    } catch (error) {
      throw new BadRequestException({
        code: 1400,
        msg: error instanceof Error ? error.message : 'expectedChapterUpdatedAt 非法',
      });
    }

    let instruction: string;
    let baseText: string;
    let rewritePolicy: ReturnType<typeof normalizeRefinementRewritePolicy>;
    let policy: ReturnType<typeof resolveRefinementPolicy>;
    try {
      instruction = assertRefinementInstruction(payload?.instruction);
      baseText = assertRefinementSourceText(source.content);
      rewritePolicy = normalizeRefinementRewritePolicy(payload?.rewritePolicy);
      policy = resolveRefinementPolicy({
        requested: payload?.diagnosisTargetChars,
        projectSegmentCharSize: source.chapterOptimizeSegmentCharSize,
      });
    } catch (error) {
      if (error instanceof RefinementValidationError) {
        throw new BadRequestException({ code: 1400, msg: error.message });
      }
      throw error;
    }

    try {
      ensureChapterVersionMatches(chapterNo, expectedAt, source.updatedAt);
    } catch (error) {
      if (error instanceof ChapterVersionConflictError) {
        throw new BadRequestException({
          code: 1307,
          msg: '章节正文已被其他操作更新，请重新拉取后再发起智能精修',
          chapterNo,
          expected: error.expected,
          actual: error.actual,
        });
      }
      throw error;
    }

    const payloadHash = computeRefinementPayloadHash({
      expectedChapterUpdatedAt: expectedAt.toISOString(),
      instruction,
      rewritePolicy,
      diagnosisTargetChars: payload?.diagnosisTargetChars,
    });

    const idempotent = await this.repository.findByClientRequestId(userId, clientRequestId);
    if (idempotent) {
      return this.resolveIdempotentReplay(idempotent, payloadHash);
    }

    const active = await this.repository.findActive(projectId, chapterNo, userId);
    if (active) {
      throw this.activeRunConflict(active);
    }

    const now = new Date();
    // AQ-381：冻结模板文本 / 项目 systemPrompt / 模型路由，运行中不受 Settings 改动影响
    // C4：同时按当前 chapterNo 冻结「排除本章来源 + 任务适用」的文风样本
    const materials = this.materials.resolve(projectId, userId, chapterNo);
    const record: RefinementRunRecord = {
      runId: randomUUID(),
      projectId,
      chapterNo,
      creatorId: userId,
      clientRequestId,
      payloadHash,
      status: 'queued',
      phase: 'reading',
      revision: 1,
      attemptId: null,
      pauseReason: null,
      resumable: false,
      baseUpdatedAt: source.updatedAt.toISOString(),
      baseHash: hashChapterContent(baseText),
      rewritePolicy,
      snapshot: {
        instruction,
        baseTitle: source.title,
        baseText,
        systemPromptText: materials.systemPromptText,
        templateVersions: materials.templateVersions,
        modelRoute: materials.modelRoutes.writing,
        templateTexts: materials.templateTexts,
        modelRoutes: materials.modelRoutes,
        // F4：冻结 run 实际注入的人物 / 知识 / 文风参考材料；运行中修改来源不影响本 run
        referenceMaterials: materials.referenceMaterials,
        // 6.1：把创建请求的 trace id 冻结进快照，便于把 run 关联回发起请求（不含凭据）
        creationTraceId: typeof traceId === 'string' && traceId.trim() ? traceId.trim() : null,
        resolvedPolicy: policy,
        frozenAt: now.toISOString(),
      },
      checkpoint: createInitialRefinementCheckpoint(baseText),
      tombstone: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: computeRefinementExpiresAt('queued', now),
    };

    try {
      await this.repository.create(record);
    } catch (error) {
      if (error instanceof RefinementRunConflictError) {
        if (error.kind === 'idempotency_key') {
          const existing = await this.repository.findByClientRequestId(userId, clientRequestId);
          if (existing) {
            return this.resolveIdempotentReplay(existing, payloadHash);
          }
        }
        const racedActive = await this.repository.findActive(projectId, chapterNo, userId);
        if (racedActive) {
          throw this.activeRunConflict(racedActive);
        }
      }
      throw error;
    }

    this.startRunInBackground(record.runId);
    return buildRefinementRunSummary(record, this.repository.storageMode);
  }

  async listRuns(
    projectId: string,
    chapterNo: number,
    userId: string,
    limit?: number
  ): Promise<RefinementRunSummary[]> {
    this.projectsService.checkAccess(projectId, userId, ['owner', 'editor']);
    const source = this.projectsService.getChapterRefinementSource(projectId, chapterNo);
    if (!source) {
      throw new NotFoundException(`未找到第${chapterNo}章`);
    }
    const normalizedLimit = this.normalizeLimit(limit);
    const records = await this.repository.listByCreator(
      projectId,
      chapterNo,
      userId,
      normalizedLimit
    );
    return records.map((record) => buildRefinementRunSummary(record, this.repository.storageMode));
  }

  async getRun(
    projectId: string,
    chapterNo: number,
    runId: string,
    userId: string
  ): Promise<RefinementRunView> {
    this.projectsService.checkAccess(projectId, userId, ['owner', 'editor']);
    const record = await this.loadOwnedRun(projectId, chapterNo, runId, userId);
    if (record.tombstone) {
      throw new GoneException({ code: 1410, msg: '该精修运行的候选材料已被清理，请重新发起' });
    }
    return buildRefinementRunView(
      record,
      this.repository.storageMode,
      this.isSourceCurrent(record)
    );
  }

  /**
   * SSE 观察。调用前必须先 `getRun` 完成鉴权与 404/410 判定（SSE 头一旦写出无法再改状态码）。
   * 订阅与执行解耦：断开只结束观察，不取消后台 run。
   */
  async observeRun(
    projectId: string,
    chapterNo: number,
    runId: string,
    userId: string,
    ctx: SseStreamContext
  ): Promise<void> {
    const record = await this.loadOwnedRun(projectId, chapterNo, runId, userId);

    let closed = false;
    let buffering = true;
    const buffered: Array<Record<string, unknown>> = [];

    const writeOrClose = (event: Record<string, unknown>) => {
      if (!ctx.writeEvent(event)) {
        closed = true;
        return false;
      }
      if (event.event === 'paused' || event.event === 'finished' || event.event === 'error') {
        closed = true;
        ctx.end();
      }
      return true;
    };

    const unsubscribe = this.eventBus.subscribe(runId, (event) => {
      if (closed) {
        return;
      }
      if (buffering) {
        buffered.push(event);
        return;
      }
      writeOrClose(event);
    });

    try {
      // 先发权威快照，再补发订阅窗口内的事件；客户端不依赖丢失的增量重建正文
      writeOrClose({
        event: 'snapshot',
        runId,
        revision: record.revision,
        attemptId: record.attemptId,
        seq: 0,
        run: buildRefinementRunView(
          record,
          this.repository.storageMode,
          this.isSourceCurrent(record)
        ),
      });

      buffering = false;
      const pending = buffered.splice(0, buffered.length);
      for (const event of pending) {
        if (closed || !writeOrClose(event)) {
          return;
        }
      }

      if (isRefinementTerminalStatus(record.status)) {
        writeOrClose({
          event: 'finished',
          runId,
          revision: record.revision,
          attemptId: record.attemptId,
          seq: 0,
          run: buildRefinementRunSummary(record, this.repository.storageMode),
        });
        return;
      }

      // paused 不是终态，但本次观察没有可继续的实时事件：发出 paused 后关闭本订阅
      if (record.status === 'paused') {
        writeOrClose({
          event: 'paused',
          runId,
          revision: record.revision,
          attemptId: record.attemptId,
          seq: 0,
          run: buildRefinementRunSummary(record, this.repository.storageMode),
        });
        return;
      }

      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (ctx.isAborted() || closed) {
            clearInterval(timer);
            resolve();
          }
        }, 1000);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      });
    } finally {
      closed = true;
      unsubscribe();
    }
  }

  /** 5.1：显式中止当前执行尝试并保存最后有效 checkpoint（R9/R10）；同尝试幂等。 */
  async cancelRun(
    projectId: string,
    chapterNo: number,
    runId: string,
    userId: string,
    payload: RefinementCancelInput | undefined
  ): Promise<RefinementRunSummary> {
    this.projectsService.checkAccess(projectId, userId, ['owner', 'editor']);
    const record = await this.loadOwnedRun(projectId, chapterNo, runId, userId);
    if (record.tombstone) {
      throw new GoneException({ code: 1410, msg: '该精修运行的候选材料已被清理，请重新发起' });
    }

    const expectedAttemptId =
      typeof payload?.expectedAttemptId === 'string' ? payload.expectedAttemptId.trim() : '';

    // 已经停止（paused / 终态）：取消幂等，直接返回当前状态
    if (!isRefinementActiveStatus(record.status)) {
      return buildRefinementRunSummary(record, this.repository.storageMode);
    }

    // 已进入另一轮尝试：拒绝过期取消，避免旧浏览器取消新续跑
    if (expectedAttemptId && record.attemptId && expectedAttemptId !== record.attemptId) {
      throw new BadRequestException({
        code: 1409,
        msg: '该精修运行已进入新一轮执行，取消请求已过期',
      });
    }

    this.attempts.get(runId)?.abort();
    const saved = await this.stopRun(record, 'user_cancelled', '作者已取消，已保存当前成果');
    const summary = buildRefinementRunSummary(saved, this.repository.storageMode);
    this.eventBus.publish(runId, {
      event: 'paused',
      revision: saved.revision,
      attemptId: saved.attemptId,
      payload: { run: summary },
    });
    return summary;
  }

  /** 5.1：从 checkpoint 继续；重新校验权限与原文版本后另开执行尝试（R8/R10）。 */
  async resumeRun(
    projectId: string,
    chapterNo: number,
    runId: string,
    userId: string,
    payload: RefinementResumeInput | undefined
  ): Promise<RefinementRunSummary> {
    this.projectsService.checkAccess(projectId, userId, ['owner', 'editor']);
    const record = await this.loadOwnedRun(projectId, chapterNo, runId, userId);
    if (record.tombstone) {
      throw new GoneException({ code: 1410, msg: '该精修运行的候选材料已被清理，请重新发起' });
    }
    if (record.status !== 'paused') {
      throw new BadRequestException({ code: 1409, msg: '当前精修运行不处于可继续状态' });
    }
    const expectedRevision = payload?.expectedRunRevision;
    if (
      typeof expectedRevision !== 'number' ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 1
    ) {
      throw new BadRequestException({ code: 1400, msg: 'expectedRunRevision 必须为正整数' });
    }
    if (expectedRevision !== record.revision) {
      throw new BadRequestException({ code: 1409, msg: '精修运行状态已变化，请刷新后重试' });
    }
    if (!isRefinementResumable(record)) {
      throw new BadRequestException({
        code: 1409,
        msg: '当前运行不可继续（原文已变更、权限撤销或存在未解决的边界冲突），请新建精修',
      });
    }

    const verification = this.verifyResumableSource(record);
    if (!verification.ok) {
      await this.stopRun(record, verification.reason, verification.message);
      throw new BadRequestException({ code: verification.code, msg: verification.message });
    }

    this.startRunInBackground(runId, 'resume');
    const latest = await this.repository.getById(runId);
    return buildRefinementRunSummary(latest ?? record, this.repository.storageMode);
  }

  /** 5.1：先取消在途尝试，再清理候选材料并保留最小墓碑；已 discarded 时幂等（R9/R10）。 */
  async discardRun(
    projectId: string,
    chapterNo: number,
    runId: string,
    userId: string,
    payload: RefinementDiscardInput | undefined
  ): Promise<RefinementRunSummary> {
    this.projectsService.checkAccess(projectId, userId, ['owner', 'editor']);
    const record = await this.loadOwnedRun(projectId, chapterNo, runId, userId);
    if (record.status === 'discarded') {
      return buildRefinementRunSummary(record, this.repository.storageMode);
    }
    if (record.tombstone) {
      throw new GoneException({ code: 1410, msg: '该精修运行已过期，候选材料已不可读' });
    }
    const expectedRevision = payload?.expectedRunRevision;
    if (
      typeof expectedRevision !== 'number' ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 1
    ) {
      throw new BadRequestException({ code: 1400, msg: 'expectedRunRevision 必须为正整数' });
    }
    if (expectedRevision !== record.revision) {
      throw new BadRequestException({ code: 1409, msg: '精修运行状态已变化，请刷新后重试' });
    }

    this.attempts.get(runId)?.abort();
    const now = new Date();
    const tombstone = tombstoneRefinementRun(record, 'discarded', now);
    const saved = await this.repository.save(tombstone, record.revision);
    const finalRecord = saved ?? (await this.repository.getById(runId)) ?? tombstone;
    const summary = buildRefinementRunSummary(finalRecord, this.repository.storageMode);
    this.eventBus.publish(runId, {
      event: 'finished',
      revision: summary.revision,
      attemptId: finalRecord.attemptId,
      payload: { run: summary },
    });
    this.eventBus.release(runId);
    return summary;
  }

  /** 5.1：终态 / 暂停记录按 expiresAt 清理；active 记录不参与（expiresAt 为远期占位）。 */
  async cleanupExpiredRuns(): Promise<number> {
    const now = new Date();
    const due = await this.repository.listExpired(now.toISOString());
    let changed = 0;
    for (const record of due) {
      if (record.tombstone) {
        await this.repository.remove(record.runId);
        changed += 1;
        continue;
      }
      const tombstone = tombstoneRefinementRun(record, 'expired', now);
      const saved = await this.repository.save(tombstone, record.revision);
      if (saved) {
        changed += 1;
      }
    }
    return changed;
  }

  clearForTest(): void {
    this.attempts.clear();
    this.guardStops.clear();
    this.eventBus.clearForTest();
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  private async loadOwnedRun(
    projectId: string,
    chapterNo: number,
    runId: string,
    userId: string
  ): Promise<RefinementRunRecord> {
    const record = await this.repository.getById(runId);
    // run 属于其他创建者 / 其他项目 / 其他章节时统一 404，避免泄露冻结原文与私有 Prompt
    if (
      !record ||
      record.creatorId !== userId ||
      record.projectId !== projectId ||
      record.chapterNo !== chapterNo
    ) {
      throw new NotFoundException({ code: 1404, msg: '未找到该精修运行' });
    }
    return record;
  }

  private isSourceCurrent(record: RefinementRunRecord): boolean {
    const source = this.projectsService.getChapterRefinementSource(
      record.projectId,
      record.chapterNo
    );
    if (!source) {
      return false;
    }
    return source.updatedAt.toISOString() === record.baseUpdatedAt;
  }

  private resolveIdempotentReplay(
    existing: RefinementRunRecord,
    payloadHash: string
  ): RefinementRunSummary {
    if (existing.payloadHash !== payloadHash) {
      throw new BadRequestException({
        code: 1409,
        msg: 'clientRequestId 已用于另一份创建参数，请使用新的 clientRequestId',
      });
    }
    return buildRefinementRunSummary(existing, this.repository.storageMode);
  }

  private activeRunConflict(active: RefinementRunRecord): BadRequestException {
    return new BadRequestException({
      code: 1409,
      msg: '该章节已有进行中的智能精修，请等待完成或稍后重试',
      runId: active.runId,
    });
  }

  private normalizeLimit(limit?: number): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
      return LIST_DEFAULT_LIMIT;
    }
    return Math.min(LIST_MAX_LIMIT, Math.floor(limit));
  }

  private startRunInBackground(runId: string, mode: 'fresh' | 'resume' = 'fresh'): void {
    void this.executeRun(runId, mode).catch((error) => {
      // 后台执行不阻塞创建响应；异常在此收口，避免未处理的 rejection
      console.error(`[chapter-refinement] run=${runId} 执行失败:`, error);
    });
  }

  private async executeRun(runId: string, mode: 'fresh' | 'resume'): Promise<void> {
    const initial = await this.repository.getById(runId);
    const expectedStatus = mode === 'fresh' ? 'queued' : 'paused';
    if (!initial || initial.status !== expectedStatus) {
      return;
    }

    // resume：开跑前再次校验权限与冻结原文版本（R8/design D10）
    if (mode === 'resume') {
      const verification = this.verifyResumableSource(initial);
      if (!verification.ok) {
        await this.stopRun(initial, verification.reason, verification.message);
        return;
      }
    }

    const attemptId = randomUUID();
    const controller = new AbortController();
    this.attempts.set(runId, controller);
    this.guardStops.delete(runId);

    try {
      const running = await this.saveTransition(initial, {
        status: 'running',
        phase: initial.phase,
        attemptId,
        progressMessage: mode === 'resume' ? '正在从断点继续…' : '正在读取冻结原文…',
      });
      if (!running) {
        return;
      }

      const result = await this.engine.run({
        record: running,
        signal: controller.signal,
        onStage: async (stage) => {
          const latest = await this.repository.getById(runId);
          if (!latest || latest.attemptId !== attemptId) {
            return;
          }
          this.eventBus.publish(runId, {
            event: 'stage',
            revision: latest.revision,
            attemptId,
            payload: {
              phase: stage.phase,
              unitIndex: stage.unitIndex,
              unitTotal: stage.unitTotal,
              ...(stage.sceneId ? { sceneId: stage.sceneId } : {}),
              message: stage.message,
            },
          });
        },
        // F1：中途把 checkpoint 持久化（CAS keyed by attemptId + revision）。
        // 计划冻结、每个已完成诊断窗、每个已接受单位、以及**每次真实调用前**都会落库，
        // 进程重启或取消后不丢已接受稿，也不重置补修名额 / 累计用量；
        // attemptId 不匹配（取消 / 续跑后替换）或 CAS 冲突时**抛出**，引擎据此明确停止，
        // 不再继续声称可恢复（存储失败必须显式停止或重试）。
        onCheckpoint: async (checkpoint) => {
          const latest = await this.repository.getById(runId);
          if (!latest || latest.attemptId !== attemptId) {
            throw new Error('attempt 已失效（取消 / 续跑），拒绝写入 checkpoint');
          }
          const saved = await this.repository.save(
            {
              ...latest,
              checkpoint,
              revision: latest.revision + 1,
              updatedAt: new Date().toISOString(),
            },
            latest.revision
          );
          if (!saved) {
            throw new Error('checkpoint 保存 CAS 冲突，未能确认持久化');
          }
        },
        // 每个新模型调用前重新校验权限与原文版本；变化时中止本次尝试并保留成果
        onBeforeCall: () => {
          this.preflight(runId, running, controller);
        },
      });

      const current = await this.repository.getById(runId);
      // 迟到回调：attempt 已被替换（取消/续跑）时丢弃结果
      if (!current || current.attemptId !== attemptId) {
        return;
      }

      // 调用前校验发现变化：用真实原因覆盖引擎默认的 user_cancelled
      const guardStop = this.guardStops.get(runId);
      const effective: RefinementEngineResult =
        guardStop && result.status === 'paused'
          ? {
              ...result,
              pauseReason: guardStop.reason,
              resumable: guardStop.resumable,
              checkpoint: {
                ...result.checkpoint,
                progress: { ...result.checkpoint.progress, message: guardStop.message },
              },
            }
          : result;

      const now = new Date();
      const saved = await this.repository.save(
        {
          ...current,
          status: effective.status,
          phase: effective.phase,
          pauseReason: effective.pauseReason ?? null,
          resumable: effective.resumable,
          checkpoint: effective.checkpoint,
          revision: current.revision + 1,
          updatedAt: now.toISOString(),
          expiresAt: computeRefinementExpiresAt(effective.status, now),
        },
        current.revision
      );
      if (!saved) {
        return;
      }

      this.eventBus.publish(runId, {
        // paused 是「可恢复的停止」，与终态 finished 分开，避免客户端把暂停当成功
        event: saved.status === 'paused' ? 'paused' : 'finished',
        revision: saved.revision,
        attemptId,
        payload: { run: buildRefinementRunSummary(saved, this.repository.storageMode) },
      });
    } finally {
      this.attempts.delete(runId);
      this.guardStops.delete(runId);
    }
  }

  /**
   * 5.1：启动恢复。把遗留 queued/running 收敛为 paused/process_restart，保留最后 checkpoint，
   * 不自动再次调用模型（R10）。PG 模式恢复已接受单位；内存模式启动时 Map 为空，天然无记录。
   */
  private async recoverInterruptedRuns(): Promise<void> {
    let interrupted: RefinementRunRecord[];
    try {
      interrupted = await this.repository.listByStatuses(REFINEMENT_ACTIVE_STATUSES);
    } catch (error) {
      console.error('[chapter-refinement] 恢复扫描失败:', error);
      return;
    }
    const now = new Date();
    for (const record of interrupted) {
      const saved = await this.repository.save(
        {
          ...record,
          status: 'paused',
          attemptId: null,
          pauseReason: 'process_restart',
          resumable: true,
          revision: record.revision + 1,
          updatedAt: now.toISOString(),
          expiresAt: computeRefinementExpiresAt('paused', now),
          checkpoint: {
            ...record.checkpoint,
            progress: { ...record.checkpoint.progress, message: '服务重启，已暂停，可点击继续' },
          },
        },
        record.revision
      );
      if (saved) {
        this.eventBus.publish(record.runId, {
          event: 'paused',
          revision: saved.revision,
          attemptId: null,
          payload: { run: buildRefinementRunSummary(saved, this.repository.storageMode) },
        });
      }
    }
  }

  /** CAS 保存为暂停态；失配（后台已先落库）时返回最新记录。 */
  private async stopRun(
    record: RefinementRunRecord,
    reason: RefinementPauseReason,
    message: string
  ): Promise<RefinementRunRecord> {
    const now = new Date();
    const resumable =
      reason !== 'permission_revoked' &&
      reason !== 'source_changed' &&
      reason !== 'boundary_conflict';
    const saved = await this.repository.save(
      {
        ...record,
        status: 'paused',
        attemptId: null,
        pauseReason: reason,
        resumable,
        revision: record.revision + 1,
        updatedAt: now.toISOString(),
        expiresAt: computeRefinementExpiresAt('paused', now),
        checkpoint: {
          ...record.checkpoint,
          progress: { ...record.checkpoint.progress, message },
        },
      },
      record.revision
    );
    if (saved) {
      return saved;
    }
    return (await this.repository.getById(record.runId)) ?? record;
  }

  /** 继续 / 每次调用前校验冻结原文版本仍然有效（R8/design D10）。 */
  private verifyResumableSource(
    record: RefinementRunRecord
  ): { ok: true } | { ok: false; reason: RefinementPauseReason; message: string; code: number } {
    const source = this.projectsService.getChapterRefinementSource(
      record.projectId,
      record.chapterNo
    );
    if (!source) {
      return {
        ok: false,
        reason: 'source_changed',
        message: '章节已不存在，无法继续该精修运行',
        code: 1307,
      };
    }
    if (source.updatedAt.toISOString() !== record.baseUpdatedAt) {
      return {
        ok: false,
        reason: 'source_changed',
        message: '章节正文已变更，无法继续该精修运行',
        code: 1307,
      };
    }
    return { ok: true };
  }

  /** 每个模型调用前的权限 / 原文版本校验；发现变化中止本次尝试并记录真实原因。 */
  private preflight(runId: string, record: RefinementRunRecord, controller: AbortController): void {
    let permissionOk = true;
    try {
      this.projectsService.checkAccess(record.projectId, record.creatorId, ['owner', 'editor']);
    } catch {
      permissionOk = false;
    }
    if (!permissionOk) {
      this.guardStops.set(runId, {
        reason: 'permission_revoked',
        message: '项目权限已撤销，已暂停并保留当前成果',
        resumable: false,
      });
      controller.abort();
      return;
    }
    const verification = this.verifyResumableSource(record);
    if (!verification.ok) {
      this.guardStops.set(runId, {
        reason: verification.reason,
        message: verification.message,
        resumable: false,
      });
      controller.abort();
    }
  }

  private async saveTransition(
    record: RefinementRunRecord,
    patch: {
      status: RefinementRunRecord['status'];
      phase: RefinementRunRecord['phase'];
      attemptId: string;
      progressMessage: string;
    }
  ): Promise<RefinementRunRecord | undefined> {
    const now = new Date();
    return this.repository.save(
      {
        ...record,
        status: patch.status,
        phase: patch.phase,
        attemptId: patch.attemptId,
        revision: record.revision + 1,
        updatedAt: now.toISOString(),
        expiresAt: computeRefinementExpiresAt(patch.status, now),
        checkpoint: {
          ...record.checkpoint,
          progress: { ...record.checkpoint.progress, message: patch.progressMessage },
        },
      },
      record.revision
    );
  }
}
