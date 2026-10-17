/**
 * 章节精修引擎。
 *
 * 引擎只接收冻结的 run 记录与观察回调，不直接触碰章节存储或 HTTP，便于替换与单测。
 *
 *  - `KeepOnlyRefinementEngine`：AQ-380 确定性基线，不调用模型，候选逐码元等于冻结原文。
 *  - `OrchestratedRefinementEngine`：AQ-382 整章顺序编排，走
 *    分窗诊断 → 跨窗场景合并 → 整章规划 → 写作单位规划 → 逐单位
 *    rewrite → 程序门禁 → review → 按原文偏移合并完整候选；
 *    有限补修与候选接受策略见任务 4.1。
 *
 * 冻结快照（模板文本 / 项目 systemPrompt / 模型路由）在 run 创建时写入，运行中不受 Settings 改动影响。
 */

import { isRefinementWritingStageTemplateKey } from '@aether-quill/config';
import {
  assembleRefinementCandidate,
  buildFinalSeamReviewUserPrompt,
  buildRefinementFactIndex,
  buildInspectUserPrompt,
  buildPlanUserPrompt,
  buildRefinementBlockIndexForRange,
  buildRefinementMergedSceneIndex,
  buildRefinementSourceBlocks,
  buildRepairUserPrompt,
  buildReviewUserPrompt,
  buildRewriteUserPrompt,
  CHAPTER_REFINEMENT_INSPECT_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_PLAN_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REPAIR_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REVIEW_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REWRITE_SYSTEM_PROMPT,
  CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS,
  deriveProtectedQuotes,
  groupRefinementRangesByBudget,
  hashRefinementCandidate,
  mergeWindowSceneFragments,
  parsePlanOutputWithRecovery,
  parseReviewResult,
  parseWindowInspection,
  planRefinementDiagnosisWindows,
  planRefinementWriteUnits,
  RefinementModelOutputError,
  REFINEMENT_PLAN_MAX_TOKENS,
  REFINEMENT_STRUCTURED_OUTPUT_TOKENS,
  resolvePlanDegradation,
  resolveRefinementCallBudget,
  resolveRefinementModelCapability,
  resolveRefinementPlanOutputTokens,
  resolveRefinementRangeMaxChars,
  runRefinementProgramGate,
  shouldTriggerRepair,
  splitReviewIssuesByLocatability,
  verifyRefinementStateFact,
  type RefinementBrief,
  type RefinementCompletionFailureKind,
  type RefinementFact,
  type RefinementPlanBackfillRecord,
  type RefinementPlanViolation,
  type RefinementReplacement,
  type RefinementReviewIssue,
  type RefinementSeamRange,
  type RefinementSourceBlock,
  type RefinementWindowInspection,
  type RefinementWriteUnit,
} from './chapter-refinement.util';
import type { RefinementGenerationGateway } from './chapter-refinement.gateway';
import {
  createInitialRefinementUnitRecovery,
  type RefinementChange,
  type RefinementCheckpoint,
  type RefinementIssue,
  type RefinementPauseReason,
  type RefinementPhase,
  type RefinementPlanRecoveryState,
  type RefinementResolvedPolicy,
  type RefinementResumeState,
  type RefinementRunRecord,
  type RefinementStateFact,
  type RefinementStatus,
  type RefinementUnitRecoveryState,
  type RefinementUsage,
} from './chapter-refinement.types';

export interface RefinementEngineStageEvent {
  phase: RefinementPhase;
  unitIndex: number;
  unitTotal: number;
  sceneId?: string;
  message: string;
}

export interface RefinementEngineInput {
  record: RefinementRunRecord;
  signal: AbortSignal;
  onStage: (event: RefinementEngineStageEvent) => void | Promise<void>;
  /**
   * 5.1：每次真正发起模型调用前的校验钩子（权限 / 冻结原文版本）。
   * 发现变化时钩子应中止 signal，引擎会按 abort 收束；具体暂停原因由调用方覆盖。
   */
  onBeforeCall?: () => void | Promise<void>;
  /**
   * F1：阶段 / 单位 checkpoint 提交钩子（可等待）。
   *
   * 引擎在关键节点（诊断完成、计划冻结、每个单位处理完、暂停）调用它，服务层以
   * attemptId/revision 做 CAS 落库。这样即使进程重启或显式取消，已接受单位也已在库中，
   * 不会丢失。失败不应中断执行（由服务层决定）。
   */
  onCheckpoint?: (checkpoint: RefinementCheckpoint) => void | Promise<void>;
  /** F6：可注入时钟，便于对「剩余活动时间」预算做确定性测试 */
  now?: () => number;
}

export type RefinementEngineTerminalStatus = Extract<
  RefinementStatus,
  'ready' | 'ready_with_issues' | 'paused' | 'failed'
>;

export interface RefinementEngineResult {
  status: RefinementEngineTerminalStatus;
  phase: RefinementPhase;
  pauseReason?: RefinementPauseReason;
  resumable: boolean;
  checkpoint: RefinementCheckpoint;
}

/** AQ-383：单次 plan 调用的结果（含合同恢复诊断） */
type RefinementPlanAttempt =
  | { kind: 'ok'; brief: RefinementBrief; backfilled: RefinementPlanBackfillRecord[] }
  | { kind: 'aborted' }
  | { kind: 'budget' }
  | { kind: 'context' }
  | { kind: 'storage' }
  | { kind: 'upstream'; errorMessage?: string }
  | { kind: 'truncated' }
  | { kind: 'boundary'; conflict: { reason: string; detail: string } }
  | {
      kind: 'invalid';
      brief: RefinementBrief | null;
      violations: RefinementPlanViolation[];
      backfilled: RefinementPlanBackfillRecord[];
    };

/** AQ-383：plan 失败后的分流——保守降级继续，或暂停 */
type RefinementPlanFinalize =
  | { kind: 'continue'; brief: RefinementBrief }
  | { kind: 'pause'; result: RefinementEngineResult };

/**
 * 4.1：最终整章检查所需的已接受改写范围。
 * 与 `replacements` / `changes` 保持同一顺序，便于按索引定位与回退。
 */
interface RefinementAcceptedRangeRecord {
  sceneId: string;
  unitId: string;
  original: string;
  candidate: string;
  protectedQuotes: string[];
  maxChars: number;
  startOffset: number;
  endOffset: number;
}

export interface ChapterRefinementEngine {
  /** 便于 trace / 测试断言当前挂载的引擎 */
  readonly kind: string;
  run(input: RefinementEngineInput): Promise<RefinementEngineResult>;
}

export const CHAPTER_REFINEMENT_ENGINE = Symbol('CHAPTER_REFINEMENT_ENGINE');

export const KEEP_ONLY_REFINEMENT_ENGINE_KIND = 'keep-only';
export const ORCHESTRATED_REFINEMENT_ENGINE_KIND = 'orchestrated-full-chapter';

const WAREHOUSE_DEFAULT_TEMPLATE_TEXTS: Record<string, string> = {
  [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: CHAPTER_REFINEMENT_INSPECT_SYSTEM_PROMPT,
  [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: CHAPTER_REFINEMENT_PLAN_SYSTEM_PROMPT,
  [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: CHAPTER_REFINEMENT_REWRITE_SYSTEM_PROMPT,
  [CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY]: CHAPTER_REFINEMENT_REVIEW_SYSTEM_PROMPT,
  [CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY]: CHAPTER_REFINEMENT_REPAIR_SYSTEM_PROMPT,
};

/** 交给模型的只读邻文长度：改写前文尾部与未改写后文开头各取这么多字。 */
const READ_ONLY_NEIGHBOR_CHARS = 1200;

/**
 * F6：最终整章检查的单个分组字符预算。超过时按序拆成多组分别检查并登记覆盖，
 * 避免大章一次性塞入超出上下文；单组成员之和超预算时该组自成一组（不裁剪范围）。
 */
export const REFINEMENT_FINAL_CHECK_GROUP_CHARS = 24_000;

/**
 * 为最终整章检查预留的调用次数（design D9 / R8）。
 * 生成阶段不得把预算用尽，否则无法完成最终验证；不足时暂停而非宣布成功。
 */
export const REFINEMENT_RESERVED_FINAL_CHECK_CALLS = 1;

export class KeepOnlyRefinementEngine implements ChapterRefinementEngine {
  readonly kind = KEEP_ONLY_REFINEMENT_ENGINE_KIND;

  async run(input: RefinementEngineInput): Promise<RefinementEngineResult> {
    const baseText = input.record.snapshot.baseText;

    await input.onStage({
      phase: 'reading',
      unitIndex: 0,
      unitTotal: 0,
      message: '已冻结章节原文，按保留原文策略生成候选',
    });

    if (input.signal.aborted) {
      return {
        status: 'paused',
        phase: 'reading',
        pauseReason: 'user_cancelled',
        resumable: true,
        checkpoint: {
          ...input.record.checkpoint,
          progress: { unitIndex: 0, unitTotal: 0, message: '已取消' },
        },
      };
    }

    await input.onStage({
      phase: 'finished',
      unitIndex: 0,
      unitTotal: 0,
      message: '保留原文基线候选已就绪',
    });

    return {
      status: 'ready',
      phase: 'finished',
      resumable: false,
      checkpoint: {
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
        progress: { unitIndex: 0, unitTotal: 0, message: '保留原文基线候选已就绪' },
        usage: { callCount: 0, activeElapsedMs: 0, tokenAccounting: 'unavailable' },
        cursor: 0,
      },
    };
  }
}

interface ModelCallOutcome {
  ok: boolean;
  text: string;
  aborted: boolean;
  /** F6：调用／时间预算在发起前被原子拒绝，或单次调用超出剩余活动时间被中止 */
  budgetExhausted?: boolean;
  /** F6：完整输入 + 必要输出装不下供应商上下文（或模型能力未知）→ 暂停，不裁剪 */
  contextExhausted?: boolean;
  /** F1：发起前未能确认名额 / 用量 checkpoint 落库 → 必须停止，不得发起调用 */
  storageFailed?: boolean;
  errorMessage?: string;
  /** 非空内容但未正常收束（缺 end / length / 过滤 / 未知）时的类别 */
  completionFailure?: RefinementCompletionFailureKind;
}

export class OrchestratedRefinementEngine implements ChapterRefinementEngine {
  readonly kind = ORCHESTRATED_REFINEMENT_ENGINE_KIND;

  constructor(private readonly gateway: RefinementGenerationGateway) {}

  async run(input: RefinementEngineInput): Promise<RefinementEngineResult> {
    const { record, signal, onStage } = input;
    const clock = input.now ?? (() => Date.now());
    const snapshot = record.snapshot;
    const baseText = snapshot.baseText;
    const policy = snapshot.resolvedPolicy;
    const startedAt = clock();
    // R8：用量跨执行尝试累计展示，但调用／时间预算按「本次尝试」独立计算。
    // 若预算也用历史累计值，resume 一进来就撞满历史用量，无法继续。
    const priorUsage = record.checkpoint.usage;
    const priorActiveMs = priorUsage.activeElapsedMs;
    const usage: RefinementUsage = {
      callCount: priorUsage.callCount,
      activeElapsedMs: priorActiveMs,
      ...(typeof priorUsage.inputTokens === 'number'
        ? { inputTokens: priorUsage.inputTokens }
        : {}),
      ...(typeof priorUsage.outputTokens === 'number'
        ? { outputTokens: priorUsage.outputTokens }
        : {}),
      tokenAccounting: priorUsage.tokenAccounting,
    };
    let attemptCallCount = 0;
    let activePhase: RefinementPhase = 'reading';
    const issues: RefinementIssue[] = [];
    let issueSeq = 0;
    const nextIssueId = () => `i${(issueSeq += 1)}`;

    // 逐单位推进的可恢复状态：暂停时按已完成的单位收口，尾部保留原文
    let unitIndex = 0;
    let unitTotal = 0;
    let cursor = 0;
    let acceptedDraft = baseText;
    let chapterBrief: string | null = null;
    const changes: RefinementChange[] = [];
    let plannedChars = 0;
    let processedChars = 0;
    let retainedOriginalChars = 0;
    let degradedUnitCount = 0;
    // AQ-383：plan 合同恢复计数从 checkpoint 继承，resume / 自动恢复不重置已消耗名额
    const planRecovery: RefinementPlanRecoveryState = record.checkpoint.planRecovery
      ? {
          backfillCount: record.checkpoint.planRecovery.backfillCount,
          extraPlanCalls: record.checkpoint.planRecovery.extraPlanCalls,
          degradedSceneIds: [...record.checkpoint.planRecovery.degradedSceneIds],
          ...(typeof record.checkpoint.planRecovery.expandedPlanTokens === 'number'
            ? { expandedPlanTokens: record.checkpoint.planRecovery.expandedPlanTokens }
            : {}),
        }
      : { backfillCount: 0, extraPlanCalls: 0, degradedSceneIds: [] };
    // 4.1：单位补修 / 接缝修复计数同样从 checkpoint 继承，避免 resume 重复补修
    const unitRecovery: RefinementUnitRecoveryState = record.checkpoint.unitRecovery
      ? {
          repairCount: record.checkpoint.unitRecovery.repairCount,
          repairedUnitIds: [...record.checkpoint.unitRecovery.repairedUnitIds],
          seamRepairCount: record.checkpoint.unitRecovery.seamRepairCount,
        }
      : createInitialRefinementUnitRecovery();

    // 5.1：可续跑状态。resume 复用已持久化的写作单位计划，从下一个未完成单位继续，
    // 不重跑已接受单位（R8/design D10）。写入 checkpoint 时省略 unit.text 以控制体积。
    const resumeState = record.checkpoint.resumeState ?? null;
    let units: RefinementWriteUnit[] = [];
    let brief: RefinementBrief = { chapterIntent: '', protectedFacts: [], sceneBriefs: [] };
    const replacements: RefinementReplacement[] = [];
    const acceptedRangeRecords: RefinementAcceptedRangeRecord[] = [];
    let acceptedParts = '';
    let consumed = 0;
    let startUnitIndex = 0;
    let planUnsplittableSceneIds: string[] = [];
    let planScenesWithoutBrief: string[] = [];
    // F3：已完成必要 review 的单位；检查未完成的单位不得写入
    const reviewedUnitIds: string[] = [];
    // F5：已确认、有证据的散场状态事实（跨单位传递）
    const stateFacts: RefinementStateFact[] = [];
    // F3：整章最终检查的覆盖完成记录
    let finalCheckCompleted = false;
    /** B1：最终检查的覆盖完整性已按**回退前**的活动范围校验通过（回退索引清空后不可再推导）。 */
    let finalCheckCoverageVerified = false;
    const finalCheckCoveredUnitIds: string[] = [];
    /**
     * C1：整章候选（acceptedDraft）是否已成为**权威来源**。
     *
     * 逐单位阶段 acceptedDraft 是按「已接受前缀 + 剩余原文」惰性推导的；一旦按替换清单
     * 汇编出完整候选，acceptedDraft 就是最终稿的唯一权威，此后任何 checkpoint 都不得
     * 再用 acceptedParts/consumed 重新派生旧稿（否则覆盖最终修复、复活已回退的旧稿）。
     */
    let finalCandidateAssembled = false;
    /** F3/C1：被回退的替换索引（candidate 不再成立，已回退为原文）。 */
    const revertedRanges = new Set<number>();
    /**
     * B1：每个写作单位**当前候选**的版本号。候选每次实际变化（接受改写 / 接受补修 /
     * 接受接缝修复 / 回退原文）+1。问题账本在登记时记录其针对的候选版本
     * （`candidateRevision`）；只有「同一单位 + 旧版本确已被回退或被已复核的新候选取代」
     * 才能把该问题显式结案。
     *
     * 仅 unitId 相同不足以结案：同一单位可能存在多个候选版本，不同问题也不能互相抵消；
     * 缺失 unitId（全章 / 跨范围问题）更不得参与匹配——那会把全章高危阻断误判为已回退。
     */
    const unitCandidateRevisions = new Map<string, number>();
    const currentUnitCandidateRevision = (unitId: string): number =>
      unitCandidateRevisions.get(unitId) ?? 0;
    /** 候选发生实际变化时递增，返回变化后的版本号。 */
    const bumpUnitCandidateRevision = (unitId: string): number => {
      const next = currentUnitCandidateRevision(unitId) + 1;
      unitCandidateRevisions.set(unitId, next);
      return next;
    };
    /**
     * B1：把随候选消失 / 被已复核新候选取代而失效的旧阻断**显式结案**。
     *
     * 结案条件必须同时满足：同一单位、问题登记时带候选版本、且该版本严格早于
     * `supersededBeforeRevision`。版本缺失（旧 checkpoint 或未按版本登记的问题）不结案——
     * 无法证明与已处置候选同源时保持 unresolved，由完成守卫拦住应用。
     */
    const closeSupersededIssues = (args: {
      unitId: string;
      supersededBeforeRevision: number;
      reason: string;
    }): void => {
      for (const issue of issues) {
        if (issue.disposition !== 'unresolved') {
          continue;
        }
        if (issue.severity !== 'high' && issue.severity !== 'medium') {
          continue;
        }
        if (issue.unitId !== args.unitId) {
          continue;
        }
        if (issue.candidateRevision === undefined) {
          continue;
        }
        if (issue.candidateRevision >= args.supersededBeforeRevision) {
          continue;
        }
        const closedAt = issue.candidateRevision;
        issue.disposition = 'retained_original';
        issue.message = `${issue.message}（候选版本 ${closedAt} 已失效：${args.reason}）`;
      }
    };
    /**
     * B2：候选变化（补修 / 接缝修复 / 回退原文）后，该单位上提取的状态证据随之失效。
     *
     * 失效后必须等复检产生新证据才能再向下游传递，不能把旧候选上的末态当成新候选的末态。
     * 这里只移除**程序从候选中提取**的状态事实；brief 中已锁定的必要事实、逐字锁与首尾状态
     * 由各自的门禁校验，不受「不确定」影响，也不会因此被降为 null 放行。
     */
    const invalidateStateFactsForUnit = (unitId: string): void => {
      for (let index = stateFacts.length - 1; index >= 0; index -= 1) {
        if (stateFacts[index].unitId === unitId) {
          stateFacts.splice(index, 1);
        }
      }
    };
    /**
     * B2：可向下游传播的状态事实。
     *
     * 只有「证据登记的候选版本 == 该单位当前候选版本」才传播；版本缺失（旧 checkpoint）
     * 视为无法证明与当前候选同源，保守不传播。
     */
    const confirmedStateFactLines = (): string[] =>
      formatRefinementStateFacts(
        stateFacts.filter(
          (fact) =>
            fact.origin === 'candidate' &&
            fact.candidateRevision !== undefined &&
            unitCandidateRevisions.get(fact.unitId) === fact.candidateRevision
        )
      );
    /**
     * B1/R11：终态资格判定。覆盖检查完成、覆盖完整、问题处置三项。
     * 返回 null 表示可以进入可应用终态；返回非 null 表示必须暂停（候选不可应用）。
     * 正常完成与续跑完成共用同一判定，避免两条路径出现不同的放行口径。
     */
    const evaluateTerminalEligibility = (): RefinementEngineResult | null => {
      if (acceptedRangeRecords.length > 0 && !finalCheckCompleted) {
        return pause('upstream_failure', '整章最终检查未完成，已暂停');
      }
      // 覆盖完整性：必须在「回退索引尚未清空」时判定——清空后无法再区分已回退与仍生效范围。
      if (acceptedRangeRecords.length > 0 && !finalCheckCoverageVerified) {
        return pause('upstream_failure', '整章最终检查未覆盖全部已改写范围，已暂停');
      }
      // 仍存在未解决的高/中危阻断 → 候选不可应用。结案只发生在上面三类显式处置中，
      // 不靠历史 retained_original 提示集合推断豁免（缺失 unitId 会误豁免全章阻断）。
      const unresolvedBlocking = issues.filter(
        (issue) =>
          issue.disposition === 'unresolved' &&
          (issue.severity === 'high' || issue.severity === 'medium')
      );
      if (unresolvedBlocking.length > 0) {
        return pause('boundary_conflict', '仍存在未解决的阻断问题，候选不可应用，已暂停');
      }
      return null;
    };
    // F1：诊断阶段已完成窗口的结果；随 checkpoint 持久化，恢复时跳过已诊断窗口
    const diagnosisInspections: RefinementWindowInspection[] = record.checkpoint.diagnosis
      ? record.checkpoint.diagnosis.inspections.map((item) => structuredClone(item))
      : [];

    const buildResumeState = (): RefinementResumeState | null => {
      if (units.length === 0) {
        return null;
      }
      const nextIndex = units.findIndex((unit) => unit.contentEndOffset > consumed);
      return {
        chapterIntent: brief.chapterIntent,
        protectedFacts: brief.protectedFacts,
        units: units.map((unit) => ({
          unitId: unit.unitId,
          sceneId: unit.sceneId,
          decision: unit.decision,
          startBlockIndex: unit.startBlockIndex,
          endBlockIndex: unit.endBlockIndex,
          startOffset: unit.startOffset,
          contentEndOffset: unit.contentEndOffset,
          endOffset: unit.endOffset,
          brief: unit.brief,
          lowConfidence: unit.lowConfidence,
          retainedForSafety: unit.retainedForSafety,
        })),
        unsplittableSceneIds: [...planUnsplittableSceneIds],
        scenesWithoutBrief: [...planScenesWithoutBrief],
        nextUnitIndex: nextIndex < 0 ? units.length : nextIndex,
        // 快照而非引用：中途 checkpoint 提交后引擎仍会继续改写，共享数组会被后续变更污染。
        // C1：已被回退的范围必须从续跑计划中剔除，否则 resume 会复活已回退的旧稿。
        replacements: replacements
          .filter((_, index) => !revertedRanges.has(index))
          .map((item) => ({ ...item })),
        degradedUnitCount,
        reviewedUnitIds: [...reviewedUnitIds],
        stateFacts: stateFacts.map((fact) => ({ ...fact })),
        finalCheckCompleted,
        finalCheckCoveredUnitIds: [...finalCheckCoveredUnitIds],
      };
    };

    const buildCheckpoint = (message: string): RefinementCheckpoint => ({
      acceptedDraftText: acceptedDraft,
      acceptedRanges: [],
      // 快照而非引用：中途 checkpoint 提交后引擎继续执行，共享数组会被后续变更污染
      // C1：回退范围不进入变更清单，与最终候选保持一致
      changes: changes
        .filter((_, index) => !revertedRanges.has(index))
        .map((change) => ({ ...change })),
      issues: issues.map((issue) => ({ ...issue })),
      coverage: {
        sourceChars: baseText.length,
        plannedChars,
        processedChars,
        retainedOriginalChars,
      },
      chapterBrief,
      progress: { unitIndex, unitTotal, message },
      usage: { ...usage, activeElapsedMs: priorActiveMs + (clock() - startedAt) },
      cursor,
      planRecovery: { ...planRecovery, degradedSceneIds: [...planRecovery.degradedSceneIds] },
      unitRecovery: {
        repairCount: unitRecovery.repairCount,
        repairedUnitIds: [...unitRecovery.repairedUnitIds],
        seamRepairCount: unitRecovery.seamRepairCount,
      },
      resumeState: buildResumeState(),
      ...(diagnosisInspections.length > 0
        ? {
            diagnosis: {
              completedWindows: diagnosisInspections.length,
              inspections: diagnosisInspections.map((item) => structuredClone(item)),
            },
          }
        : {}),
    });

    /**
     * F1：把当前 checkpoint 提交给服务层（以 attemptId/revision CAS 落库）。
     * 抛出异常表示**未能确认持久化成功**（存储故障 / CAS 冲突）；F1 要求此时不得继续，
     * 因此调用方必须显式处理，不能静默吞掉。
     */
    const commitCheckpoint = async (message: string): Promise<void> => {
      if (!input.onCheckpoint) {
        return;
      }
      // C1：仅在逐单位阶段用「已接受前缀 + 剩余原文」推导候选。整章候选汇编完成后
      // acceptedDraft 是权威来源（含最终接缝修复 / 已回退范围），不得再重新派生旧稿，
      // 否则后续 checkpoint 会把最终修复覆盖掉、并复活已回退的旧改写。
      if (!finalCandidateAssembled && units.length > 0) {
        acceptedDraft = acceptedParts + baseText.slice(consumed);
      }
      await input.onCheckpoint(buildCheckpoint(message));
    };

    /** F1：提交 checkpoint，持久化失败时返回暂停结果（不得继续执行）。 */
    const persistCheckpoint = async (message: string): Promise<RefinementEngineResult | null> => {
      try {
        await commitCheckpoint(message);
        return null;
      } catch (error) {
        return pause(
          'persistence_failed',
          `进度持久化失败，已停止（未丢失上一 checkpoint）：${
            error instanceof Error ? error.message : '未知存储错误'
          }`
        );
      }
    };

    const pause = (reason: RefinementPauseReason, message: string): RefinementEngineResult => ({
      status: 'paused',
      phase: activePhase,
      pauseReason: reason,
      // F1：存储故障下不能声称可恢复（checkpoint 无法确认落库），其余停靠可续跑
      resumable:
        reason !== 'permission_revoked' &&
        reason !== 'source_changed' &&
        reason !== 'persistence_failed',
      checkpoint: buildCheckpoint(message),
    });

    const settle = (
      status: RefinementEngineTerminalStatus,
      message: string
    ): RefinementEngineResult => ({
      status,
      phase: 'finished',
      resumable: false,
      // 终态不再可续跑，清空续跑计划，避免 checkpoint 无谓膨胀
      checkpoint: { ...buildCheckpoint(message), resumeState: null },
    });

    const templateText = (key: string): string =>
      snapshot.templateTexts?.[key]?.trim() || WAREHOUSE_DEFAULT_TEMPLATE_TEXTS[key] || '';

    // 预留最终检查预算：生成阶段最多用掉 maxCallsPerAttempt - reserve 次
    // 预算只统计「本次尝试」的调用（attemptCallCount），历史累计用量不占用本次额度。
    const budgetExhausted = (reserveCalls = 0): boolean =>
      attemptCallCount + reserveCalls >= policy.maxCallsPerAttempt ||
      clock() - startedAt >= policy.maxActiveMsPerAttempt;

    const callModel = async (args: {
      templateKey: string;
      prompt: string;
      /**
       * 期望输出字数（正文类调用）。
       *
       * F6：所有真实调用都必须按「完整最终消息 + 必要输出」做保守预算——正文类调用给
       * `desiredOutputChars`，结构化调用（inspect/plan/review）给 `requiredOutputTokens`。
       * 两者必须给出其一，删除 `maxTokens` 旁路，避免「不给期望输出就绕过输入预算」。
       */
      desiredOutputChars?: number;
      /**
       * 必要输出 token（结构化合同调用）。与 `desiredOutputChars` 二选一；
       * 由合同规模决定，不随正文长度放大，也不静默裁剪。
       */
      requiredOutputTokens?: number;
    }): Promise<ModelCallOutcome> => {
      // 5.1：每个新调用前重新校验权限与冻结原文版本；钩子发现变化会中止 signal
      await input.onBeforeCall?.();
      if (signal.aborted) {
        return { ok: false, text: '', aborted: true };
      }
      // F6：统一原子预算准入——每次真实调用（含所有重试）前检查调用上限与剩余活动时间
      const elapsed = clock() - startedAt;
      if (
        attemptCallCount >= policy.maxCallsPerAttempt ||
        elapsed >= policy.maxActiveMsPerAttempt
      ) {
        return {
          ok: false,
          text: '',
          aborted: false,
          budgetExhausted: true,
          errorMessage: '本次尝试预算已用尽，未发起调用',
        };
      }
      // F4：把 run 创建时冻结的模型路由显式传给网关（utility / writing 分档），
      // 不再让 orchestrator 从当前项目设置重新解析。
      const frozenRoute = CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS.includes(args.templateKey)
        ? snapshot.modelRoutes?.utility
        : snapshot.modelRoutes?.writing;

      // F6：按「完整最终消息 + 必要输出」做保守预算。
      // 冻结了模型路由时，必须按 provider+model 精确解析能力；未登记组合走不可判断路径（暂停）。
      const capability = frozenRoute ? resolveRefinementModelCapability(frozenRoute) : null;
      if (frozenRoute && !capability) {
        return {
          ok: false,
          text: '',
          aborted: false,
          contextExhausted: true,
          errorMessage: `未登记冻结模型 ${frozenRoute.provider}/${frozenRoute.model} 的能力配置，无法保证预算，已暂停`,
        };
      }
      // 完整输入 = 任务 system prompt + 项目 system prompt + user prompt + orchestrator 追加的冻结参考材料
      const budget = resolveRefinementCallBudget({
        promptChars:
          templateText(args.templateKey).length +
          snapshot.systemPromptText.length +
          args.prompt.length +
          (snapshot.referenceMaterials?.promptText.length ?? 0),
        desiredOutputChars: args.desiredOutputChars ?? 0,
        ...(args.requiredOutputTokens !== undefined
          ? { requiredOutputTokens: args.requiredOutputTokens }
          : {}),
        ...(capability
          ? {
              contextTokens: capability.contextTokens,
              maxOutputTokens: capability.maxOutputTokens,
            }
          : {}),
      });
      if (!budget.ok) {
        return {
          ok: false,
          text: '',
          aborted: false,
          contextExhausted: true,
          errorMessage: budget.reason ?? '完整输入超出上下文预算',
        };
      }
      const maxTokens = budget.maxTokens;
      // 每次实际发起（含重试）都计入预算：本次尝试额度与历史累计用量同步 +1
      attemptCallCount += 1;
      usage.callCount += 1;

      // F1：发起调用前**原子持久化**已消耗的调用 / 恢复 / 补修名额与累计用量。
      // 这样即使调用中途取消或进程重启，补修名额与历史用量都不会被重置（R8）；
      // 存储失败时明确停止，不发起调用，避免「声称可恢复但实际未落库」。
      try {
        await commitCheckpoint(`调用前保存进度（本尝试第 ${attemptCallCount} 次调用）`);
      } catch (error) {
        return {
          ok: false,
          text: '',
          aborted: false,
          storageFailed: true,
          errorMessage: error instanceof Error ? error.message : 'checkpoint 未能持久化，已停止',
        };
      }

      // F6：为当前调用设置剩余活动时间截止，超时中止在途调用（区别于用户取消）
      const remaining = policy.maxActiveMsPerAttempt - elapsed;
      const callController = new AbortController();
      let timedOut = false;
      const onOuterAbort = () => callController.abort();
      if (signal.aborted) {
        callController.abort();
      } else {
        signal.addEventListener('abort', onOuterAbort, { once: true });
      }
      const timer = setTimeout(
        () => {
          timedOut = true;
          callController.abort();
        },
        Math.max(1, remaining)
      );

      // F4：把 run 创建时冻结的模型路由显式传给网关（utility / writing 分档），
      // 不再让 orchestrator 从当前项目设置重新解析。
      const writingStage = isRefinementWritingStageTemplateKey(args.templateKey);
      let result;
      try {
        result = await this.gateway.generate({
          projectId: record.projectId,
          chapterNo: record.chapterNo,
          templateKey: args.templateKey,
          systemPromptText: templateText(args.templateKey),
          // R12/B5（R1 修复）：冻结的项目长写作指导只发给写作档（rewrite / repair）。
          // 工具档（inspect / plan / review）不下发，避免 orchestrator 侧被 override
          // 重新开启而向诊断／规划／检查阶段注入项目文风。
          ...(writingStage ? { projectSystemPromptText: snapshot.systemPromptText } : {}),
          prompt: args.prompt,
          ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
          retrievalInstruction: snapshot.instruction.slice(0, 500),
          signal: callController.signal,
          ...(frozenRoute ? { modelRoute: frozenRoute } : {}),
          // F4：把冻结的实际参考材料（人物 / 知识 / 文风样本）随请求下发
          ...(snapshot.referenceMaterials
            ? { frozenReferenceMaterials: snapshot.referenceMaterials }
            : {}),
        });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onOuterAbort);
      }

      // 单次调用超出剩余活动时间被中止：按预算耗尽收束，而不是用户取消
      if (!result.ok && result.aborted && timedOut && !signal.aborted) {
        return {
          ok: false,
          text: result.text,
          aborted: false,
          budgetExhausted: true,
          errorMessage: '单次调用超出剩余活动时间，已中止',
        };
      }
      return {
        ok: result.ok,
        text: result.text,
        aborted: result.aborted,
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
        ...(result.completionFailure ? { completionFailure: result.completionFailure } : {}),
      };
    };

    /** 暂时性上游失败允许重试一次，计入预算；取消 / 预算耗尽不重试。 */
    const callModelWithRetry = async (args: {
      templateKey: string;
      prompt: string;
      /** F6：期望输出字数（正文类）；与 `requiredOutputTokens` 二选一 */
      desiredOutputChars?: number;
      /** F6：必要输出 token（结构化合同类）；与 `desiredOutputChars` 二选一 */
      requiredOutputTokens?: number;
    }): Promise<ModelCallOutcome> => {
      const first = await callModel(args);
      if (
        first.ok ||
        first.aborted ||
        first.budgetExhausted ||
        first.contextExhausted ||
        first.storageFailed
      ) {
        return first;
      }
      return callModel(args);
    };

    const stage = async (
      phase: RefinementPhase,
      message: string,
      extra: { sceneId?: string; unitIndex?: number; unitTotal?: number } = {}
    ) => {
      activePhase = phase;
      await onStage({
        phase,
        unitIndex: extra.unitIndex ?? 0,
        unitTotal: extra.unitTotal ?? 0,
        ...(extra.sceneId ? { sceneId: extra.sceneId } : {}),
        message,
      });
    };

    if (signal.aborted) {
      return pause('user_cancelled', '已取消');
    }

    // F4：run 冻结了模型路由时两档必须齐全。缺失即暂停，绝不静默回退到当前项目设置——
    // 否则实际生成参数会与冻结快照不一致（冻结路由只存不用的验收缺陷）。
    if (snapshot.modelRoutes && (!snapshot.modelRoutes.writing || !snapshot.modelRoutes.utility)) {
      return pause('upstream_failure', '冻结模型路由不完整，无法按冻结参数生成，已暂停');
    }

    const blocks = buildRefinementSourceBlocks(baseText);
    const windows = planRefinementDiagnosisWindows({
      baseText,
      blocks,
      targetChars: policy.diagnosisTargetChars,
    });
    // 新规划和续跑均重验旧诊断，不能把旧版本缓存当成已验证证据。
    for (let i = 0; i < diagnosisInspections.length; i += 1) {
      const window = windows[i];
      if (!window) {
        return {
          ...pause('invalid_model_output', '已保存诊断超出冻结窗口范围，需重新创建运行'),
          resumable: false,
        };
      }
      try {
        diagnosisInspections[i] = parseWindowInspection(JSON.stringify(diagnosisInspections[i]), {
          blocks,
          startBlockIndex: window.startBlockIndex,
          endBlockIndex: window.endBlockIndex,
          targetText: window.text,
        });
      } catch (error) {
        return {
          ...pause(
            'invalid_model_output',
            `第 ${i + 1} 窗已保存诊断证据无效：${
              error instanceof Error ? error.message : '无法验证'
            }；需重新创建运行`
          ),
          resumable: false,
        };
      }
    }

    if (resumeState && resumeState.units.length > 0) {
      // ── 续跑：复用已持久化计划，跳过已接受单位（R8/design D10） ─────────
      const restored = this.restoreResumeState({ resumeState, baseText, blocks, policy });
      units = resumeState.units.map((unit) => ({
        ...unit,
        text: baseText.slice(unit.startOffset, unit.contentEndOffset),
      }));
      if (diagnosisInspections.length > 0) {
        const scenes = mergeWindowSceneFragments({ blocks, inspections: diagnosisInspections });
        const factViolations: RefinementPlanViolation[] = [];
        const factIndex = buildRefinementFactIndex({ blocks, scenes, violations: factViolations });
        if (factViolations.length > 0) {
          return {
            ...pause(
              'invalid_model_output',
              `已保存诊断的场景证据无效：${factViolations
                .map((item) => item.message)
                .join('；')}；需重新创建运行`
            ),
            resumable: false,
          };
        }
        for (const unit of units) {
          if (!unit.brief) continue;
          const owner =
            scenes.find((scene) => scene.sceneId === unit.brief!.sceneId) ??
            scenes.find((scene) =>
              blocks
                .slice(scene.startBlockIndex, scene.endBlockIndex)
                .some((block) => unit.brief!.sourceBlockIds.includes(block.id))
            );
          // 旧 checkpoint 没有此字段，或已有未经验证的过程事实，都从原文诊断重建。
          unit.brief = {
            ...unit.brief,
            processFacts: factIndex
              .filter(
                (fact) =>
                  fact.role === 'process' &&
                  fact.sceneId === owner?.sceneId &&
                  unit.brief!.sourceBlockIds.includes(fact.sourceBlockId)
              )
              .map(({ key, value, sourceBlockId, anchorQuote }) => ({
                key,
                value,
                sourceBlockId,
                anchorQuote,
              })),
          };
        }
      }
      brief = {
        chapterIntent: resumeState.chapterIntent,
        protectedFacts: resumeState.protectedFacts,
        sceneBriefs: [],
      };
      // 已接受前缀的变更清单与检查结论随 checkpoint 一并还原：续跑不得丢失既有成果，
      // 否则最终整章视图会缺掉前缀段落的变更与提示。
      replacements.push(...restored.replacements);
      acceptedRangeRecords.push(...restored.acceptedRanges);
      changes.push(...record.checkpoint.changes.map((change) => ({ ...change })));
      issues.push(...record.checkpoint.issues.map((issue) => ({ ...issue })));
      issueSeq = issues.reduce((max, issue) => {
        const parsed = Number.parseInt(issue.id.slice(1), 10);
        return Number.isFinite(parsed) && parsed > max ? parsed : max;
      }, 0);
      acceptedParts = restored.acceptedParts;
      consumed = restored.consumed;
      planUnsplittableSceneIds = [...resumeState.unsplittableSceneIds];
      planScenesWithoutBrief = [...resumeState.scenesWithoutBrief];
      degradedUnitCount = resumeState.degradedUnitCount;
      // F3/F5：续跑还原已完成必要 review 的单位、已确认状态事实与最终检查覆盖记录，
      // 避免重启后重复检查或丢失跨单位状态证据。
      reviewedUnitIds.push(...resumeState.reviewedUnitIds);
      stateFacts.push(...resumeState.stateFacts.map((fact) => ({ ...fact })));
      finalCheckCompleted = resumeState.finalCheckCompleted;
      finalCheckCoveredUnitIds.push(...resumeState.finalCheckCoveredUnitIds);
      // B1：候选版本从已恢复的问题账本与状态证据反推（取每个单位已登记的最大版本），
      // 使续跑中的回退 / 补修结案能正确判定「旧版本已被取代」。
      // B2：状态证据也必须参与反推——只从问题账本反推时，没有问题的单位版本会缺失，
      // 其已确认状态证据会被误判为「版本不匹配」而不传播。
      for (const source of [...issues, ...stateFacts] as Array<{
        unitId?: string;
        candidateRevision?: number;
      }>) {
        if (!source.unitId || source.candidateRevision === undefined) {
          continue;
        }
        const known = unitCandidateRevisions.get(source.unitId) ?? 0;
        if (source.candidateRevision > known) {
          unitCandidateRevisions.set(source.unitId, source.candidateRevision);
        }
      }
      // B1：旧 checkpoint 声称已完成最终检查，但覆盖记录缺少仍生效的已改写范围时，
      // 判定信息不完整 → 保守重检，不默认认为检查已完成。
      if (finalCheckCompleted) {
        const restoredActive = acceptedRangeRecords.map((record) => record.unitId);
        const fullyCovered = restoredActive.every((unitId) =>
          finalCheckCoveredUnitIds.includes(unitId)
        );
        if (!fullyCovered) {
          finalCheckCompleted = false;
        }
      }
      finalCheckCoverageVerified = finalCheckCompleted;
      startUnitIndex = resumeState.nextUnitIndex;
      unitTotal = units.length;
      plannedChars = units.reduce(
        (sum, unit) => sum + Math.max(0, unit.endOffset - unit.startOffset),
        0
      );
      processedChars = record.checkpoint.coverage.processedChars;
      retainedOriginalChars = record.checkpoint.coverage.retainedOriginalChars;
      chapterBrief = record.checkpoint.chapterBrief;
      await stage(
        'rewriting',
        `正在从断点继续第 ${Math.min(startUnitIndex + 1, units.length)}/${units.length} 段…`,
        { unitIndex: startUnitIndex, unitTotal: units.length }
      );
    } else {
      // ── 建立原文索引（SourceBlock：稳定 ID + UTF-16 精确偏移） ──────────
      await stage('reading', '正在建立原文索引…');
      if (blocks.length === 0) {
        plannedChars = 0;
        processedChars = 0;
        retainedOriginalChars = 0;
        return settle('ready', '原文无可处理自然段，候选等于原文');
      }

      // ── 诊断窗规划：覆盖全文，不直接成为创编场景 ───────────────────────
      const inspections: RefinementWindowInspection[] = diagnosisInspections;
      for (let i = inspections.length; i < windows.length; i += 1) {
        const window = windows[i];
        await stage('reading', `正在通读第 ${i + 1}/${windows.length} 个诊断窗…`);
        if (signal.aborted) {
          return pause('user_cancelled', '已取消');
        }
        if (budgetExhausted()) {
          return pause('budget_exhausted', '预算不足，已暂停');
        }
        const evidenceRecoveries: RefinementPlanBackfillRecord[] = [];
        const outcome = await this.callParse({
          call: (contractError) =>
            callModel({
              templateKey: CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
              prompt: buildInspectUserPrompt({
                windowId: window.id,
                instruction: snapshot.instruction,
                rewritePolicy: record.rewritePolicy,
                windowText: window.text,
                windowIndex: buildRefinementBlockIndexForRange(
                  blocks,
                  window.startBlockIndex,
                  window.endBlockIndex
                ),
                readOnlyPrefixText: window.readOnlyPrefix,
                readOnlySuffixText: window.readOnlySuffix,
                ...(contractError ? { contractError } : {}),
              }),
              // F6：诊断输出为结构化 JSON，按**合同规模**给必要输出，不照用诊断窗正文预算
              requiredOutputTokens: REFINEMENT_STRUCTURED_OUTPUT_TOKENS,
            }),
          parse: (text) => {
            evidenceRecoveries.length = 0;
            return parseWindowInspection(text, {
              blocks,
              startBlockIndex: window.startBlockIndex,
              endBlockIndex: window.endBlockIndex,
              targetText: window.text,
              recoveries: evidenceRecoveries,
            });
          },
        });
        if (!outcome.ok) {
          return this.pauseFromOutcome(outcome, pause, `第 ${i + 1} 窗 inspect 阶段`);
        }
        // windowId 以程序规划为准，避免模型回填错误导致跨窗合并错位
        inspections.push({ ...outcome.value, windowId: window.id });
        for (const recovery of evidenceRecoveries) {
          issues.push({
            id: nextIssueId(),
            category: 'coverage',
            severity: 'low',
            message: `诊断证据恢复：${recovery.path} 唯一重锚到 ${recovery.sourceBlockId}`,
            disposition: 'resolved',
          });
        }
        // F1：诊断结果逐窗持久化，恢复时不重跑已完成窗口（复用已完成诊断，R8）
        const diagnosed = await persistCheckpoint(`第 ${i + 1}/${windows.length} 个诊断窗已完成`);
        if (diagnosed) {
          return diagnosed;
        }
      }

      // ── 跨窗场景合并：只按可验证 block 引用合并 ────────────────────────
      const scenes = mergeWindowSceneFragments({ blocks, inspections });
      if (scenes.length === 0) {
        issues.push({
          id: nextIssueId(),
          category: 'coverage',
          severity: 'high',
          message: '未能从诊断结果确认可信场景边界，已整体保留原文',
          disposition: 'retained_original',
        });
        plannedChars = baseText.length;
        processedChars = 0;
        retainedOriginalChars = baseText.length;
        return settle('ready_with_issues', '未识别可信场景边界，已保留原文');
      }

      // ── plan：整章汇总为唯一一份意图与场景交底（AQ-383 有界恢复） ──────
      await stage('planning', '正在统筹整章编辑意图…');
      if (budgetExhausted()) {
        return pause('budget_exhausted', '预算不足，已暂停');
      }
      {
        const sceneIndex = buildRefinementMergedSceneIndex(blocks, scenes);
        const factViolations: RefinementPlanViolation[] = [];
        const factIndex = buildRefinementFactIndex({ blocks, scenes, violations: factViolations });
        if (factViolations.length > 0) {
          return {
            ...pause(
              'invalid_model_output',
              `诊断事实与合并场景范围不符：${factViolations
                .map((item) => item.message)
                .join('；')}；需重新创建运行`
            ),
            resumable: false,
          };
        }
        const planPrompt = (contractErrors: string[]): string =>
          buildPlanUserPrompt({
            instruction: snapshot.instruction,
            rewritePolicy: record.rewritePolicy,
            inspections,
            sceneIndex,
            factIndex,
            ...(contractErrors.length > 0 ? { contractErrors } : {}),
          });

        const attemptPlan = async (
          prompt: string,
          requiredOutputTokens: number
        ): Promise<RefinementPlanAttempt> => {
          const outcome = await callModel({
            templateKey: CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
            prompt,
            // F6：规划输出为结构化 JSON（意图 + 场景交底），必要输出按**合同规模**估算——
            // 随合并场景数、事实数与引文长度增长，而非固定 4096（长章固定预算会被 length 截断）。
            requiredOutputTokens,
          });
          if (outcome.aborted) {
            return { kind: 'aborted' };
          }
          if (outcome.storageFailed) {
            return { kind: 'storage' };
          }
          if (outcome.contextExhausted) {
            return { kind: 'context' };
          }
          if (outcome.budgetExhausted) {
            return { kind: 'budget' };
          }
          if (outcome.completionFailure === 'truncated') {
            // 输出达到长度上限被截断：这是**额度不足**的信号，与「上游失败」「字段缺失」区分，
            // 交由调用方扩容重试（有界），而非用同样的额度无效重试。
            return { kind: 'truncated' };
          }
          if (!outcome.ok) {
            return {
              kind: 'upstream',
              ...(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {}),
            };
          }
          const recovery = parsePlanOutputWithRecovery({ raw: outcome.text, blocks, scenes });
          if (recovery.boundaryConflict) {
            return { kind: 'boundary', conflict: recovery.boundaryConflict };
          }
          if (recovery.violations.length === 0 && recovery.brief) {
            return { kind: 'ok', brief: recovery.brief, backfilled: recovery.backfilled };
          }
          return {
            kind: 'invalid',
            brief: recovery.brief,
            violations: recovery.violations,
            backfilled: recovery.backfilled,
          };
        };

        const recordBackfill = (backfilled: RefinementPlanBackfillRecord[]): void => {
          if (backfilled.length === 0) {
            return;
          }
          planRecovery.backfillCount += 1;
          issues.push({
            id: nextIssueId(),
            category: 'coverage',
            severity: 'low',
            message: `方案格式恢复：确定性回填 ${backfilled.length} 条事实来源（${backfilled
              .map((item) => item.path)
              .join('、')}）`,
            disposition: 'resolved',
          });
        };

        const pauseBoundary = (conflict: {
          reason: string;
          detail: string;
        }): RefinementEngineResult => {
          issues.push({
            id: nextIssueId(),
            category: 'hard_constraint',
            severity: 'high',
            message: `要求超出改写权限：${conflict.reason}。${conflict.detail}`,
            disposition: 'unresolved',
          });
          return pause('boundary_conflict', '要求超出当前改写权限，建议改用方案改写；已保留原文');
        };

        const finalizePlanFailure = (last: RefinementPlanAttempt): RefinementPlanFinalize => {
          const violations = last.kind === 'invalid' ? last.violations : [];
          const lastBrief = last.kind === 'invalid' ? last.brief : null;
          const degradation = resolvePlanDegradation({ brief: lastBrief, violations });
          if (degradation) {
            for (const sceneId of degradation.degradedSceneIds) {
              if (!planRecovery.degradedSceneIds.includes(sceneId)) {
                planRecovery.degradedSceneIds.push(sceneId);
              }
              issues.push({
                id: nextIssueId(),
                category: 'coverage',
                severity: 'medium',
                sceneId,
                message: `方案恢复：场景 ${sceneId} 的编辑指令无法验证，已整场保留原文`,
                disposition: 'retained_original',
              });
            }
            return { kind: 'continue', brief: degradation.brief };
          }
          if (last.kind === 'upstream') {
            return {
              kind: 'pause',
              result: pause(
                'upstream_failure',
                `plan 阶段上游模型失败：${last.errorMessage ?? '未知错误'}`
              ),
            };
          }
          return {
            kind: 'pause',
            result: (() => {
              // 合同校验失败：把具体违规固化到 issues 与暂停消息，避免只剩一句笼统提示无法定位。
              for (const violation of violations) {
                issues.push({
                  id: nextIssueId(),
                  category: 'coverage',
                  severity: 'high',
                  ...(violation.sceneId ? { sceneId: violation.sceneId } : {}),
                  message: `plan 合同违规（${violation.kind}）${violation.path}：${violation.message}`,
                  disposition: 'unresolved',
                });
              }
              const detail =
                violations.length > 0
                  ? `：${violations
                      .slice(0, 5)
                      .map((v) => `${v.kind}@${v.path}`)
                      .join('；')}${violations.length > 5 ? `… 等 ${violations.length} 项` : ''}`
                  : '';
              return pause('invalid_model_output', `plan 输出未通过合同校验${detail}，已暂停`);
            })(),
          };
        };

        // plan 必要输出按合同规模估算（场景数 / 事实数 / 引文长度），不再固定 4096。
        const planOutputTokens = resolveRefinementPlanOutputTokens(blocks, scenes);

        const first = await attemptPlan(planPrompt([]), planOutputTokens);
        let resolved: RefinementBrief | null = null;
        let failure: RefinementEngineResult | null = null;

        if (first.kind === 'ok') {
          recordBackfill(first.backfilled);
          resolved = first.brief;
        } else if (first.kind === 'aborted') {
          return pause('user_cancelled', '已取消');
        } else if (first.kind === 'storage') {
          return pause('persistence_failed', '规划前的进度未能持久化，已停止');
        } else if (first.kind === 'context') {
          return pause('context_budget', '规划完整输入超出上下文预算，已暂停');
        } else if (first.kind === 'budget') {
          return pause('budget_exhausted', '预算不足，已暂停');
        } else if (first.kind === 'boundary') {
          return pauseBoundary(first.conflict);
        } else if (first.kind === 'truncated') {
          // 截断 = 额度不足：按有界扩容重试（16K → 32K），而非用同样额度无效重试。
          // 扩额仍受 callModel 内部 F6 门禁钳制（不超 providerOutputCap / 上下文余量）。
          const expandedTokens = Math.min(
            REFINEMENT_PLAN_MAX_TOKENS,
            Math.max(planOutputTokens, 16_384)
          );
          const retry = await attemptPlan(planPrompt([]), expandedTokens);
          if (retry.kind === 'ok') {
            recordBackfill(retry.backfilled);
            resolved = retry.brief;
            planRecovery.expandedPlanTokens = expandedTokens;
          } else if (retry.kind === 'truncated') {
            // 16K 仍截断：再扩到 32K（有界），仍不足则按上游失败暂停，不静默钳低。
            const widenedTokens = Math.min(REFINEMENT_PLAN_MAX_TOKENS, 32_768);
            const retry2 = await attemptPlan(planPrompt([]), widenedTokens);
            if (retry2.kind === 'ok') {
              recordBackfill(retry2.backfilled);
              resolved = retry2.brief;
              planRecovery.expandedPlanTokens = widenedTokens;
            } else if (retry2.kind === 'truncated') {
              failure = pause(
                'upstream_failure',
                'plan 阶段连续截断：输出额度已扩至上限仍不足以完整输出规划 JSON，已暂停'
              );
            } else if (retry2.kind === 'aborted') {
              return pause('user_cancelled', '已取消');
            } else if (retry2.kind === 'storage') {
              return pause('persistence_failed', '规划前的进度未能持久化，已停止');
            } else if (retry2.kind === 'context') {
              return pause('context_budget', '规划完整输入超出上下文预算，已暂停');
            } else if (retry2.kind === 'budget') {
              return pause('budget_exhausted', '预算不足，已暂停');
            } else if (retry2.kind === 'boundary') {
              return pauseBoundary(retry2.conflict);
            } else {
              recordBackfill(retry2.kind === 'invalid' ? retry2.backfilled : []);
              const finalized = finalizePlanFailure(retry2);
              if (finalized.kind === 'continue') {
                resolved = finalized.brief;
              } else {
                failure = finalized.result;
              }
            }
          } else if (retry.kind === 'aborted') {
            return pause('user_cancelled', '已取消');
          } else if (retry.kind === 'storage') {
            return pause('persistence_failed', '规划前的进度未能持久化，已停止');
          } else if (retry.kind === 'context') {
            return pause('context_budget', '规划完整输入超出上下文预算，已暂停');
          } else if (retry.kind === 'budget') {
            return pause('budget_exhausted', '预算不足，已暂停');
          } else if (retry.kind === 'boundary') {
            return pauseBoundary(retry.conflict);
          } else {
            recordBackfill(retry.kind === 'invalid' ? retry.backfilled : []);
            const finalized = finalizePlanFailure(retry);
            if (finalized.kind === 'continue') {
              resolved = finalized.brief;
            } else {
              failure = finalized.result;
            }
          }
        } else {
          recordBackfill(first.kind === 'invalid' ? first.backfilled : []);
          if (planRecovery.extraPlanCalls >= 1) {
            // 额外调用名额已消耗：直接降级或暂停，不再自动调用
            const finalized = finalizePlanFailure(first);
            if (finalized.kind === 'continue') {
              resolved = finalized.brief;
            } else {
              failure = finalized.result;
            }
          } else if (budgetExhausted(REFINEMENT_RESERVED_FINAL_CHECK_CALLS)) {
            return pause('budget_exhausted', '预算不足，已暂停');
          } else {
            planRecovery.extraPlanCalls += 1;
            await stage('planning', '方案格式异常，正在恢复…');
            const errorPaths =
              first.kind === 'invalid'
                ? first.violations.map((item) => `${item.path}：${item.message}`)
                : [first.errorMessage ?? '上游生成失败'];
            const second = await attemptPlan(planPrompt(errorPaths), planOutputTokens);
            if (second.kind === 'ok') {
              recordBackfill(second.backfilled);
              resolved = second.brief;
            } else if (second.kind === 'aborted') {
              return pause('user_cancelled', '已取消');
            } else if (second.kind === 'storage') {
              return pause('persistence_failed', '规划前的进度未能持久化，已停止');
            } else if (second.kind === 'context') {
              return pause('context_budget', '规划完整输入超出上下文预算，已暂停');
            } else if (second.kind === 'budget') {
              return pause('budget_exhausted', '预算不足，已暂停');
            } else if (second.kind === 'boundary') {
              return pauseBoundary(second.conflict);
            } else if (second.kind === 'truncated') {
              // 合同恢复调用仍被截断：额度不足，扩到 16K 再试一次（有界）。
              const expandedTokens = Math.min(REFINEMENT_PLAN_MAX_TOKENS, 16_384);
              const retry = await attemptPlan(planPrompt(errorPaths), expandedTokens);
              if (retry.kind === 'ok') {
                recordBackfill(retry.backfilled);
                resolved = retry.brief;
                planRecovery.expandedPlanTokens = expandedTokens;
              } else {
                recordBackfill(retry.kind === 'invalid' ? retry.backfilled : []);
                const finalized = finalizePlanFailure(retry);
                if (finalized.kind === 'continue') {
                  resolved = finalized.brief;
                } else {
                  failure = finalized.result;
                }
              }
            } else {
              recordBackfill(second.kind === 'invalid' ? second.backfilled : []);
              const finalized = finalizePlanFailure(second);
              if (finalized.kind === 'continue') {
                resolved = finalized.brief;
              } else {
                failure = finalized.result;
              }
            }
          }
        }

        if (!resolved) {
          return failure ?? pause('invalid_model_output', '规划输出不可用，已暂停');
        }
        brief = resolved;
        chapterBrief = summarizeChapterBrief(brief);
      }

      // ── 写作单位规划：场景优先、拍边界拆分、覆盖修复 ───────────────────
      const plan = planRefinementWriteUnits({
        baseText,
        blocks,
        scenes,
        briefs: brief.sceneBriefs,
        rewriteTargetChars: policy.rewriteTargetChars,
        rewriteMaxChars: policy.rewriteMaxChars,
      });
      units = plan.units;
      planUnsplittableSceneIds = [...plan.unsplittableSceneIds];
      planScenesWithoutBrief = [...plan.scenesWithoutBrief];
      plannedChars = units.reduce(
        (sum, unit) => sum + Math.max(0, unit.endOffset - unit.startOffset),
        0
      );
      if (units.length === 0) {
        processedChars = 0;
        retainedOriginalChars = 0;
        // B1：与正常完成路径共用终态判定（无可接受范围时主要校验问题账本处置）
        const emptyBlocked = evaluateTerminalEligibility();
        if (emptyBlocked) {
          return emptyBlocked;
        }
        return settle('ready', '无可处理范围，候选等于原文');
      }
      unitTotal = units.length;

      for (const sceneId of plan.scenesWithoutBrief) {
        issues.push({
          id: nextIssueId(),
          category: 'coverage',
          severity: 'medium',
          sceneId,
          message: `规划未覆盖场景 ${sceneId}，该场保留原文`,
          disposition: 'retained_original',
        });
      }
      for (const sceneId of plan.unsplittableSceneIds) {
        issues.push({
          id: nextIssueId(),
          category: 'coverage',
          severity: 'medium',
          sceneId,
          message: `场景 ${sceneId} 超长且无已验证拍边界，整场保留原文`,
          disposition: 'retained_original',
        });
      }
      const sceneIds = new Set(scenes.map((scene) => scene.sceneId));
      for (const unit of units) {
        if (sceneIds.has(unit.sceneId)) {
          continue;
        }
        issues.push({
          id: nextIssueId(),
          category: 'coverage',
          severity: 'medium',
          sceneId: unit.sceneId,
          unitId: unit.unitId,
          message: `自然段 ${unit.startBlockIndex + 1}~${unit.endBlockIndex} 未被任何场景覆盖，保留原文`,
          disposition: 'retained_original',
        });
      }

      // F1：计划冻结后提交一次 checkpoint（进程重启可从此处恢复，不必重跑诊断/规划）
      const plannedPersisted = await persistCheckpoint('已冻结整章计划，等待逐段改写');
      if (plannedPersisted) {
        return plannedPersisted;
      }
    } // end fresh planning

    // ── 逐单位顺序执行：每个单位用原文偏移定位，长度变化不影响后续 ─────
    // units / brief / replacements / acceptedRangeRecords / acceptedParts / consumed
    // 已在函数顶部声明并（续跑时）由 checkpoint 还原，此处不再重复声明。
    const flushPartial = () => {
      acceptedDraft = acceptedParts + baseText.slice(consumed);
    };

    for (let i = startUnitIndex; i < units.length; i += 1) {
      const unit = units[i];
      unitIndex = i + 1;
      cursor = unit.startOffset;
      const sceneId = unit.sceneId;
      const span = Math.max(0, unit.endOffset - unit.startOffset);
      const gap = baseText.slice(consumed, unit.startOffset);
      const unitText = baseText.slice(unit.startOffset, unit.contentEndOffset);
      const unitChars = unitText.length;
      const progressExtra = { sceneId, unitIndex, unitTotal };

      if (signal.aborted) {
        flushPartial();
        return pause('user_cancelled', '已取消');
      }
      if (budgetExhausted(REFINEMENT_RESERVED_FINAL_CHECK_CALLS)) {
        flushPartial();
        return pause('budget_exhausted', '预算不足，已暂停，未处理部分保留原文');
      }

      if (
        unit.brief === null ||
        unit.decision === 'keep' ||
        unit.retainedForSafety ||
        unit.lowConfidence
      ) {
        // 保留原文：不产生任何正文变化；非用户明确 keep 的保留计为降级
        if (unit.brief === null || unit.retainedForSafety || unit.lowConfidence) {
          degradedUnitCount += 1;
        }
        acceptedParts += gap + unitText;
        consumed = unit.contentEndOffset;
        processedChars += span;
        retainedOriginalChars += span;
        const keptPersisted = await persistCheckpoint(`第 ${i + 1}/${units.length} 段保留原文`);
        if (keptPersisted) {
          return keptPersisted;
        }
        continue;
      }

      const sceneBrief = unit.brief;

      await stage('rewriting', `正在改写第 ${i + 1}/${units.length} 段…`, progressExtra);
      if (budgetExhausted(REFINEMENT_RESERVED_FINAL_CHECK_CALLS)) {
        flushPartial();
        return pause('budget_exhausted', '预算不足，已暂停，未处理部分保留原文');
      }

      const protectedQuotes = deriveProtectedQuotes({
        sceneBrief,
        blocks,
        startBlockIndex: unit.startBlockIndex,
        endBlockIndex: unit.endBlockIndex,
      });
      const acceptedPrefixText = (acceptedParts + gap).slice(-READ_ONLY_NEIGHBOR_CHARS);
      const readOnlyFuture = baseText.slice(
        unit.contentEndOffset,
        unit.contentEndOffset + READ_ONLY_NEIGHBOR_CHARS
      );

      // B2：只把「仍与当前候选同源」的确定状态交给下游，未确认结果不污染下游输入
      const stateFactLines = confirmedStateFactLines();
      const rewriteOutcome = await callModelWithRetry({
        templateKey: CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
        prompt: buildRewriteUserPrompt({
          instruction: snapshot.instruction,
          chapterIntent: brief.chapterIntent,
          protectedFacts: brief.protectedFacts,
          protectedQuotes,
          sceneBrief,
          policy: record.rewritePolicy,
          ...(acceptedPrefixText ? { acceptedPrefix: acceptedPrefixText } : {}),
          ...(readOnlyFuture ? { readOnlyFuture } : {}),
          ...(stateFactLines.length > 0 ? { stateFacts: stateFactLines } : {}),
          rangeText: unitText,
        }),
        // F6：按完整输入 + 预期输出做保守预算，超限即暂停而非裁剪
        desiredOutputChars: unitChars,
      });

      if (rewriteOutcome.aborted) {
        flushPartial();
        return pause('user_cancelled', '已取消');
      }
      if (rewriteOutcome.storageFailed) {
        flushPartial();
        return pause('persistence_failed', '改写调用前的进度未能持久化，已停止');
      }
      if (rewriteOutcome.budgetExhausted) {
        flushPartial();
        return pause('budget_exhausted', '预算不足，已暂停，未处理部分保留原文');
      }
      if (rewriteOutcome.contextExhausted) {
        // 完整输入/必要输出装不下：不得降级为「保留原文」放行——该范围从未被改写，
        // 必须暂停并显式处理（重新规划安全范围），而不是静默标记就绪。
        flushPartial();
        return pause(
          'context_budget',
          `第 ${i + 1} 段改写的完整输入 + 必要输出超出上下文预算，已暂停：${
            rewriteOutcome.errorMessage ?? '需重新规划安全范围'
          }`
        );
      }

      // 输出完整性失败（缺 end / length / 过滤 / 未知完成原因）：重试后仍不完整则不接受半成品，
      // 暂停并保留已接受前文与上一 checkpoint（R7：成功 end 之前连接断开）。
      if (!rewriteOutcome.ok && rewriteOutcome.completionFailure) {
        issues.push({
          id: nextIssueId(),
          category: 'hard_constraint',
          severity: 'high',
          sceneId,
          unitId: unit.unitId,
          message: `第 ${i + 1} 段改写输出未完整收束（${rewriteOutcome.completionFailure}）：${
            rewriteOutcome.errorMessage ?? '输出不完整'
          }`,
          disposition: 'unresolved',
        });
        flushPartial();
        return pause('upstream_failure', `第 ${i + 1} 段输出未完整收束，已暂停并保留已接受前文`);
      }

      if (!rewriteOutcome.ok) {
        // 上游持续失败：保留本段原文并记录，继续后续单位，不整体丢弃成果
        degradedUnitCount += 1;
        issues.push({
          id: nextIssueId(),
          category: 'coverage',
          severity: 'medium',
          sceneId,
          unitId: unit.unitId,
          message: `第 ${i + 1} 段改写上游失败，保留原文：${rewriteOutcome.errorMessage ?? '未知错误'}`,
          disposition: 'retained_original',
        });
        acceptedParts += gap + unitText;
        consumed = unit.contentEndOffset;
        processedChars += span;
        retainedOriginalChars += span;
        const failedPersisted = await persistCheckpoint(
          `第 ${i + 1}/${units.length} 段上游失败，保留原文`
        );
        if (failedPersisted) {
          return failedPersisted;
        }
        continue;
      }

      const candidateText = rewriteOutcome.text.trim();

      // 程序门禁：空输出 / 占位语 / 长度溢出 / 逐字锁
      const gate = runRefinementProgramGate({
        candidate: candidateText,
        maxChars: resolveRefinementRangeMaxChars(unitChars, policy.rewriteMaxChars),
        protectedQuotes,
      });
      if (!gate.ok) {
        degradedUnitCount += 1;
        for (const failure of gate.failures) {
          issues.push({
            id: nextIssueId(),
            category: 'hard_constraint',
            severity: 'high',
            sceneId,
            unitId: unit.unitId,
            ...(failure.anchorQuote ? { anchorQuote: failure.anchorQuote } : {}),
            message: `第 ${i + 1} 段：${failure.message}`,
            disposition: 'retained_original',
          });
        }
        await stage(
          'verifying',
          `第 ${i + 1}/${units.length} 段程序门禁未通过，保留原文`,
          progressExtra
        );
        acceptedParts += gap + unitText;
        consumed = unit.contentEndOffset;
        processedChars += span;
        retainedOriginalChars += span;
        const gatePersisted = await persistCheckpoint(
          `第 ${i + 1}/${units.length} 段程序门禁未过，保留原文`
        );
        if (gatePersisted) {
          return gatePersisted;
        }
        continue;
      }

      // review：对照原文、候选与只读后文检查；检查失败不丢弃已过门禁的正文
      await stage('verifying', `正在检查第 ${i + 1}/${units.length} 段候选与接缝…`, progressExtra);
      if (budgetExhausted(REFINEMENT_RESERVED_FINAL_CHECK_CALLS)) {
        flushPartial();
        return pause('budget_exhausted', '预算不足，已暂停，未处理部分保留原文');
      }

      // 候选稿定位信息：补修必须针对同一份候选（revision + hash）
      let unitCandidate = candidateText;
      let unitCandidateRevision = 1;
      const unitMaxChars = resolveRefinementRangeMaxChars(unitChars, policy.rewriteMaxChars);
      let locatableIssues: RefinementReviewIssue[] = [];
      // F5：本段最终确定（经核验）的散场状态事实
      let unitExitFacts: RefinementFact[] = [];

      {
        const outcome = await this.callParse({
          call: () =>
            callModel({
              templateKey: CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
              prompt: buildReviewUserPrompt({
                instruction: snapshot.instruction,
                protectedFacts: brief.protectedFacts,
                sceneBrief,
                protectedQuotes,
                rangeOriginal: unitText,
                candidate: unitCandidate,
                ...(acceptedPrefixText ? { acceptedPrefix: acceptedPrefixText } : {}),
                ...(readOnlyFuture ? { readOnlyFuture } : {}),
                ...(stateFactLines.length > 0 ? { stateFacts: stateFactLines } : {}),
              }),
              // F6：检查输出为结构化 JSON，按**合同规模**给必要输出，不照用范围正文长度
              requiredOutputTokens: REFINEMENT_STRUCTURED_OUTPUT_TOKENS,
            }),
          parse: (text) => parseReviewResult(text),
        });
        if (outcome.ok) {
          const { locatable, unlocatable } = splitReviewIssuesByLocatability(
            outcome.value,
            unitCandidate
          );
          locatableIssues = locatable;
          unitExitFacts = outcome.value.exitStateFacts;
          for (const issue of unlocatable) {
            issues.push({
              id: nextIssueId(),
              category: issue.kind,
              severity: issue.severity,
              sceneId,
              unitId: unit.unitId,
              message: issue.fixIntent || issue.expectedFact || '未定位的检查提示',
              disposition: 'warning',
            });
          }
        } else if (outcome.aborted) {
          flushPartial();
          return pause('user_cancelled', '已取消');
        } else if (outcome.budgetExhausted) {
          flushPartial();
          return pause('budget_exhausted', '预算不足，已暂停，未处理部分保留原文');
        } else {
          // F3：必要检查未完成（上游持续失败 / 输出不可解析）——不得接受未验证候选。
          // 选择暂停并保留上一 checkpoint，而不是把未检查的正文写入已接受结果。
          flushPartial();
          return this.pauseFromOutcome(outcome, pause, `第 ${i + 1} 段候选检查`);
        }
      }

      // ── 有限补修：只对可定位、有明确缺口的检查项做一次定点修复（R7/R6） ──
      // 每单位最多一次；名额先占再调用，避免 resume / 重试造成无限循环。
      let repairResolved = false;
      const repairEligible =
        shouldTriggerRepair(locatableIssues) &&
        policy.maxRepairPasses >= 1 &&
        !unitRecovery.repairedUnitIds.includes(unit.unitId);

      if (repairEligible) {
        await stage('repairing', `正在补修第 ${i + 1}/${units.length} 段…`, progressExtra);
        if (budgetExhausted(REFINEMENT_RESERVED_FINAL_CHECK_CALLS)) {
          flushPartial();
          return pause('budget_exhausted', '预算不足，已暂停，未处理部分保留原文');
        }
        unitRecovery.repairCount += 1;
        unitRecovery.repairedUnitIds.push(unit.unitId);
        const candidateHash = hashRefinementCandidate(unitCandidate);
        const gaps = locatableIssues
          .filter(
            (issue) =>
              issue.kind !== 'style' &&
              (issue.severity === 'high' || issue.severity === 'medium') &&
              issue.fixIntent.trim().length > 0
          )
          .map((issue) => [issue.expectedFact, issue.fixIntent].filter(Boolean).join(' / '));
        const repairOutcome = await callModelWithRetry({
          templateKey: CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
          prompt: buildRepairUserPrompt({
            gaps,
            protectedQuotes,
            candidateRange: unitCandidate,
            rangeOriginal: unitText,
            processFacts: unit.brief?.processFacts,
            ...(acceptedPrefixText ? { acceptedPrefix: acceptedPrefixText } : {}),
            ...(readOnlyFuture ? { readOnlyFuture } : {}),
          }),
          // F6：补修输出与候选范围相当，按完整输入 + 预期输出做预算，超限即暂停
          desiredOutputChars: unitChars,
        });

        if (repairOutcome.aborted) {
          flushPartial();
          return pause('user_cancelled', '已取消');
        }
        if (repairOutcome.storageFailed) {
          flushPartial();
          return pause('persistence_failed', '补修调用前的进度未能持久化，已停止');
        }
        if (repairOutcome.contextExhausted) {
          flushPartial();
          return pause(
            'context_budget',
            `第 ${i + 1} 段补修的完整输入 + 必要输出超出上下文预算，已暂停`
          );
        }
        if (repairOutcome.budgetExhausted) {
          flushPartial();
          return pause('budget_exhausted', '预算不足，已暂停，未处理部分保留原文');
        }

        const repairedText = repairOutcome.text.trim();
        if (!repairOutcome.ok && repairOutcome.completionFailure) {
          issues.push({
            id: nextIssueId(),
            category: 'hard_constraint',
            severity: 'high',
            sceneId,
            unitId: unit.unitId,
            candidateRevision: unitCandidateRevision,
            message: `第 ${i + 1} 段补修输出未完整收束（${repairOutcome.completionFailure}），保留补修前候选`,
            disposition: 'unresolved',
          });
        } else if (!repairOutcome.ok) {
          issues.push({
            id: nextIssueId(),
            category: 'coverage',
            severity: 'medium',
            sceneId,
            unitId: unit.unitId,
            message: `第 ${i + 1} 段补修上游失败，保留补修前候选：${repairOutcome.errorMessage ?? '未知错误'}`,
            disposition: 'warning',
          });
        } else if (hashRefinementCandidate(unitCandidate) !== candidateHash) {
          // 候选在补修期间被改写：拒绝把旧补丁应用到新文本（R6 过期修订）
          issues.push({
            id: nextIssueId(),
            category: 'hard_constraint',
            severity: 'high',
            sceneId,
            unitId: unit.unitId,
            message: `第 ${i + 1} 段补修定位失效（候选已变更），拒绝应用`,
            disposition: 'warning',
          });
        } else {
          const repairGate = runRefinementProgramGate({
            candidate: repairedText,
            maxChars: unitMaxChars,
            protectedQuotes,
          });
          if (!repairGate.ok) {
            issues.push({
              id: nextIssueId(),
              category: 'hard_constraint',
              severity: 'high',
              sceneId,
              unitId: unit.unitId,
              message: `第 ${i + 1} 段补修未通过程序门禁（${repairGate.failures
                .map((failure) => failure.code)
                .join('、')}），保留补修前候选`,
              disposition: 'warning',
            });
          } else {
            // 补修后复检：仍有可定位阻断缺口才回退该单位原文（R7）
            const recheck = await this.callParse({
              call: () =>
                callModel({
                  templateKey: CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
                  prompt: buildReviewUserPrompt({
                    instruction: snapshot.instruction,
                    protectedFacts: brief.protectedFacts,
                    sceneBrief,
                    protectedQuotes,
                    rangeOriginal: unitText,
                    candidate: repairedText,
                    ...(acceptedPrefixText ? { acceptedPrefix: acceptedPrefixText } : {}),
                    ...(readOnlyFuture ? { readOnlyFuture } : {}),
                    ...(stateFactLines.length > 0 ? { stateFacts: stateFactLines } : {}),
                  }),
                  // F6：补修后复检同样是结构化 JSON，按合同规模给必要输出
                  requiredOutputTokens: REFINEMENT_STRUCTURED_OUTPUT_TOKENS,
                }),
              parse: (text) => parseReviewResult(text),
            });
            if (!recheck.ok && recheck.aborted) {
              flushPartial();
              return pause('user_cancelled', '已取消');
            }
            if (!recheck.ok && recheck.budgetExhausted) {
              flushPartial();
              return pause('budget_exhausted', '预算不足，已暂停，未处理部分保留原文');
            }
            if (!recheck.ok) {
              // F3：补修后复检未完成——不得接受未经复检的补修稿；暂停并保留上一 checkpoint
              flushPartial();
              return this.pauseFromOutcome(recheck, pause, `第 ${i + 1} 段补修后复检`);
            }
            const recheckBlocking = shouldTriggerRepair(
              splitReviewIssuesByLocatability(recheck.value, repairedText).locatable
            );
            if (recheckBlocking) {
              // 补修仍丢必要事件：不接受补修稿，回退该单位原文
              issues.push({
                id: nextIssueId(),
                category: 'hard_constraint',
                severity: 'high',
                sceneId,
                unitId: unit.unitId,
                message: `第 ${i + 1} 段补修后仍存在可定位阻断缺口，回退该单位原文`,
                disposition: 'retained_original',
              });
              // B1：该单位候选已回退 → 此前针对旧候选版本登记的阻断显式结案
              closeSupersededIssues({
                unitId: unit.unitId,
                supersededBeforeRevision: bumpUnitCandidateRevision(unit.unitId),
                reason: `第 ${i + 1} 段已回退原文`,
              });
              // B2：回退后旧候选上的末态证据不再成立，须等复检产生新证据
              invalidateStateFactsForUnit(unit.unitId);
              degradedUnitCount += 1;
              acceptedParts += gap + unitText;
              consumed = unit.contentEndOffset;
              processedChars += span;
              retainedOriginalChars += span;
              const revertPersisted = await persistCheckpoint(
                `第 ${i + 1}/${units.length} 段回退原文`
              );
              if (revertPersisted) {
                return revertPersisted;
              }
              continue;
            }
            unitCandidate = repairedText;
            unitCandidateRevision += 1;
            unitCandidateRevisions.set(unit.unitId, unitCandidateRevision);
            // B2：候选已被补修稿取代 → 旧候选上提取的末态证据失效，改用本次复检的证据
            invalidateStateFactsForUnit(unit.unitId);
            unitExitFacts = recheck.value.exitStateFacts;
            repairResolved = true;
          }
        }
      }

      // 登记本段检查结论：补修成功的可定位缺口记为已解决，其余按严重度落 issue
      // B1：登记本段检查结论前先同步该单位的候选版本，供后续回退 / 补修结案判定。
      unitCandidateRevisions.set(unit.unitId, unitCandidateRevision);
      for (const issue of locatableIssues) {
        issues.push({
          id: nextIssueId(),
          category: issue.kind,
          severity: issue.severity,
          sceneId,
          unitId: unit.unitId,
          candidateRevision: unitCandidateRevision,
          ...(issue.anchorQuote ? { anchorQuote: issue.anchorQuote } : {}),
          message: [issue.expectedFact, issue.fixIntent].filter(Boolean).join(' / ') || issue.kind,
          disposition: repairResolved
            ? 'resolved'
            : issue.severity === 'high'
              ? 'unresolved'
              : 'warning',
        });
      }

      // F5 / B2：核验散场状态事实——区分「引文命中」与「末态成立」。
      // 只有程序能在**实际接受候选**中唯一定位、且其后没有同一状态后续变化的证据，
      // 才作为确定状态向下游传递。仅有改写前原文能命中的历史动作、重复引文、末尾对白、
      // 以及之后被后续变化取代的入场动作，一律不作为确定状态（如「入场拿着钥匙，散场放下」）。
      // 未知（value=null）不视为确定状态；凭空状态记为非阻断提示且不传播（模型提取误报，
      // 不影响已过门禁的正文，故不阻断应用）。
      for (const fact of unitExitFacts) {
        // 未知（value=null）不视为确定状态，也不向下游传递
        if (fact.value === null) {
          continue;
        }
        const verdict = verifyRefinementStateFact(fact, {
          candidate: unitCandidate,
          original: unitText,
        });
        if (verdict.status === 'evidence') {
          upsertRefinementStateFact(stateFacts, {
            key: fact.key,
            value: fact.value,
            unitId: unit.unitId,
            origin: verdict.origin,
            anchorQuote: fact.anchorQuote,
            // B2：证据绑定候选版本与 hash——候选一旦变化，旧证据必须失效
            candidateRevision: unitCandidateRevision,
            candidateHash: hashRefinementCandidate(unitCandidate),
            anchorStart: verdict.start,
            anchorEnd: verdict.end,
            basis: verdict.basis,
            sceneId,
          });
        } else {
          issues.push({
            id: nextIssueId(),
            category: 'continuity',
            severity: 'low',
            sceneId,
            unitId: unit.unitId,
            ...(fact.anchorQuote ? { anchorQuote: fact.anchorQuote } : {}),
            message:
              verdict.status === 'historical'
                ? `第 ${i + 1} 段散场状态「${fact.key}」缺少候选末尾的末态证据（仅有改写前原文证据），无法证明候选散场仍成立，已拒绝向下游传递`
                : verdict.status === 'superseded'
                  ? `第 ${i + 1} 段散场状态「${fact.key}」的证据锚点之后仍有同一状态的后续变化（${verdict.reason}），已拒绝向下游传递`
                  : verdict.status === 'ambiguous'
                    ? `第 ${i + 1} 段散场状态「${fact.key}」的末态证据不确定（${verdict.reason}），已拒绝向下游传递`
                    : `第 ${i + 1} 段散场状态「${fact.key}」在候选与原文中均无法核验（凭空状态或缺少末态证据锚点），已拒绝向下游传递`,
            disposition: 'warning',
          });
        }
      }

      // F3：本段必要 review 已完成，登记到检查覆盖账本（未完成的单位已在上面暂停，不会到达这里）
      if (!reviewedUnitIds.includes(unit.unitId)) {
        reviewedUnitIds.push(unit.unitId);
      }

      // 接受本段候选：按冻结原文偏移登记替换，前序长度变化不影响本段定位
      replacements.push({
        startOffset: unit.startOffset,
        endOffset: unit.contentEndOffset,
        replacement: unitCandidate,
      });
      acceptedRangeRecords.push({
        sceneId,
        unitId: unit.unitId,
        original: unitText,
        candidate: unitCandidate,
        protectedQuotes,
        maxChars: unitMaxChars,
        startOffset: unit.startOffset,
        endOffset: unit.contentEndOffset,
      });
      changes.push({
        sceneId,
        startOffset: unit.startOffset,
        endOffset: unit.contentEndOffset,
        summary:
          sceneBrief.expectedChange ||
          sceneBrief.editIntent ||
          (unitCandidateRevision > 1 ? '范围改写＋补修' : '范围改写'),
      });
      acceptedParts += gap + unitCandidate;
      consumed = unit.contentEndOffset;
      processedChars += span;

      // F1：单位接受后立即提交 checkpoint（含已接受前缀、变更、状态事实与续跑计划），
      // 进程重启 / 取消后可从上一个已接受单位恢复，不丢已接受稿。
      const acceptedPersisted = await persistCheckpoint(`已接受第 ${i + 1}/${units.length} 段候选`);
      if (acceptedPersisted) {
        return acceptedPersisted;
      }
    }

    // ── 按原文偏移合并完整候选：未命中区间与分隔串逐码元保留 ───────────
    // C1：此后 acceptedDraft 成为权威来源，checkpoint 不得再用 acceptedParts 重新派生
    finalCandidateAssembled = true;
    acceptedDraft =
      replacements.length > 0 ? assembleRefinementCandidate({ baseText, replacements }) : baseText;

    // ── 最终整章检查（R7/R11、design D7/D8） ─────────────────────────
    // 程序先校验整章覆盖与逐字锁；再对已改写范围连同相邻接缝做一次模型复核；
    // 发现已接受范围自身存在可定位阻断缺口时，最多一轮定位修复并重检（R7）。
    // 未完成最终检查不得标记 ready / ready_with_issues（R11），因此检查调用失败即暂停。
    if (acceptedRangeRecords.length > 0) {
      await stage('verifying', '正在执行整章最终检查…');

      if (plannedChars !== baseText.length) {
        issues.push({
          id: nextIssueId(),
          category: 'coverage',
          severity: 'high',
          message: `最终检查：计划覆盖 ${plannedChars} 字与原文 ${baseText.length} 字不一致`,
          disposition: 'unresolved',
        });
      }
      const finalLockQuotes = Array.from(
        new Set(acceptedRangeRecords.flatMap((record) => record.protectedQuotes))
      );
      for (const quote of finalLockQuotes) {
        if (!acceptedDraft.includes(quote)) {
          issues.push({
            id: nextIssueId(),
            category: 'hard_constraint',
            severity: 'high',
            anchorQuote: quote,
            message: '最终检查：整章候选丢失逐字锁内容',
            disposition: 'retained_original',
          });
        }
      }

      if (budgetExhausted()) {
        return pause('budget_exhausted', '预算不足，无法完成整章最终检查，已暂停');
      }

      // 已改写范围在整章候选中的实际位置：给模型提供真实接缝上下文。
      // C1：已回退范围不再在候选里（其候选文本已不成立），跳过以保持其余范围定位准确。
      const computeSeamStarts = (): number[] => {
        const starts: number[] = new Array(acceptedRangeRecords.length).fill(0);
        let cursorPos = 0;
        acceptedRangeRecords.forEach((record, index) => {
          if (revertedRanges.has(index)) {
            starts[index] = cursorPos;
            return;
          }
          const pos = acceptedDraft.indexOf(record.candidate, cursorPos);
          const start = pos >= 0 ? pos : cursorPos;
          starts[index] = start;
          if (pos >= 0) {
            cursorPos = pos + record.candidate.length;
          }
        });
        return starts;
      };
      const buildSeamRange = (
        index: number,
        candidate: string,
        seamStarts?: number[]
      ): RefinementSeamRange => {
        const record = acceptedRangeRecords[index];
        const starts = seamStarts ?? computeSeamStarts();
        const start = starts[index] ?? 0;
        return {
          sceneId: record.sceneId,
          original: record.original,
          candidate,
          prefix: acceptedDraft.slice(Math.max(0, start - READ_ONLY_NEIGHBOR_CHARS), start),
          suffix: acceptedDraft.slice(
            start + candidate.length,
            start + candidate.length + READ_ONLY_NEIGHBOR_CHARS
          ),
          processFacts: units.find((unit) => unit.unitId === record.unitId)?.brief?.processFacts,
        };
      };

      // F6/F3：按字符预算分组做最终检查，保证大章也能逐组覆盖，并逐组登记覆盖完成记录。
      // 检查以「当前实际拼接结果」为准；任一分组检查未完成即暂停（不得把未完整检查的结果标记成功）。
      const runFinalSeamCheck = async (
        indices: number[]
      ): Promise<
        | { ok: true; issues: RefinementReviewIssue[] }
        | { ok: false; result: RefinementEngineResult }
      > => {
        if (indices.length === 0) {
          return { ok: true, issues: [] };
        }
        const seamStarts = computeSeamStarts();
        // F6：分组预算必须覆盖**完整最终消息**——除范围原文/候选外，还要计入每个范围两侧的只读邻文，
        // 以及所有分组共享的任务模板 / 项目 system prompt / 冻结参考材料 / instruction / 整章意图 / 保护事实。
        // 否则大章会低估单组真实输入，放行超出上下文预算的调用。
        const finalSeamSharedChars =
          templateText(CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY).length +
          snapshot.systemPromptText.length +
          (snapshot.referenceMaterials?.promptText.length ?? 0) +
          snapshot.instruction.length +
          brief.chapterIntent.length +
          brief.protectedFacts.reduce(
            (sum, fact) =>
              sum + fact.key.length + (typeof fact.value === 'string' ? fact.value.length : 0),
            0
          );
        const finalSeamRangeOverheadChars = READ_ONLY_NEIGHBOR_CHARS * 2;
        const groups = groupRefinementRangesByBudget(
          indices,
          (index) =>
            acceptedRangeRecords[index].original.length +
            acceptedRangeRecords[index].candidate.length +
            JSON.stringify(
              buildSeamRange(index, acceptedRangeRecords[index].candidate, seamStarts)
                .processFacts ?? []
            ).length +
            finalSeamRangeOverheadChars,
          Math.max(1, REFINEMENT_FINAL_CHECK_GROUP_CHARS - finalSeamSharedChars)
        );
        const collected: RefinementReviewIssue[] = [];
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          if (budgetExhausted()) {
            return {
              ok: false,
              result: pause('budget_exhausted', '预算不足，无法完成整章最终检查，已暂停'),
            };
          }
          if (groups.length > 1) {
            await stage(
              'verifying',
              `正在执行整章最终检查（第 ${groupIndex + 1}/${groups.length} 组）…`
            );
          }
          const group = groups[groupIndex];
          const outcome = await this.callParse({
            call: () =>
              callModel({
                templateKey: CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
                prompt: buildFinalSeamReviewUserPrompt({
                  instruction: snapshot.instruction,
                  chapterIntent: brief.chapterIntent,
                  protectedFacts: brief.protectedFacts,
                  ranges: group.map((index) =>
                    buildSeamRange(index, acceptedRangeRecords[index].candidate, seamStarts)
                  ),
                }),
                // F6：整章最终检查输出为结构化 JSON，按合同规模给必要输出
                requiredOutputTokens: REFINEMENT_STRUCTURED_OUTPUT_TOKENS,
              }),
            parse: (text) => parseReviewResult(text),
          });
          if (!outcome.ok) {
            return { ok: false, result: this.pauseFromOutcome(outcome, pause, '整章最终检查') };
          }
          collected.push(...outcome.value.issues);
          for (const index of group) {
            const unitId = acceptedRangeRecords[index].unitId;
            if (!finalCheckCoveredUnitIds.includes(unitId)) {
              finalCheckCoveredUnitIds.push(unitId);
            }
          }
        }
        return { ok: true, issues: collected };
      };

      // 定位：引文必须在**唯一一个**已改写范围候选中逐字出现，才可自动修复
      const locateRange = (issue: RefinementReviewIssue): number => {
        const quote = issue.anchorQuote.trim();
        if (!quote) {
          return -1;
        }
        const hits = acceptedRangeRecords
          .map((record, index) => (record.candidate.includes(quote) ? index : -1))
          .filter((index) => index >= 0);
        return hits.length === 1 ? hits[0] : -1;
      };

      // F3：被回退的范围（candidate 不再成立）。回退后其旧检查失效，且不再参与重检。
      // （revertedRanges 在函数顶部声明，供 buildCheckpoint/buildResumeState 保持同步。）
      const dropCoveredUnit = (unitId: string): void => {
        const at = finalCheckCoveredUnitIds.indexOf(unitId);
        if (at >= 0) {
          finalCheckCoveredUnitIds.splice(at, 1);
        }
      };
      const revertRange = (index: number, message: string, touched: Set<number>): void => {
        if (revertedRanges.has(index)) {
          return;
        }
        revertedRanges.add(index);
        touched.add(index);
        const record = acceptedRangeRecords[index];
        degradedUnitCount += 1;
        retainedOriginalChars += Math.max(0, record.endOffset - record.startOffset);
        dropCoveredUnit(record.unitId);
        issues.push({
          id: nextIssueId(),
          category: 'hard_constraint',
          severity: 'high',
          sceneId: record.sceneId,
          unitId: record.unitId,
          message,
          disposition: 'retained_original',
        });
        // B1：该范围候选已回退为原文 → 此前针对旧候选版本登记的阻断显式结案。
        // 只有同一单位且版本更早的问题才会结案；全章 / 跨范围阻断（无 unitId）不受影响。
        closeSupersededIssues({
          unitId: record.unitId,
          supersededBeforeRevision: bumpUnitCandidateRevision(record.unitId),
          reason: `范围 ${record.unitId} 已回退原文`,
        });
        // B2：范围回退为原文 → 该范围候选上的末态证据失效，不得继续向下游传播
        invalidateStateFactsForUnit(record.unitId);
      };
      /** 仅保留未被回退的替换重建整章候选（不登记进 replacements，避免索引漂移）。 */
      const rebuildAcceptedDraft = (): void => {
        const active = replacements.filter((_, index) => !revertedRanges.has(index));
        acceptedDraft =
          active.length > 0
            ? assembleRefinementCandidate({ baseText, replacements: active })
            : baseText;
      };
      /** 受影响范围及其相邻接缝（用于回退 / 修复后重检新接缝）。 */
      const expandNeighborhood = (touched: Set<number>): number[] => {
        const out = new Set<number>();
        for (const index of touched) {
          for (const neighbor of [index - 1, index, index + 1]) {
            if (
              neighbor >= 0 &&
              neighbor < acceptedRangeRecords.length &&
              !revertedRanges.has(neighbor)
            ) {
              out.add(neighbor);
            }
          }
        }
        return [...out].sort((a, b) => a - b);
      };

      // F3：最终候选任何修复或回退后旧检查失效 → 按最终实际拼接结果重检相邻接缝。
      // 第一轮允许一次定位修复（R7）；修复/回退后的重检若仍有阻断则暂停（不得把冲突稿标为 ready）。
      let checkIndices = acceptedRangeRecords.map((_, index) => index);
      let finalRound = 0;
      while (checkIndices.length > 0) {
        finalRound += 1;
        const checked = await runFinalSeamCheck(checkIndices);
        if (!checked.ok) {
          return checked.result;
        }

        const finalBlocking = new Map<number, RefinementReviewIssue[]>();
        /**
         * C1：带修复意图的高/中危缺口若**无法定位到单一活动候选**（引文落在已回退正文、
         * 跨范围或已回退候选上），不能自动修复，也绝不能因无法定位就降级为提示——
         * 那会把「回退正文 / 真实接缝上的阻断」伪装成可应用。此处单独收集，随后暂停。
         */
        const unlocatableBlocking: RefinementReviewIssue[] = [];
        for (const issue of checked.issues) {
          const index = locateRange(issue);
          const blockingIntent =
            issue.kind !== 'style' &&
            (issue.severity === 'high' || issue.severity === 'medium') &&
            issue.fixIntent.trim().length > 0;
          const locatable = index >= 0 && !revertedRanges.has(index);
          if (blockingIntent && !locatable) {
            unlocatableBlocking.push(issue);
            continue;
          }
          if (!(blockingIntent && locatable)) {
            issues.push({
              id: nextIssueId(),
              category: issue.kind,
              severity: issue.severity,
              ...(index >= 0 ? { sceneId: acceptedRangeRecords[index].sceneId } : {}),
              ...(issue.anchorQuote ? { anchorQuote: issue.anchorQuote } : {}),
              message: `整章最终检查：${issue.fixIntent || issue.expectedFact || issue.kind}`,
              disposition: 'warning',
            });
            continue;
          }
          const list = finalBlocking.get(index) ?? [];
          list.push(issue);
          finalBlocking.set(index, list);
        }

        if (unlocatableBlocking.length > 0) {
          for (const issue of unlocatableBlocking) {
            issues.push({
              id: nextIssueId(),
              category: issue.kind,
              severity: issue.severity,
              ...(issue.anchorQuote ? { anchorQuote: issue.anchorQuote } : {}),
              message: `整章最终检查：${issue.fixIntent || issue.expectedFact || issue.kind}（无法定位到单一活动候选）`,
              disposition: 'unresolved',
            });
          }
          return pause(
            'boundary_conflict',
            '整章最终检查发现无法定位到单一活动候选的阻断缺口（回退正文或跨范围接缝），已暂停，候选不可应用'
          );
        }

        if (finalBlocking.size === 0) {
          finalCheckCompleted = true;
          break;
        }
        if (finalRound > 1) {
          // 已完成一轮修复/回退后重检仍有阻断：不再自动修复，暂停，候选不可应用（R7/R11）
          return pause(
            'boundary_conflict',
            '整章最终接缝在修复/回退后重检仍存在阻断缺口，已暂停，候选不可应用'
          );
        }

        const touched = new Set<number>();
        // 最终接缝最多一轮定位修复（R7）。名额用尽或预算不足时直接回退原文，绝不把冲突稿标为 ready。
        if (unitRecovery.seamRepairCount < 1 && !budgetExhausted()) {
          unitRecovery.seamRepairCount += 1;
          await stage('repairing', '正在修复整章最终接缝…');
          for (const [index, list] of finalBlocking) {
            if (revertedRanges.has(index)) {
              continue;
            }
            const record = acceptedRangeRecords[index];
            if (budgetExhausted()) {
              revertRange(index, '整章最终接缝修复预算不足，回退该范围原文', touched);
              continue;
            }
            const gaps = list.map((issue) =>
              [issue.expectedFact, issue.fixIntent].filter(Boolean).join(' / ')
            );
            const repairOutcome = await callModelWithRetry({
              templateKey: CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
              prompt: buildRepairUserPrompt({
                gaps,
                protectedQuotes: record.protectedQuotes,
                candidateRange: record.candidate,
                rangeOriginal: record.original,
                processFacts: units.find((unit) => unit.unitId === record.unitId)?.brief
                  ?.processFacts,
                acceptedPrefix: acceptedDraft.slice(
                  Math.max(0, record.startOffset - READ_ONLY_NEIGHBOR_CHARS),
                  record.startOffset
                ),
                readOnlyFuture: baseText.slice(
                  record.endOffset,
                  record.endOffset + READ_ONLY_NEIGHBOR_CHARS
                ),
              }),
              // F6：整章最终接缝补修输出与范围原文相当，按完整输入 + 预期输出做预算
              desiredOutputChars: record.original.length,
            });
            if (repairOutcome.aborted) {
              return pause('user_cancelled', '已取消');
            }
            if (repairOutcome.storageFailed) {
              return pause('persistence_failed', '整章最终接缝修复前的进度未能持久化，已停止');
            }
            if (repairOutcome.contextExhausted) {
              return pause(
                'context_budget',
                '整章最终接缝修复的完整输入 + 必要输出超出上下文预算，已暂停'
              );
            }
            if (repairOutcome.budgetExhausted) {
              return pause('budget_exhausted', '预算不足，无法完成整章最终接缝修复，已暂停');
            }
            const repairedText = repairOutcome.text.trim();
            const repairGate =
              repairOutcome.ok && repairedText
                ? runRefinementProgramGate({
                    candidate: repairedText,
                    maxChars: record.maxChars,
                    protectedQuotes: record.protectedQuotes,
                  })
                : null;
            if (!repairGate?.ok) {
              revertRange(index, '整章最终接缝修复未通过程序门禁，回退该范围原文', touched);
              continue;
            }
            const recheck = await this.callParse({
              call: () =>
                callModel({
                  templateKey: CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
                  prompt: buildFinalSeamReviewUserPrompt({
                    instruction: snapshot.instruction,
                    chapterIntent: brief.chapterIntent,
                    protectedFacts: brief.protectedFacts,
                    ranges: [buildSeamRange(index, repairedText)],
                  }),
                  // F6：接缝复检输出为结构化 JSON，按合同规模给必要输出
                  requiredOutputTokens: REFINEMENT_STRUCTURED_OUTPUT_TOKENS,
                }),
              parse: (text) => parseReviewResult(text),
            });
            if (!recheck.ok) {
              // 复检调用本身未完成（保存失败 / 预算 / 上下文 / 上游）：必须暂停——
              // 不得把它当成「修复后仍有阻断」回退后继续到可应用终态（保存失败时名额
              // 与用量尚未落库，继续执行会丢账）。
              return this.pauseFromOutcome(recheck, pause, '整章最终接缝修复后复检');
            }
            const recheckBlocking = recheck.value.issues.some(
              (issue) =>
                issue.kind !== 'style' &&
                (issue.severity === 'high' || issue.severity === 'medium') &&
                issue.fixIntent.trim().length > 0
            );
            if (recheckBlocking) {
              revertRange(index, '整章最终接缝修复后仍有阻断缺口，回退该范围原文', touched);
              continue;
            }
            // 接受修复稿：更新替换文本与范围候选。candidate 已变 → 旧检查失效，纳入重检。
            const replacement = replacements[index];
            replacement.replacement = repairedText;
            record.candidate = repairedText;
            touched.add(index);
            dropCoveredUnit(record.unitId);
            issues.push({
              id: nextIssueId(),
              category: 'continuity',
              severity: 'medium',
              sceneId: record.sceneId,
              unitId: record.unitId,
              message: '整章最终接缝修复已接受',
              disposition: 'resolved',
            });
            // B1：补修稿已通过复检并取代旧候选 → 此前针对旧候选版本登记的阻断显式结案。
            // 复检是对该范围原文 + 新候选的完整复核，通过即表示旧候选中登记的缺口已消解。
            closeSupersededIssues({
              unitId: record.unitId,
              supersededBeforeRevision: bumpUnitCandidateRevision(record.unitId),
              reason: '整章最终接缝补修稿已通过复检并取代旧候选',
            });
          }
        } else {
          for (const index of finalBlocking.keys()) {
            revertRange(index, '整章最终接缝修复名额或预算不足，回退该范围原文', touched);
          }
        }

        // 应用回退 / 修复结果并重建整章候选；随后仅重检受影响范围及其相邻接缝
        rebuildAcceptedDraft();
        checkIndices = expandNeighborhood(touched);
      }

      // 循环仅因重检队列为空而结束（全部相邻范围已回退）时：确认所有仍生效的已改写范围
      // 都已被检查覆盖，再标记检查完成；否则暂停。
      if (!finalCheckCompleted) {
        const activeUnits = acceptedRangeRecords
          .filter((_, index) => !revertedRanges.has(index))
          .map((record) => record.unitId);
        const allCovered = activeUnits.every((unitId) => finalCheckCoveredUnitIds.includes(unitId));
        if (!allCovered) {
          return pause('upstream_failure', '整章最终检查未覆盖全部已改写范围，已暂停');
        }
        finalCheckCompleted = true;
      }
      // B1：覆盖完整性已在回退索引清空前校验通过，供终态判定复用。
      finalCheckCoverageVerified = true;

      // 把被回退范围从替换 / 变更清单中剔除，保持与最终候选一致。
      // C1：剔除后必须清空 revertedRanges——它记录的是「剔除前」的索引，继续用于后续
      // 过滤会把已保留的条目再次误删（checkpoint/resume 会与最终正文不一致）。
      if (revertedRanges.size > 0) {
        const keptReplacements = replacements.filter((_, index) => !revertedRanges.has(index));
        replacements.length = 0;
        replacements.push(...keptReplacements);
        const keptChanges = changes.filter((_, index) => !revertedRanges.has(index));
        changes.length = 0;
        changes.push(...keptChanges);
        revertedRanges.clear();
      }
    }

    // B1：终态资格统一由 evaluateTerminalEligibility 判定（检查完成 + 覆盖完整 + 问题处置）。
    // 正常完成与续跑完成共用同一口径，缺失任何一项都必须暂停而不是进入可应用终态。
    const terminalBlocked = evaluateTerminalEligibility();
    if (terminalBlocked) {
      return terminalBlocked;
    }

    const hasBlockingIssues = issues.some(
      (issue) =>
        issue.disposition === 'unresolved' ||
        issue.disposition === 'retained_original' ||
        ((issue.severity === 'high' || issue.severity === 'medium') &&
          issue.disposition !== 'resolved')
    );
    const status: RefinementEngineTerminalStatus =
      degradedUnitCount > 0 || hasBlockingIssues ? 'ready_with_issues' : 'ready';

    await stage('finished', '整章候选已就绪', { unitIndex: units.length, unitTotal: units.length });

    return settle(
      status,
      status === 'ready' ? '整章候选已就绪' : '整章候选已就绪（含提示或保留原文）'
    );
  }

  // ── 内部：续跑还原（5.1） ───────────────────────────────────────────

  /**
   * 从 checkpoint 还原已接受前缀：重放已处理单位重建 acceptedParts / consumed，
   * 并复原补修/最终接缝检查所需的已接受范围记录（可确定性重算，不持久化）。
   */
  private restoreResumeState(input: {
    resumeState: RefinementResumeState;
    baseText: string;
    blocks: RefinementSourceBlock[];
    policy: RefinementResolvedPolicy;
  }): {
    replacements: RefinementReplacement[];
    acceptedRanges: RefinementAcceptedRangeRecord[];
    acceptedParts: string;
    consumed: number;
  } {
    const { resumeState, baseText, blocks, policy } = input;
    const replacements = resumeState.replacements.map((item) => ({ ...item }));
    const replacementByStart = new Map(replacements.map((item) => [item.startOffset, item]));
    const acceptedRanges: RefinementAcceptedRangeRecord[] = [];
    let acceptedParts = '';
    let consumed = 0;
    for (let index = 0; index < resumeState.nextUnitIndex; index += 1) {
      const unit = resumeState.units[index];
      if (!unit) {
        break;
      }
      const gap = baseText.slice(consumed, unit.startOffset);
      const unitText = baseText.slice(unit.startOffset, unit.contentEndOffset);
      const replacement = replacementByStart.get(unit.startOffset);
      if (!replacement) {
        acceptedParts += gap + unitText;
        consumed = unit.contentEndOffset;
        continue;
      }
      acceptedRanges.push({
        sceneId: unit.sceneId,
        unitId: unit.unitId,
        original: unitText,
        candidate: replacement.replacement,
        protectedQuotes: unit.brief
          ? deriveProtectedQuotes({
              sceneBrief: unit.brief,
              blocks,
              startBlockIndex: unit.startBlockIndex,
              endBlockIndex: unit.endBlockIndex,
            })
          : [],
        maxChars: resolveRefinementRangeMaxChars(unitText.length, policy.rewriteMaxChars),
        startOffset: unit.startOffset,
        endOffset: unit.contentEndOffset,
      });
      acceptedParts += gap + replacement.replacement;
      consumed = unit.contentEndOffset;
    }
    return { replacements, acceptedRanges, acceptedParts, consumed };
  }

  // ── 内部：调用 + 解析（失败重试一次） ───────────────────────────────

  private async callParse<T>(args: {
    call: (contractError?: string) => Promise<ModelCallOutcome>;
    parse: (text: string) => T;
  }): Promise<
    | { ok: true; value: T }
    | {
        ok: false;
        aborted: boolean;
        errorMessage?: string;
        parseFailed?: boolean;
        completionFailure?: RefinementCompletionFailureKind;
        /** F6：预算在发起前被拒绝 / 单次调用超时中止——不得再重试 */
        budgetExhausted?: boolean;
        /** F6：完整输入 + 必要输出装不下上下文 / 模型能力未知——不得再重试 */
        contextExhausted?: boolean;
        /** F1：发起前未能确认 checkpoint 落库——不得继续 */
        storageFailed?: boolean;
      }
  > {
    let lastError: string | undefined;
    let parseFailed = false;
    let contractError: string | undefined;
    let completionFailure: RefinementCompletionFailureKind | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await args.call(contractError);
      contractError = undefined;
      if (!outcome.ok) {
        if (outcome.aborted) {
          return { ok: false, aborted: true, errorMessage: outcome.errorMessage };
        }
        // F6：上下文装不下 / 模型能力未知不会因重试恢复，直接上抛
        if (outcome.contextExhausted) {
          return {
            ok: false,
            aborted: false,
            contextExhausted: true,
            errorMessage: outcome.errorMessage ?? '完整输入超出上下文预算',
          };
        }
        // F1：checkpoint 未能落库——必须停止，不得以未持久化的名额继续
        if (outcome.storageFailed) {
          return {
            ok: false,
            aborted: false,
            storageFailed: true,
            errorMessage: outcome.errorMessage ?? '进度未能持久化',
          };
        }
        // F6：预算耗尽不会因重试恢复，直接上抛，交由调用点按 budget_exhausted 暂停
        if (outcome.budgetExhausted) {
          return {
            ok: false,
            aborted: false,
            budgetExhausted: true,
            errorMessage: outcome.errorMessage ?? '本次尝试预算已用尽',
          };
        }
        // 严格完成判定：非空内容但未正常收束（缺 end / length / 过滤 / 未知）不算成功，
        // 记录类别后仍允许重试一次；重试后仍不完整则按上游失败暂停。
        if (outcome.completionFailure) {
          completionFailure = outcome.completionFailure;
        }
        lastError = outcome.errorMessage ?? '上游生成失败';
        continue;
      }
      try {
        return { ok: true, value: args.parse(outcome.text) };
      } catch (error) {
        parseFailed = true;
        lastError =
          error instanceof RefinementModelOutputError
            ? error.message
            : error instanceof Error
              ? error.message
              : '模型输出解析失败';
        contractError = lastError;
      }
    }
    return {
      ok: false,
      aborted: false,
      errorMessage: lastError,
      parseFailed,
      ...(completionFailure ? { completionFailure } : {}),
    };
  }

  private pauseFromOutcome(
    outcome: {
      aborted: boolean;
      errorMessage?: string;
      parseFailed?: boolean;
      completionFailure?: RefinementCompletionFailureKind;
      budgetExhausted?: boolean;
      contextExhausted?: boolean;
      storageFailed?: boolean;
    },
    pause: (reason: RefinementPauseReason, message: string) => RefinementEngineResult,
    stageLabel: string
  ): RefinementEngineResult {
    if (outcome.aborted) {
      return pause('user_cancelled', '已取消');
    }
    if (outcome.storageFailed) {
      return pause(
        'persistence_failed',
        `${stageLabel}前的进度未能持久化，已停止：${outcome.errorMessage ?? '未知存储错误'}`
      );
    }
    if (outcome.contextExhausted) {
      return pause(
        'context_budget',
        `${stageLabel}的完整输入 + 必要输出超出上下文预算，已暂停：${
          outcome.errorMessage ?? '需重新规划安全范围'
        }`
      );
    }
    if (outcome.budgetExhausted) {
      return pause('budget_exhausted', `预算不足，无法完成${stageLabel}，已暂停`);
    }
    if (outcome.completionFailure) {
      return pause(
        'upstream_failure',
        `${stageLabel}输出未完整收束（${outcome.completionFailure}），已暂停：${
          outcome.errorMessage ?? '输出不完整'
        }`
      );
    }
    if (outcome.parseFailed) {
      const detail = outcome.errorMessage?.trim().slice(0, 1200) || '未通过输出合同校验';
      return pause('invalid_model_output', `${stageLabel}模型输出不可用，已暂停：${detail}`);
    }
    return pause(
      'upstream_failure',
      `${stageLabel}上游模型失败：${outcome.errorMessage ?? '未知错误'}`
    );
  }
}

/** F5：把已确认（有证据）的状态事实格式化为 prompt 行，供后续单位承接。 */
function formatRefinementStateFacts(facts: readonly RefinementStateFact[]): string[] {
  return facts.map(
    (fact) => `- ${fact.key} = ${fact.value}（证据：${fact.anchorQuote || fact.unitId}）`
  );
}

/** F5：按 key upsert 状态事实，后出现的确定状态覆盖先前值（体现状态演进）。 */
function upsertRefinementStateFact(facts: RefinementStateFact[], next: RefinementStateFact): void {
  const index = facts.findIndex((fact) => fact.key === next.key);
  if (index >= 0) {
    facts[index] = next;
  } else {
    facts.push(next);
  }
}

function summarizeChapterBrief(brief: RefinementBrief): string {
  const lines = brief.sceneBriefs.map(
    (item) =>
      `- ${item.sceneId}：${item.decision}（${item.expectedChange || item.editIntent || '无说明'}）`
  );
  return [`本章意图：${brief.chapterIntent || '（未提供）'}`, ...lines].join('\n');
}
