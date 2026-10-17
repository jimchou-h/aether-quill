/**
 * 章节精修编排（AQ-380）—— 共享类型、策略常量与纯函数。
 *
 * 本文件不依赖 Nest，便于单测；HTTP 映射与副作用留在 service / controller。
 * 设计见 openspec/changes/add-chapter-refinement-orchestration/design.md。
 */

import { createHash } from 'node:crypto';

import type {
  RefinementFact,
  RefinementReplacement,
  RefinementWindowInspection,
  RefinementWriteUnit,
} from './chapter-refinement.util';

export const REFINEMENT_MAX_SOURCE_CHARS = 30000;
export const REFINEMENT_MAX_INSTRUCTION_CHARS = 20000;

export const REFINEMENT_DIAGNOSIS_TARGET_MIN = 2000;
export const REFINEMENT_DIAGNOSIS_TARGET_MAX = 5000;
/** 项目分段设置为 0 时新入口使用的自动诊断窗目标 */
export const REFINEMENT_DIAGNOSIS_TARGET_AUTO = 3000;

export const REFINEMENT_REWRITE_TARGET_CHARS = 3500;
export const REFINEMENT_REWRITE_MAX_CHARS = 5200;
export const REFINEMENT_MAX_REPAIR_PASSES = 1;
export const REFINEMENT_MAX_CALLS_PER_ATTEMPT = 80;
export const REFINEMENT_MAX_ACTIVE_MS_PER_ATTEMPT = 30 * 60 * 1000;

/** 终态（ready / ready_with_issues / failed）与 paused 的保留时长 */
export const REFINEMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type RefinementStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'ready'
  | 'ready_with_issues'
  | 'failed'
  | 'discarded'
  | 'expired';

export type RefinementPhase =
  | 'reading'
  | 'planning'
  | 'rewriting'
  | 'repairing'
  | 'verifying'
  | 'finished';

export type RefinementPauseReason =
  | 'user_cancelled'
  | 'budget_exhausted'
  | 'upstream_failure'
  | 'process_restart'
  | 'context_budget'
  | 'invalid_model_output'
  | 'boundary_conflict'
  | 'permission_revoked'
  | 'source_changed'
  /** F1：进度持久化失败——无法确认 checkpoint 落库时明确停止，不再继续声称可恢复 */
  | 'persistence_failed';

export type RefinementRewritePolicy = 'preserve-plot' | 'scene-rewrite';
export type RefinementStorageMode = 'postgres' | 'memory';
export type RefinementTokenAccounting = 'actual' | 'estimated' | 'mixed' | 'unavailable';

/** 活动（未终结）状态：单活动 run 与 TTL 保护都只看这两个 */
export const REFINEMENT_ACTIVE_STATUSES: readonly RefinementStatus[] = ['queued', 'running'];

export function isRefinementActiveStatus(status: RefinementStatus): boolean {
  return REFINEMENT_ACTIVE_STATUSES.includes(status);
}

export function isRefinementTerminalStatus(status: RefinementStatus): boolean {
  return (
    status === 'ready' ||
    status === 'ready_with_issues' ||
    status === 'failed' ||
    status === 'discarded' ||
    status === 'expired'
  );
}

/** 5.1：paused 且未被标记为不可恢复时才允许 resume（R8/design D10）。 */
export function isRefinementResumable(record: {
  status: RefinementStatus;
  resumable: boolean;
}): boolean {
  return record.status === 'paused' && record.resumable;
}

export interface RefinementResolvedPolicy {
  diagnosisTargetChars: number;
  normalizationReason?: string;
  rewriteTargetChars: number;
  rewriteMaxChars: number;
  maxRepairPasses: number;
  maxCallsPerAttempt: number;
  maxActiveMsPerAttempt: number;
}

export interface RefinementProgress {
  unitIndex: number;
  unitTotal: number;
  sceneId?: string;
  message: string;
}

export interface RefinementUsage {
  callCount: number;
  activeElapsedMs: number;
  inputTokens?: number;
  outputTokens?: number;
  tokenAccounting: RefinementTokenAccounting;
}

export interface RefinementChange {
  sceneId: string;
  startOffset: number;
  endOffset: number;
  summary: string;
}

export interface RefinementIssue {
  id: string;
  category: 'hard_constraint' | 'continuity' | 'style' | 'coverage';
  severity: 'high' | 'medium' | 'low';
  sceneId?: string;
  unitId?: string;
  candidateRevision?: number;
  anchorQuote?: string;
  message: string;
  disposition: 'resolved' | 'retained_original' | 'warning' | 'unresolved';
}

export interface RefinementCoverage {
  sourceChars: number;
  plannedChars: number;
  processedChars: number;
  retainedOriginalChars: number;
}

export interface RefinementRunSummary {
  runId: string;
  projectId: string;
  chapterNo: number;
  status: RefinementStatus;
  phase: RefinementPhase;
  revision: number;
  attemptId: string | null;
  baseUpdatedAt: string;
  baseHash: string;
  rewritePolicy: RefinementRewritePolicy;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  pauseReason?: RefinementPauseReason;
  resumable: boolean;
  storageMode: RefinementStorageMode;
  progress: RefinementProgress;
  resolvedPolicy: RefinementResolvedPolicy;
  usage: RefinementUsage;
  /** 6.1：创建该 run 的 HTTP trace id（`x-trace-id` 或自动生成），用于运行追溯；不含凭据 */
  creationTraceId: string | null;
}

export interface RefinementRunView extends RefinementRunSummary {
  instruction: string;
  baseText: string;
  acceptedDraftText: string;
  chapterBrief: string | null;
  changes: RefinementChange[];
  issues: RefinementIssue[];
  coverage: RefinementCoverage;
  sourceCurrent: boolean;
  /** 6.1：创建时冻结的模板版本，用于运行追溯；墓碑后清空 */
  frozenTemplateVersions: RefinementTemplateVersionRef[];
}

export interface RefinementTemplateVersionRef {
  key: string;
  version: number;
  hash: string;
}

export interface RefinementModelRoute {
  tier: 'writing' | 'utility';
  provider: string;
  model: string;
  temperature: number;
}

/**
 * F4：run 创建时冻结的「实际参考材料」。
 *
 * 冻结面不仅包含 prompt 文本与模型路由，还必须包含真正注入生成的实际参考文本及来源
 * （人物卡、知识摘录、文风样本）。运行中修改角色卡 / 知识文档 / 样本不得改变本 run 的指导，
 * 续跑复用同一份冻结材料。
 */
export interface RefinementReferenceMaterial {
  kind: 'persona' | 'knowledge' | 'style';
  id: string;
  title: string;
  text: string;
  /** C4：文风样本来源章节号（用于排除当前章自身样本） */
  sourceChapterNo?: number;
  /** C4：文风样本场景类型（保留来源与分类） */
  sceneType?: string;
}

export interface RefinementFrozenReferenceMaterials {
  /** 冻结材料清单（文本 + 来源），用于追溯与预算 */
  materials: RefinementReferenceMaterial[];
  /** 拼进最终消息的完整冻结参考块 */
  promptText: string;
  /** 冻结人物上下文块（【参考上下文】） */
  personaText: string;
  /** 冻结知识 / 检索证据块（【检索证据】） */
  knowledgeText: string;
  /** 冻结文风样本块（【文风参照】） */
  styleSampleBlock: string;
  frozenAt: string;
}

/** 创建 run 时冻结的材料；不含密钥。 */
export interface RefinementSnapshot {
  instruction: string;
  baseTitle: string;
  baseText: string;
  systemPromptText: string;
  templateVersions: RefinementTemplateVersionRef[];
  modelRoute: RefinementModelRoute | null;
  /** AQ-381：按 templateKey 冻结的 system prompt 文本，运行中不受 Settings 改动影响 */
  templateTexts?: Record<string, string>;
  /** AQ-381：按档位冻结的模型路由标识（writing / utility），只存标识不存密钥 */
  modelRoutes?: Record<string, RefinementModelRoute>;
  /** 6.1：创建 run 时的 HTTP trace id，用于运行追溯；不含凭据 */
  creationTraceId?: string | null;
  /** F4：run 创建时冻结的实际参考材料（人物 / 知识 / 文风样本），续跑复用 */
  referenceMaterials?: RefinementFrozenReferenceMaterials | null;
  resolvedPolicy: RefinementResolvedPolicy;
  frozenAt: string;
}

export interface RefinementAcceptedRange {
  startOffset: number;
  endOffset: number;
  text: string;
  sceneId?: string;
}

/** AQ-383：plan 合同恢复计数；自动恢复 / resume 不重置已消耗名额。 */
export interface RefinementPlanRecoveryState {
  /** 已消耗的确定性证据回填次数 */
  backfillCount: number;
  /** 已消耗的额外 plan 调用次数（与网络/解析/schema/截断重试共用同一名额） */
  extraPlanCalls: number;
  /** 因合同无法验证而降级为 keep 的场景 id */
  degradedSceneIds: string[];
  /** 截断扩容重试实际采用的必要输出 token（仅 trace 观测用；未发生扩容时不写入） */
  expandedPlanTokens?: number;
}

/**
 * 4.1：单位补修与接缝修复计数；resume / 自动恢复不重置已消耗名额（R8）。
 * 没有这些计数，继续运行会重复补修同一单位造成无限循环。
 */
export interface RefinementUnitRecoveryState {
  /** 已消耗的单位补修次数（含被拒绝的尝试，避免无限重试） */
  repairCount: number;
  /** 已补修过的单位 id，防止 resume 后对同一单位再补修 */
  repairedUnitIds: string[];
  /** 已消耗的最终接缝定位修复轮次 */
  seamRepairCount: number;
}

export function createInitialRefinementUnitRecovery(): RefinementUnitRecoveryState {
  return { repairCount: 0, repairedUnitIds: [], seamRepairCount: 0 };
}

/**
 * 5.1：可续跑计划快照。
 *
 * resume 不能重跑已接受单位（R8/design D10），因此把「整章意图 + 写作单位计划 + 已接受替换」
 * 随 checkpoint 一并持久化；恢复时按已处理前缀跳过，从下一个未完成单位继续。
 * 单位不重复存储 `text`（可由 baseText + 偏移还原），避免 checkpoint 体积翻倍。
 */
export type RefinementResumeUnit = Omit<RefinementWriteUnit, 'text'>;

/**
 * F5：有证据的散场状态事实。
 *
 * review 报出的 `exitStateFacts` 必须能在当前候选正文或允许的冻结原文中逐字命中才被接受；
 * 命中候选记为 `candidate`，命中原文（尚未改写范围）记为 `original`。无法命中的「凭空状态」
 * 一律拒绝并记问题，未知（value=null）不视为确定状态。所有已确认状态随 checkpoint 持久化，
 * 供后续单位读取。
 */
export interface RefinementStateFact {
  key: string;
  value: string;
  /** 产出该状态的单位 id */
  unitId: string;
  /** 证据来源：改写后候选正文 或 冻结原文 */
  origin: 'candidate' | 'original';
  anchorQuote: string;
  /**
   * B2：证据所属候选版本。修复 / 补修 / 回退会改变单位候选，旧版本的证据随之失效，
   * 必须等复检产生新证据才能再向下游传递。缺失（旧 checkpoint）按不确定处理，不传播。
   */
  candidateRevision?: number;
  /** B2：证据所属候选正文 hash，与版本号共同锁定「同一份候选」 */
  candidateHash?: string;
  /** B2：程序在候选中定位到的末态锚点唯一位置（UTF-16 偏移，前闭后开） */
  anchorStart?: number;
  anchorEnd?: number;
  /** B2：依据类型——范围末尾明确确认，还是该状态在范围内的最后一次相关变化 */
  basis?: 'exit_confirmation' | 'last_change';
  /** B2：所属场景 id */
  sceneId?: string;
}

/**
 * F1：诊断阶段的可恢复状态。
 *
 * 诊断（inspect）是逐窗模型调用，取消 / 进程重启若丢掉已完成窗口，恢复时必须重跑全部诊断，
 * 既浪费调用预算也与 R8「复用已完成诊断」不符。这里把已验证的窗口诊断结果与完成位置随
 * checkpoint 持久化，恢复时跳过已完成窗口。
 */
export interface RefinementDiagnosisState {
  /** 已完成的诊断窗口数量（= inspections.length） */
  completedWindows: number;
  /** 已验证的窗口诊断结果（windowId 以程序规划为准） */
  inspections: RefinementWindowInspection[];
}

export interface RefinementResumeState {
  chapterIntent: string;
  protectedFacts: RefinementFact[];
  units: RefinementResumeUnit[];
  unsplittableSceneIds: string[];
  scenesWithoutBrief: string[];
  /** 已完全处理的单位数量（前缀），即下一个待执行单位下标 */
  nextUnitIndex: number;
  /** 已接受的替换（仅 patch/rewrite 单位） */
  replacements: RefinementReplacement[];
  degradedUnitCount: number;
  /** F3：已完成「必要 review」的单位 id 清单（检查未完成必须暂停，不得写入） */
  reviewedUnitIds: string[];
  /** F5：已确认的全部散场状态事实，供后续单位读取 */
  stateFacts: RefinementStateFact[];
  /** F3：整章最终检查是否已完成（含全部分组） */
  finalCheckCompleted: boolean;
  /** F3：整章最终检查覆盖到的范围单位 id（覆盖完成记录） */
  finalCheckCoveredUnitIds: string[];
}

/** 可恢复游标 + 已接受成果；流式临时正文不写入这里。 */
export interface RefinementCheckpoint {
  acceptedDraftText: string;
  acceptedRanges: RefinementAcceptedRange[];
  changes: RefinementChange[];
  issues: RefinementIssue[];
  coverage: RefinementCoverage;
  chapterBrief: string | null;
  progress: RefinementProgress;
  usage: RefinementUsage;
  cursor: number;
  /** AQ-383：plan 合同恢复计数（可选，旧记录缺省视为未消耗） */
  planRecovery?: RefinementPlanRecoveryState;
  /** 4.1：单位补修 / 接缝修复计数（可选，旧记录缺省视为未消耗） */
  unitRecovery?: RefinementUnitRecoveryState;
  /** 5.1：可续跑计划快照（可选，未进入写作单位阶段前为空） */
  resumeState?: RefinementResumeState | null;
  /** F1：诊断阶段的可恢复结果与位置（可选，诊断未完成时为部分结果） */
  diagnosis?: RefinementDiagnosisState | null;
}

export interface RefinementRunRecord {
  runId: string;
  projectId: string;
  chapterNo: number;
  creatorId: string;
  clientRequestId: string;
  payloadHash: string;
  status: RefinementStatus;
  phase: RefinementPhase;
  revision: number;
  attemptId: string | null;
  pauseReason: RefinementPauseReason | null;
  resumable: boolean;
  baseUpdatedAt: string;
  baseHash: string;
  rewritePolicy: RefinementRewritePolicy;
  snapshot: RefinementSnapshot;
  checkpoint: RefinementCheckpoint;
  tombstone: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface RefinementCreateInput {
  clientRequestId: string;
  expectedChapterUpdatedAt: string;
  instruction: string;
  rewritePolicy?: RefinementRewritePolicy;
  diagnosisTargetChars?: number;
}

/** 5.1：取消当前执行尝试；expectedAttemptId 与观察到的尝试不一致时拒绝，避免误取消续跑。 */
export interface RefinementCancelInput {
  expectedAttemptId?: string | null;
}

/** 5.1：从 checkpoint 继续；expectedRunRevision 做 CAS。 */
export interface RefinementResumeInput {
  expectedRunRevision: number;
}

/** 5.1：放弃运行并清理候选材料；已 discarded 时幂等返回。 */
export interface RefinementDiscardInput {
  expectedRunRevision: number;
}

// ── 纯函数 ────────────────────────────────────────────────────────────

export class RefinementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefinementValidationError';
  }
}

export function assertRefinementInstruction(raw: unknown): string {
  const instruction = typeof raw === 'string' ? raw.trim() : '';
  if (!instruction) {
    throw new RefinementValidationError('instruction 不能为空');
  }
  if (instruction.length > REFINEMENT_MAX_INSTRUCTION_CHARS) {
    throw new RefinementValidationError(
      `instruction 超出上限 ${REFINEMENT_MAX_INSTRUCTION_CHARS} 字`
    );
  }
  return instruction;
}

export function assertRefinementSourceText(raw: string | undefined | null): string {
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) {
    throw new RefinementValidationError('章节正文为空，无法发起智能精修');
  }
  if (text.length > REFINEMENT_MAX_SOURCE_CHARS) {
    throw new RefinementValidationError(
      `章节正文 ${text.length} 字，超出当前支持上限 ${REFINEMENT_MAX_SOURCE_CHARS} 字`
    );
  }
  return text;
}

/**
 * 诊断窗目标解析：显式入参优先，其次项目分段设置（规范到 2000..5000），
 * 项目设置为 0 时使用自动值 3000。旧设置不被改写。
 */
export function resolveRefinementDiagnosisTarget(input: {
  requested?: unknown;
  projectSegmentCharSize?: number;
}): { value: number; reason: string } {
  const requested = input.requested;
  if (requested !== undefined && requested !== null) {
    if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
      throw new RefinementValidationError('diagnosisTargetChars 必须为 2000~5000 的整数');
    }
    const rounded = Math.round(requested);
    if (rounded < REFINEMENT_DIAGNOSIS_TARGET_MIN || rounded > REFINEMENT_DIAGNOSIS_TARGET_MAX) {
      throw new RefinementValidationError('diagnosisTargetChars 必须为 2000~5000 的整数');
    }
    return { value: rounded, reason: 'explicit_request' };
  }

  const projectValue =
    typeof input.projectSegmentCharSize === 'number' &&
    Number.isFinite(input.projectSegmentCharSize)
      ? input.projectSegmentCharSize
      : 0;
  if (projectValue > 0) {
    const clamped = Math.min(
      REFINEMENT_DIAGNOSIS_TARGET_MAX,
      Math.max(REFINEMENT_DIAGNOSIS_TARGET_MIN, Math.round(projectValue))
    );
    return {
      value: clamped,
      reason:
        clamped === Math.round(projectValue)
          ? 'project_segmentation_setting'
          : 'project_segmentation_setting_normalized',
    };
  }
  return { value: REFINEMENT_DIAGNOSIS_TARGET_AUTO, reason: 'automatic_target' };
}

export function resolveRefinementPolicy(input: {
  requested?: unknown;
  projectSegmentCharSize?: number;
}): RefinementResolvedPolicy {
  const diagnosis = resolveRefinementDiagnosisTarget(input);
  return {
    diagnosisTargetChars: diagnosis.value,
    normalizationReason: diagnosis.reason,
    rewriteTargetChars: REFINEMENT_REWRITE_TARGET_CHARS,
    rewriteMaxChars: REFINEMENT_REWRITE_MAX_CHARS,
    maxRepairPasses: REFINEMENT_MAX_REPAIR_PASSES,
    maxCallsPerAttempt: REFINEMENT_MAX_CALLS_PER_ATTEMPT,
    maxActiveMsPerAttempt: REFINEMENT_MAX_ACTIVE_MS_PER_ATTEMPT,
  };
}

export function normalizeRefinementRewritePolicy(raw: unknown): RefinementRewritePolicy {
  if (raw === undefined || raw === null) {
    return 'preserve-plot';
  }
  if (raw === 'preserve-plot' || raw === 'scene-rewrite') {
    return raw;
  }
  throw new RefinementValidationError('rewritePolicy 仅支持 preserve-plot / scene-rewrite');
}

/** 幂等比较用的 payload 指纹：只覆盖用户可见的创建入参。 */
export function computeRefinementPayloadHash(input: {
  expectedChapterUpdatedAt: string;
  instruction: string;
  rewritePolicy: RefinementRewritePolicy;
  diagnosisTargetChars?: number;
}): string {
  const canonical = JSON.stringify({
    expectedChapterUpdatedAt: input.expectedChapterUpdatedAt,
    instruction: input.instruction,
    rewritePolicy: input.rewritePolicy,
    diagnosisTargetChars: input.diagnosisTargetChars ?? null,
  });
  // 复用章节内容哈希实现，避免再引入哈希依赖
  return createHash('sha256').update(canonical).digest('hex');
}

export function computeRefinementExpiresAt(status: RefinementStatus, from: Date): string {
  // queued/running 不参与 TTL 删除，给一个远期占位，避免被清理任务误删
  if (isRefinementActiveStatus(status)) {
    return new Date(from.getTime() + REFINEMENT_TTL_MS * 100).toISOString();
  }
  return new Date(from.getTime() + REFINEMENT_TTL_MS).toISOString();
}

export function buildRefinementRunSummary(
  record: RefinementRunRecord,
  storageMode: RefinementStorageMode
): RefinementRunSummary {
  const summary: RefinementRunSummary = {
    runId: record.runId,
    projectId: record.projectId,
    chapterNo: record.chapterNo,
    status: record.status,
    phase: record.phase,
    revision: record.revision,
    attemptId: record.attemptId,
    baseUpdatedAt: record.baseUpdatedAt,
    baseHash: record.baseHash,
    rewritePolicy: record.rewritePolicy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    resumable: record.resumable,
    storageMode,
    progress: record.checkpoint.progress,
    resolvedPolicy: record.snapshot.resolvedPolicy,
    usage: record.checkpoint.usage,
    creationTraceId: record.snapshot.creationTraceId ?? null,
  };
  if (record.pauseReason) {
    summary.pauseReason = record.pauseReason;
  }
  return summary;
}

export function buildRefinementRunView(
  record: RefinementRunRecord,
  storageMode: RefinementStorageMode,
  sourceCurrent: boolean
): RefinementRunView {
  return {
    ...buildRefinementRunSummary(record, storageMode),
    instruction: record.snapshot.instruction,
    baseText: record.snapshot.baseText,
    acceptedDraftText: record.checkpoint.acceptedDraftText,
    chapterBrief: record.checkpoint.chapterBrief,
    changes: record.checkpoint.changes,
    issues: record.checkpoint.issues,
    coverage: record.checkpoint.coverage,
    sourceCurrent,
    frozenTemplateVersions: record.snapshot.templateVersions ?? [],
  };
}

export function createInitialRefinementCheckpoint(baseText: string): RefinementCheckpoint {
  return {
    acceptedDraftText: baseText,
    acceptedRanges: [],
    changes: [],
    issues: [],
    coverage: {
      sourceChars: baseText.length,
      plannedChars: baseText.length,
      processedChars: 0,
      retainedOriginalChars: baseText.length,
    },
    chapterBrief: null,
    progress: { unitIndex: 0, unitTotal: 0, message: '已冻结原文，等待开始' },
    usage: { callCount: 0, activeElapsedMs: 0, tokenAccounting: 'unavailable' },
    cursor: 0,
    resumeState: null,
  };
}

/**
 * 5.1：把 run 收敛为最小墓碑——清理冻结正文、候选稿、要求与 Prompt 材料，
 * 仅保留可构建 RunSummary 所需的最小字段（状态、进度、用量、策略）。
 *
 * 用于 discard（立即）与 TTL 到期（内容过期）。查询正文一律 410，不再可读。
 */
export function tombstoneRefinementRun(
  record: RefinementRunRecord,
  status: Extract<RefinementStatus, 'discarded' | 'expired'>,
  now: Date
): RefinementRunRecord {
  const usage = record.checkpoint.usage;
  const progress: RefinementProgress = {
    unitIndex: record.checkpoint.progress.unitIndex,
    unitTotal: record.checkpoint.progress.unitTotal,
    message: status === 'discarded' ? '候选材料已丢弃' : '候选材料已过期',
  };
  return {
    ...record,
    status,
    phase: 'finished',
    attemptId: null,
    pauseReason: null,
    resumable: false,
    revision: record.revision + 1,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REFINEMENT_TTL_MS).toISOString(),
    tombstone: true,
    // 清理冻结材料：正文、要求、模板文本与模型路由
    snapshot: {
      instruction: '',
      baseTitle: '',
      baseText: '',
      systemPromptText: '',
      templateVersions: [],
      modelRoute: null,
      templateTexts: {},
      modelRoutes: {},
      // 墓碑仍保留创建 trace，用于支持侧追溯；不含凭据
      creationTraceId: record.snapshot.creationTraceId ?? null,
      referenceMaterials: null,
      resolvedPolicy: record.snapshot.resolvedPolicy,
      frozenAt: record.snapshot.frozenAt,
    },
    // 清理候选与内部游标
    checkpoint: {
      acceptedDraftText: '',
      acceptedRanges: [],
      changes: [],
      issues: [],
      coverage: {
        sourceChars: record.checkpoint.coverage.sourceChars,
        plannedChars: 0,
        processedChars: 0,
        retainedOriginalChars: 0,
      },
      chapterBrief: null,
      progress,
      usage,
      cursor: 0,
      planRecovery: undefined,
      unitRecovery: undefined,
      resumeState: null,
      diagnosis: undefined,
    },
  };
}
