/**
 * 章节精修编排（AQ-380）前端纯函数与视图模型。
 *
 * 与后端 `services/api/src/modules/projects/chapter-refinement.types.ts` 语义对齐；
 * 本文件不依赖 Vue，便于单测。
 */

import type { components } from '@aether-quill/shared-types';

export type RefinementStatus = components['schemas']['RefinementStatus'];
export type RefinementPhase = components['schemas']['RefinementPhase'];
export type RefinementPauseReason = components['schemas']['RefinementPauseReason'];
export type RefinementRewritePolicy = components['schemas']['ChapterRefinementRewritePolicy'];
export type RefinementStorageMode = components['schemas']['ChapterRefinementStorageMode'];
export type RefinementProgress = components['schemas']['RefinementProgress'];
export type RefinementUsage = components['schemas']['RefinementUsage'];
export type RefinementCoverage = components['schemas']['RefinementCoverage'];
export type RefinementChange = components['schemas']['RefinementChange'];
export type RefinementIssue = components['schemas']['RefinementIssue'];
export type RefinementTemplateVersionRef = components['schemas']['RefinementTemplateVersionRef'];
export type RefinementRunSummary = components['schemas']['RefinementRunSummary'];
export type RefinementRunView = components['schemas']['RefinementRunView'];
export type ChapterRefinementCreateRequest =
  components['schemas']['ChapterRefinementCreateRequest'];
export type ChapterRefinementCancelRequest =
  components['schemas']['ChapterRefinementCancelRequest'];
export type ChapterRefinementResumeRequest =
  components['schemas']['ChapterRefinementResumeRequest'];
export type ChapterRefinementDiscardRequest =
  components['schemas']['ChapterRefinementDiscardRequest'];

/** 隐藏入口开关的 query 参数名；默认不公开，仅在显式携带时渲染入口。 */
export const REFINEMENT_ENTRY_QUERY_KEY = 'refinement';

/**
 * 草稿入口默认不公开：只有 URL 显式带 `?refinement=1`（或 `true`）时才渲染。
 * 该判定为纯函数，便于测试与后续替换为正式发布开关。
 */
export function isChapterRefinementEntryEnabled(search: string): boolean {
  const normalized = search.startsWith('?') ? search.slice(1) : search;
  const value = new URLSearchParams(normalized).get(REFINEMENT_ENTRY_QUERY_KEY);
  return value === '1' || value === 'true';
}

const ACTIVE_STATUSES: readonly RefinementStatus[] = ['queued', 'running'];
const TERMINAL_STATUSES: readonly RefinementStatus[] = [
  'ready',
  'ready_with_issues',
  'failed',
  'discarded',
  'expired',
];

export function isRefinementActive(status: RefinementStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function isRefinementTerminal(status: RefinementStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** 候选是否可对比（含 ready_with_issues；apply 入口留给后续任务）。 */
export function isRefinementCandidateReady(status: RefinementStatus): boolean {
  return status === 'ready' || status === 'ready_with_issues';
}

const STATUS_LABELS: Record<RefinementStatus, string> = {
  queued: '排队中',
  running: '精修中',
  paused: '已暂停',
  ready: '候选已就绪',
  ready_with_issues: '候选已就绪（含提示）',
  failed: '执行失败',
  discarded: '已放弃',
  expired: '已过期',
};

const PHASE_LABELS: Record<RefinementPhase, string> = {
  reading: '通读原文',
  planning: '统筹规划',
  rewriting: '范围改写',
  repairing: '定向补修',
  verifying: '最终校验',
  finished: '已完成',
};

const PAUSE_REASON_LABELS: Record<RefinementPauseReason, string> = {
  user_cancelled: '作者取消',
  budget_exhausted: '预算耗尽',
  upstream_failure: '上游模型失败',
  process_restart: '服务重启',
  context_budget: '上下文预算不足',
  invalid_model_output: '模型输出不可用',
  boundary_conflict: '边界冲突',
  permission_revoked: '权限已撤销',
  source_changed: '原文已变更',
  persistence_failed: '进度保存失败',
};

export function formatRefinementStatusLabel(status: RefinementStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatRefinementPhaseLabel(phase: RefinementPhase): string {
  return PHASE_LABELS[phase] ?? phase;
}

export function formatRefinementPauseReason(reason: RefinementPauseReason): string {
  return PAUSE_REASON_LABELS[reason] ?? reason;
}

const ISSUE_SEVERITY_LABELS: Record<RefinementIssue['severity'], string> = {
  high: '严重',
  medium: '中等',
  low: '提示',
};

export function formatRefinementIssueSeverity(severity: RefinementIssue['severity']): string {
  return ISSUE_SEVERITY_LABELS[severity] ?? severity;
}

export function formatRefinementRewritePolicyLabel(policy: RefinementRewritePolicy): string {
  return policy === 'scene-rewrite' ? '场内创编' : '保留剧情';
}

/** 存储模式必须显式展示，避免把进程内 Map 误当成持久化。 */
export function formatRefinementStorageModeLabel(mode: RefinementStorageMode): string {
  return mode === 'postgres' ? 'PostgreSQL 持久化' : '内存模式（服务重启后丢失）';
}

/** 阶段在整条链路中的粗粒度进度权重，仅在无单位进度时兜底。 */
const PHASE_PROGRESS_WEIGHT: Record<RefinementPhase, number> = {
  reading: 10,
  planning: 30,
  rewriting: 60,
  repairing: 80,
  verifying: 95,
  finished: 100,
};

export function resolveRefinementProgressPercent(
  progress: RefinementProgress,
  status: RefinementStatus,
  phase: RefinementPhase
): number {
  if (isRefinementCandidateReady(status)) {
    return 100;
  }
  if (progress.unitTotal > 0) {
    const ratio = Math.min(1, Math.max(0, progress.unitIndex / progress.unitTotal));
    return Math.min(99, Math.round(ratio * 100));
  }
  return PHASE_PROGRESS_WEIGHT[phase] ?? 0;
}

export function formatRefinementProgressText(progress: RefinementProgress): string {
  if (progress.unitTotal > 0) {
    return `第 ${progress.unitIndex} / ${progress.unitTotal} 个范围`;
  }
  return '';
}

export function formatRefinementUsage(usage: RefinementUsage): string {
  const elapsedSeconds = Math.round(usage.activeElapsedMs / 1000);
  const accounting =
    usage.tokenAccounting === 'actual'
      ? '实测用量'
      : usage.tokenAccounting === 'estimated'
        ? '估算用量'
        : usage.tokenAccounting === 'mixed'
          ? '部分估算'
          : '用量不可用';
  return `调用 ${usage.callCount} 次 · 活跃 ${elapsedSeconds}s · ${accounting}`;
}

export function formatRefinementCoverage(coverage: RefinementCoverage): string {
  const unprocessed = Math.max(0, coverage.sourceChars - coverage.processedChars);
  return `原文 ${coverage.sourceChars} 字 · 已处理 ${coverage.processedChars} 字 · 保留原文 ${coverage.retainedOriginalChars} 字 · 未处理 ${unprocessed} 字`;
}

/** 时间展示：与列表同口径的本地时间，避免暴露 ISO 原文。 */
export function formatRefinementTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleString();
}

/**
 * 关闭弹窗再打开时挑选要恢复的 run：
 * 优先进行中的 run（可继续观察），否则取最近一次终态 run（可查看候选）。
 */
export function resolveRefinementResumeRun(
  runs: readonly RefinementRunSummary[]
): RefinementRunSummary | null {
  if (runs.length === 0) {
    return null;
  }
  const active = runs.find((run) => isRefinementActive(run.status));
  if (active) {
    return active;
  }
  return runs[0] ?? null;
}

export function createRefinementClientRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `refine-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * W2：精修启动的幂等键生命周期。
 *
 * - `begin()`：一次逻辑运行开始时取用当前 key；上一个 key 已被成功创建「消耗」后，分配新 key。
 * - `commit()`：创建 run 成功后调用，标记当前 key 已消耗——下一次 `begin()` 一定是新的逻辑运行，
 *   避免「ready 后再次启动」复用旧 key 命中旧 run 或产生 409。
 * - `reset()`：显式重置（关闭面板 / 切换章节），立即分配新 key。
 *
 * 同一次创建请求的失败重试（含响应丢失）不调用 `commit()`，因此保留同一 key，服务端幂等返回同一 run。
 */
export interface RefinementStartRequestIdTracker {
  begin(): string;
  commit(): void;
  reset(): void;
}

export function createRefinementStartRequestIdTracker(
  factory: () => string = createRefinementClientRequestId
): RefinementStartRequestIdTracker {
  let current = factory();
  let consumed = false;
  return {
    begin(): string {
      if (consumed) {
        current = factory();
        consumed = false;
      }
      return current;
    },
    commit(): void {
      consumed = true;
    },
    reset(): void {
      current = factory();
      consumed = false;
    },
  };
}

// ── 运行操作（取消 / 继续 / 放弃，5.1） ────────────────────────────────

/** 取消：仅进行中的 run 可取消；已停止时取消幂等，但前端不再展示按钮。 */
export function canCancelRefinementRun(run: RefinementRunSummary | null): boolean {
  return Boolean(run && isRefinementActive(run.status));
}

/** 继续：仅可恢复的暂停态可继续（原文变更 / 权限撤销时 resumable=false）。 */
export function canResumeRefinementRun(run: RefinementRunSummary | null): boolean {
  return Boolean(run && run.status === 'paused' && run.resumable);
}

/** 放弃：任意非「已放弃 / 已过期」状态都可放弃（含进行中与已就绪）。 */
export function canDiscardRefinementRun(run: RefinementRunSummary | null): boolean {
  if (!run) {
    return false;
  }
  return run.status !== 'discarded' && run.status !== 'expired';
}

/**
 * 暂停提示文案：区分「可继续」「服务重启等待作者继续」「不可继续需新建」。
 * 内存模式不承诺重启恢复（R10）。
 */
export function describeRefinementPauseState(
  run: Pick<RefinementRunSummary, 'status' | 'resumable' | 'pauseReason' | 'storageMode'>
): string {
  if (run.status !== 'paused') {
    return '';
  }
  if (run.resumable) {
    if (run.pauseReason === 'process_restart') {
      return run.storageMode === 'memory'
        ? '服务已重启：内存模式无法恢复本次运行，请重新开始。'
        : '服务已重启，已保留进度，可点击继续。';
    }
    return '运行已暂停并保留当前成果，可点击继续。';
  }
  return '本次运行不可继续（原文已变更、权限撤销或存在未解决的边界冲突），请新建精修。';
}

// ── 运行关联信息（6.1：runId / attemptId / trace_id / 模板版本） ─────────

/** 冻结模板版本的单行展示：key + version + hash 前缀（便于人工比对，不暴露完整 hash）。 */
export function formatRefinementTemplateVersion(ref: RefinementTemplateVersionRef): string {
  const hash = typeof ref.hash === 'string' ? ref.hash.slice(0, 8) : '';
  return `${ref.key} v${ref.version}${hash ? ` (${hash})` : ''}`;
}

export interface RefinementRunCorrelation {
  runId: string;
  attemptId: string;
  creationTraceId: string;
  templateVersions: string[];
}

/**
 * 把一次 run 的可追溯标识汇总成展示模型：runId、当前 attemptId、创建时的 HTTP trace id
 * 与冻结的模板版本。缺失项以占位文案呈现，避免运行历史里出现空白。
 */
export function buildRefinementRunCorrelation(
  run: RefinementRunView | null
): RefinementRunCorrelation {
  if (!run) {
    return { runId: '', attemptId: '', creationTraceId: '', templateVersions: [] };
  }
  return {
    runId: run.runId,
    attemptId: run.attemptId ?? '无进行中的尝试',
    creationTraceId: run.creationTraceId ?? '未记录',
    templateVersions: (run.frozenTemplateVersions ?? []).map(formatRefinementTemplateVersion),
  };
}

// ── 入口保护（6.1：未保存章节改动不得被旧正文静默覆盖） ──────────────────

export interface OptimizeEntryGuard {
  /** 是否需要先处理未保存改动；false 时调用方直接继续。 */
  blocked: boolean;
  title: string;
  content: string;
  okText: string;
  cancelText: string;
}

/**
 * 打开文笔优化 / 智能精修前的守卫文案：编辑器存在未保存改动时，要求作者「先保存并继续」
 * 或「返回编辑器」，避免用已保存的旧正文发起精修、之后又丢弃未保存内容。
 */
export function resolveOptimizeEntryGuard(input: {
  chapterNo: number | null;
  hasPendingEdit: boolean;
}): OptimizeEntryGuard {
  if (!input.hasPendingEdit) {
    return { blocked: false, title: '', content: '', okText: '', cancelText: '' };
  }
  const label = typeof input.chapterNo === 'number' ? `第 ${input.chapterNo} 章` : '当前章节';
  return {
    blocked: true,
    title: '检测到未保存的章节改动',
    content: `${label}在编辑器中仍有未保存的改动。智能精修与文笔优化都基于已保存正文；请先保存后再继续，或返回编辑器处理，避免未保存内容被旧正文覆盖。`,
    okText: '先保存并继续',
    cancelText: '返回编辑器',
  };
}

// ── 应用（复用旧 apply 入口） ─────────────────────────────────────────

export interface RefinementApplyPayload {
  draftText: string;
  expectedChapterUpdatedAt: string;
  planId: string;
  preserveSummary: true;
}

/**
 * 应用请求构造：冻结版本锁（baseUpdatedAt）+ planId=runId + 保留摘要，
 * 与后端 `buildRefinementApplyPayload` 语义一致，复用旧 apply 入口。
 */
export function buildRefinementApplyPayload(input: {
  runId: string;
  baseUpdatedAt: string;
  draftText: string;
}): RefinementApplyPayload {
  return {
    draftText: input.draftText,
    expectedChapterUpdatedAt: input.baseUpdatedAt,
    planId: input.runId,
    preserveSummary: true,
  };
}

export interface RefinementApplyGate {
  canApply: boolean;
  reason: string;
}

/**
 * 应用门禁：候选可对比、整章已全部处理、且与冻结原文不同才开放应用。
 * 尾部未处理或候选与原文一致时只读展示，避免误覆盖。
 * 暂停（paused）不属于候选就绪状态，明确禁止应用并提示需先继续（R11）。
 */
export function resolveRefinementApplyGate(run: RefinementRunView | null): RefinementApplyGate {
  if (!run) {
    return { canApply: false, reason: '尚未选择精修运行' };
  }
  if (isRefinementActive(run.status)) {
    return { canApply: false, reason: '精修仍在进行，完成后可应用' };
  }
  if (run.status === 'paused') {
    return { canApply: false, reason: '精修已暂停，需继续完成后才能应用' };
  }
  if (!isRefinementCandidateReady(run.status)) {
    return { canApply: false, reason: '当前运行没有可应用的候选' };
  }
  if (!run.acceptedDraftText.trim()) {
    return { canApply: false, reason: '候选为空，无法应用' };
  }
  if (run.coverage.processedChars < run.coverage.sourceChars) {
    return { canApply: false, reason: '本章尚未全部处理，暂不开放应用' };
  }
  if (run.acceptedDraftText === run.baseText) {
    return { canApply: false, reason: '候选与冻结原文一致，无需应用' };
  }
  // B1/R11：账本里仍存在未解决的高/中危阻断时，即使状态是终态也不可应用。
  // 引擎会在终态判定中暂停这类候选，这里对既有 / 历史运行视图做同口径兜底。
  const unresolvedBlocking = (run.issues ?? []).filter(
    (issue) =>
      issue.disposition === 'unresolved' &&
      (issue.severity === 'high' || issue.severity === 'medium')
  );
  if (unresolvedBlocking.length > 0) {
    return { canApply: false, reason: '候选仍存在未解决的阻断问题，不可应用' };
  }
  return { canApply: true, reason: '' };
}

export interface RefinementApplyConfirmCopy {
  title: string;
  content: string;
  okText: string;
  /** ready_with_issues：存在未解决问题或保留原文，需要作者逐条阅读后再确认（R11） */
  requiresIssueAcknowledgement: boolean;
}

/**
 * 应用确认文案（R11）：普通 ready 只做常规确认；ready_with_issues 必须显式列出
 * 未解决问题数与保留原文字数，要求作者逐条阅读后再确认，避免把含问题的候选
 * 当成干净成稿一键覆盖。
 */
export function buildRefinementApplyConfirmCopy(input: {
  chapterNo: number | null;
  run: RefinementRunView | null;
}): RefinementApplyConfirmCopy {
  const chapterLabel =
    typeof input.chapterNo === 'number' ? `第 ${input.chapterNo} 章` : '当前章节';
  const run = input.run;
  const unresolvedCount = (run?.issues ?? []).filter(
    (issue) => issue.disposition === 'unresolved' || issue.disposition === 'retained_original'
  ).length;
  const retainedChars = run?.coverage.retainedOriginalChars ?? 0;
  const hasIssues = run?.status === 'ready_with_issues' || unresolvedCount > 0 || retainedChars > 0;

  if (hasIssues) {
    return {
      title: '应用智能精修正文（含提示）',
      content: `${chapterLabel}候选仍有 ${unresolvedCount} 条未解决问题、${retainedChars} 字保留原文；应用将用候选稿覆盖正文并保留现有摘要，请确认已逐条阅读上述问题。是否继续？`,
      okText: '我已阅读问题，确认应用',
      requiresIssueAcknowledgement: true,
    };
  }
  return {
    title: '应用智能精修正文',
    content: `将用候选稿覆盖${chapterLabel}正文，并保留现有摘要。是否继续？`,
    okText: '确认应用',
    requiresIssueAcknowledgement: false,
  };
}

// ── SSE 事件 ──────────────────────────────────────────────────────────

export interface RefinementStreamEventBase {
  event: 'snapshot' | 'stage' | 'paused' | 'finished' | 'error';
  runId: string;
  revision: number;
  attemptId: string | null;
  seq: number;
}

export interface RefinementSnapshotEvent extends RefinementStreamEventBase {
  event: 'snapshot';
  run: RefinementRunView;
}

export interface RefinementStageEvent extends RefinementStreamEventBase {
  event: 'stage';
  phase: RefinementPhase;
  unitIndex: number;
  unitTotal: number;
  sceneId?: string;
  message: string;
}

/** 可恢复的停止：只带摘要，候选正文需回表拉权威 view。 */
export interface RefinementPausedEvent extends RefinementStreamEventBase {
  event: 'paused';
  run: RefinementRunSummary;
}

export interface RefinementFinishedEvent extends RefinementStreamEventBase {
  event: 'finished';
  run: RefinementRunSummary;
}

export interface RefinementErrorEvent extends RefinementStreamEventBase {
  event: 'error';
  message: string;
}

export type RefinementStreamEvent =
  | RefinementSnapshotEvent
  | RefinementStageEvent
  | RefinementPausedEvent
  | RefinementFinishedEvent
  | RefinementErrorEvent;

const REFINEMENT_EVENT_NAMES = new Set<RefinementStreamEvent['event']>([
  'snapshot',
  'stage',
  'paused',
  'finished',
  'error',
]);

/**
 * 解析单条 SSE data。未知事件名或缺失 runId 时返回 null，交由调用方忽略，
 * 保证后续任务新增事件（content / issue）不会打断当前客户端。
 */
export function parseRefinementStreamEvent(dataPart: string): RefinementStreamEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(dataPart);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const event = record.event;
  if (
    typeof event !== 'string' ||
    !REFINEMENT_EVENT_NAMES.has(event as RefinementStreamEvent['event'])
  ) {
    return null;
  }
  if (typeof record.runId !== 'string' || !record.runId) {
    return null;
  }

  const base: RefinementStreamEventBase = {
    event: event as RefinementStreamEvent['event'],
    runId: record.runId,
    revision: typeof record.revision === 'number' ? record.revision : 0,
    attemptId: typeof record.attemptId === 'string' ? record.attemptId : null,
    seq: typeof record.seq === 'number' ? record.seq : 0,
  };

  switch (base.event) {
    case 'snapshot':
      return record.run && typeof record.run === 'object'
        ? { ...base, event: 'snapshot', run: record.run as RefinementRunView }
        : null;
    case 'stage':
      return {
        ...base,
        event: 'stage',
        phase: (record.phase as RefinementPhase) ?? 'reading',
        unitIndex: typeof record.unitIndex === 'number' ? record.unitIndex : 0,
        unitTotal: typeof record.unitTotal === 'number' ? record.unitTotal : 0,
        ...(typeof record.sceneId === 'string' ? { sceneId: record.sceneId } : {}),
        message: typeof record.message === 'string' ? record.message : '',
      };
    case 'paused':
      return record.run && typeof record.run === 'object'
        ? { ...base, event: 'paused', run: record.run as RefinementRunSummary }
        : null;
    case 'finished':
      return record.run && typeof record.run === 'object'
        ? { ...base, event: 'finished', run: record.run as RefinementRunSummary }
        : null;
    case 'error':
      return {
        ...base,
        event: 'error',
        message: typeof record.message === 'string' ? record.message : '智能精修执行失败',
      };
  }
}
