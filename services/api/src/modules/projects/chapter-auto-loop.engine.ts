/**
 * 章节自动优化循环引擎（openspec: add-chapter-auto-optimize-loop）
 *
 * 一轮 = 复诊（1 次 LLM）→ 逐段局部改写（N 次 LLM，N = 命中段数）→ 分层闸门。
 *
 * LLM 调用以依赖注入形式传入，使引擎可用 stub 完整测试；
 * 服务层只负责把 deps 接到 orchestrator 与提示拼装上。
 */

import {
  applyParagraphReplacements,
  carryDeferredItems,
  extractAutoLoopWindowTail,
  isDeleteOnlyTarget,
  parseAutoLoopPlanItems,
  extractAutoLoopFollowingText,
  extractAutoLoopPrecedingText,
  renderIndexedParagraphs,
  selectAutoLoopTargets,
  shouldContinueAutoLoop,
  splitAutoLoopCharWindows,
  splitIndexedParagraphs,
  stitchAutoLoopCharWindows,
  validateAutoLoopRound,
  validateAutoLoopSegment,
} from './chapter-auto-loop.util';
import type {
  AutoLoopCharWindow,
  AutoLoopTarget,
  ChapterAutoLoopItem,
  ParagraphReplacement,
} from './chapter-auto-loop.util';

export interface AutoLoopDiagnoseInput {
  roundIndex: number;
  roundBudget: number;
  /** 本轮诊断对象：第 1 轮为入库原文，第 2 轮起为上一轮成稿 */
  currentDraft: string;
  /** 带 [n] 编号的正文，供模型照抄编号 */
  indexedBody: string;
  /** 上一轮条目及其最终状态；首轮为空 */
  previousItems: ChapterAutoLoopItem[];
  /** 0 = 本轮首次复诊；>0 = 因上次输出无法解析而重试 */
  retryCount?: number;
  /** 上一窗成稿末尾，只读衔接 */
  previousWindowTail?: string;
}

export interface AutoLoopRewriteInput {
  roundIndex: number;
  paragraphIndex: number;
  originalParagraph: string;
  previousParagraph?: string;
  nextParagraph?: string;
  precedingText?: string;
  followingText?: string;
  items: ChapterAutoLoopItem[];
}

export interface AutoLoopEngineDeps {
  diagnose(input: AutoLoopDiagnoseInput): Promise<string>;
  rewriteSegment(input: AutoLoopRewriteInput): Promise<string>;
  isAborted(): boolean;
}

export type AutoLoopEngineEvent =
  | {
      type: 'window_start';
      windowIndex: number;
      windowTotal: number;
    }
  | {
      type: 'round_start';
      roundIndex: number;
      roundBudget: number;
      paragraphCount: number;
      windowIndex?: number;
      windowTotal?: number;
    }
  | {
      type: 'plan_items';
      roundIndex: number;
      items: ChapterAutoLoopItem[];
      targetCount: number;
      unlocatableCount: number;
      deferredCount: number;
      discardedCount: number;
      windowIndex?: number;
      windowTotal?: number;
    }
  | {
      type: 'segment_start';
      roundIndex: number;
      paragraphIndex: number;
      segmentIndex: number;
      segmentTotal: number;
      windowIndex?: number;
      windowTotal?: number;
    }
  | {
      type: 'item_status';
      roundIndex: number;
      item: ChapterAutoLoopItem;
      windowIndex?: number;
      windowTotal?: number;
    }
  | {
      type: 'round_end';
      roundIndex: number;
      round: AutoLoopRoundResult;
      windowIndex?: number;
      windowTotal?: number;
    };

export interface AutoLoopRoundResult {
  roundIndex: number;
  /** 本轮成稿；整轮回滚时为上一轮成稿 */
  draft: string;
  items: ChapterAutoLoopItem[];
  appliedCount: number;
  rolledBackCount: number;
  unlocatableCount: number;
  deferredCount: number;
  discardedCount: number;
  /** 本轮未产出 high 条目 */
  converged: boolean;
  /** 章级闸门越界导致整轮回滚 */
  rolledBack: boolean;
  rollbackReason?: string;
  /** 多窗时与 roundIndex 一起构成轮次身份；单窗可省略 */
  windowIndex?: number;
  windowTotal?: number;
  /** 本轮诊断调用的实验室快照 */
  promptLabCallId?: string;
}

export type AutoLoopStoppedReason =
  | 'converged'
  | 'budget'
  | 'aborted'
  | 'round_rolled_back'
  | 'plan_parse_failed';

export interface AutoLoopResult {
  finalDraft: string;
  rounds: AutoLoopRoundResult[];
  stoppedReason: AutoLoopStoppedReason;
  /** 复诊输出无法解析时的原始文本片段，便于排障 */
  planParseFailureSample?: string;
  /** 失败或中断后可从这里续跑；正常收工时为空 */
  resume?: AutoLoopResumeState;
}

export type AutoLoopResumeStage = 'diagnose' | 'rewrite';

export interface AutoLoopRewriteCheckpoint {
  roundIndex: number;
  currentDraft: string;
  previousItems: ChapterAutoLoopItem[];
  diagnosisItems: ChapterAutoLoopItem[];
  pendingItems: ChapterAutoLoopItem[];
  remainingTargets: AutoLoopTarget[];
  replacements: ParagraphReplacement[];
  settledItems: ChapterAutoLoopItem[];
  discardedCount: number;
  unlocatableCount: number;
  deferredCount: number;
  nextSegmentIndex: number;
  segmentTotal: number;
}

export interface AutoLoopWindowPack {
  windowIndex: number;
  windowTotal: number;
  completedWindowDrafts: string[];
  windows: AutoLoopCharWindow[];
  /** 已结束窗的轮次时间线（不含当前窗内层 completedRounds） */
  timelineRounds?: AutoLoopRoundResult[];
}

export interface AutoLoopResumeState {
  completedRounds: AutoLoopRoundResult[];
  currentDraft: string;
  previousItems: ChapterAutoLoopItem[];
  startRoundIndex: number;
  rewriteCheckpoint?: AutoLoopRewriteCheckpoint;
  windowPack?: AutoLoopWindowPack;
}

export interface AutoLoopResumeSummary {
  resumable: boolean;
  resumeStage?: AutoLoopResumeStage;
  resumeRoundIndex?: number;
  resumeSegmentIndex?: number;
  resumeSegmentTotal?: number;
  inProgressItems?: ChapterAutoLoopItem[];
  resumeWindowIndex?: number;
  resumeWindowTotal?: number;
}

export function summarizeAutoLoopResume(
  resume: AutoLoopResumeState | undefined
): AutoLoopResumeSummary {
  if (!resume) {
    return { resumable: false };
  }
  const windowTotal = resume.windowPack?.windowTotal ?? 0;
  const windowFields =
    windowTotal > 1
      ? {
          resumeWindowIndex: resume.windowPack?.windowIndex,
          resumeWindowTotal: windowTotal,
        }
      : {};
  const checkpoint = resume.rewriteCheckpoint;
  if (checkpoint && checkpoint.remainingTargets.length > 0) {
    return {
      resumable: true,
      resumeStage: 'rewrite',
      resumeRoundIndex: checkpoint.roundIndex,
      resumeSegmentIndex: checkpoint.nextSegmentIndex,
      resumeSegmentTotal: checkpoint.segmentTotal,
      inProgressItems: checkpoint.pendingItems,
      ...windowFields,
    };
  }
  return {
    resumable: true,
    resumeStage: 'diagnose',
    resumeRoundIndex: resume.startRoundIndex,
    inProgressItems: checkpoint?.pendingItems,
    ...windowFields,
  };
}

/** 旧会话没有 checkpoint 时，仍可从「已完成轮的下一轮复诊」续跑。 */
export function synthesizeAutoLoopResume(input: {
  stoppedReason: AutoLoopStoppedReason;
  rounds: AutoLoopRoundResult[];
  finalDraft: string;
  storedContent: string;
  roundBudget: number;
  resume?: AutoLoopResumeState;
}): AutoLoopResumeState | undefined {
  if (input.resume) {
    return input.resume;
  }
  if (input.stoppedReason !== 'plan_parse_failed' && input.stoppedReason !== 'aborted') {
    return undefined;
  }
  const last = input.rounds.at(-1);
  const startRoundIndex = Math.min((last?.roundIndex ?? 0) + 1 || 1, input.roundBudget);
  if (startRoundIndex < 1) {
    return undefined;
  }
  return {
    completedRounds: [...input.rounds],
    currentDraft: input.finalDraft || last?.draft || input.storedContent,
    previousItems: last?.items ?? [],
    startRoundIndex,
  };
}

const AUTO_LOOP_DIAGNOSE_MAX_RETRIES = 1;

function isUnusablePlan(parsed: ReturnType<typeof parseAutoLoopPlanItems>): boolean {
  return parsed.parseFailed || (parsed.items.length === 0 && parsed.discardedCount > 0);
}

async function diagnoseUntilParseable(input: {
  roundIndex: number;
  roundBudget: number;
  currentDraft: string;
  indexedBody: string;
  previousItems: ChapterAutoLoopItem[];
  deps: AutoLoopEngineDeps;
  previousWindowTail?: string;
}): Promise<string> {
  let rawPlan = '';
  for (let retryCount = 0; retryCount <= AUTO_LOOP_DIAGNOSE_MAX_RETRIES; retryCount += 1) {
    if (input.deps.isAborted()) {
      return rawPlan;
    }
    try {
      rawPlan = await input.deps.diagnose({
        roundIndex: input.roundIndex,
        roundBudget: input.roundBudget,
        currentDraft: input.currentDraft,
        indexedBody: input.indexedBody,
        previousItems: input.previousItems,
        retryCount,
        ...(input.previousWindowTail ? { previousWindowTail: input.previousWindowTail } : {}),
      });
    } catch (error) {
      if (
        input.deps.isAborted() ||
        (error instanceof Error && (error.name === 'AbortError' || error.message === 'aborted'))
      ) {
        return rawPlan;
      }
      throw error;
    }
    if (input.deps.isAborted()) {
      return rawPlan;
    }
    if (!isUnusablePlan(parseAutoLoopPlanItems(rawPlan))) {
      return rawPlan;
    }
  }
  return rawPlan;
}

interface RewriteRoundWork {
  roundIndex: number;
  currentDraft: string;
  previousItems: ChapterAutoLoopItem[];
  diagnosisItems: ChapterAutoLoopItem[];
  pendingItems: ChapterAutoLoopItem[];
  remainingTargets: AutoLoopTarget[];
  replacements: ParagraphReplacement[];
  settledItems: ChapterAutoLoopItem[];
  discardedCount: number;
  unlocatableCount: number;
  deferredCount: number;
  nextSegmentIndex: number;
  segmentTotal: number;
}

function cloneRewriteCheckpoint(work: RewriteRoundWork): AutoLoopRewriteCheckpoint {
  return {
    roundIndex: work.roundIndex,
    currentDraft: work.currentDraft,
    previousItems: [...work.previousItems],
    diagnosisItems: [...work.diagnosisItems],
    pendingItems: [...work.pendingItems],
    remainingTargets: work.remainingTargets.map((target) => ({
      paragraphIndex: target.paragraphIndex,
      items: [...target.items],
    })),
    replacements: [...work.replacements],
    settledItems: [...work.settledItems],
    discardedCount: work.discardedCount,
    unlocatableCount: work.unlocatableCount,
    deferredCount: work.deferredCount,
    nextSegmentIndex: work.nextSegmentIndex,
    segmentTotal: work.segmentTotal,
  };
}

function mergePendingItem(
  pendingItems: ChapterAutoLoopItem[],
  settled: ChapterAutoLoopItem
): ChapterAutoLoopItem[] {
  const index = pendingItems.findIndex((item) => item.id === settled.id);
  if (index < 0) {
    return [...pendingItems, settled];
  }
  const next = [...pendingItems];
  next[index] = settled;
  return next;
}

export async function runChapterAutoLoop(input: {
  storedContent: string;
  instruction: string;
  roundBudget: number;
  deps: AutoLoopEngineDeps;
  onEvent?: (event: AutoLoopEngineEvent) => void;
  onCheckpoint?: (resume: AutoLoopResumeState) => void;
  resume?: AutoLoopResumeState;
  previousWindowTail?: string;
}): Promise<AutoLoopResult> {
  const emit = (event: AutoLoopEngineEvent) => input.onEvent?.(event);
  const rounds: AutoLoopRoundResult[] = input.resume ? [...input.resume.completedRounds] : [];
  let currentDraft = input.resume?.currentDraft ?? input.storedContent;
  let previousItems: ChapterAutoLoopItem[] = input.resume ? [...input.resume.previousItems] : [];
  let startRoundIndex = input.resume?.startRoundIndex ?? 1;
  const rewriteResume = input.resume?.rewriteCheckpoint;

  const buildResume = (failedRoundIndex: number, work?: RewriteRoundWork): AutoLoopResumeState => ({
    completedRounds: [...rounds],
    currentDraft,
    previousItems,
    startRoundIndex: work?.roundIndex ?? failedRoundIndex,
    ...(work && work.remainingTargets.length > 0
      ? { rewriteCheckpoint: cloneRewriteCheckpoint(work) }
      : {}),
  });

  const finish = (
    stoppedReason: AutoLoopStoppedReason,
    extras?: {
      planParseFailureSample?: string;
      failedRoundIndex?: number;
      work?: RewriteRoundWork;
    }
  ): AutoLoopResult => {
    const failedRoundIndex =
      extras?.work?.roundIndex ?? extras?.failedRoundIndex ?? rounds.length + 1;
    const resumable =
      (stoppedReason === 'aborted' || stoppedReason === 'plan_parse_failed') &&
      failedRoundIndex <= input.roundBudget;
    const resume = resumable ? buildResume(failedRoundIndex, extras?.work) : undefined;
    return {
      finalDraft: currentDraft,
      rounds,
      stoppedReason,
      ...(extras?.planParseFailureSample
        ? { planParseFailureSample: extras.planParseFailureSample }
        : {}),
      ...(resume ? { resume } : {}),
    };
  };

  const emitCheckpoint = (failedRoundIndex: number, work?: RewriteRoundWork) => {
    input.onCheckpoint?.(buildResume(failedRoundIndex, work));
  };

  const completeRewriteWork = async (
    work: RewriteRoundWork
  ): Promise<'aborted' | 'rolled_back' | 'continue' | 'stop'> => {
    const indexed = splitIndexedParagraphs(work.currentDraft);

    while (work.remainingTargets.length > 0) {
      if (input.deps.isAborted()) {
        return 'aborted';
      }
      const target = work.remainingTargets[0];
      const paragraph = indexed.paragraphs.find((entry) => entry.index === target.paragraphIndex);
      if (!paragraph) {
        work.remainingTargets = work.remainingTargets.slice(1);
        work.nextSegmentIndex += 1;
        continue;
      }

      emit({
        type: 'segment_start',
        roundIndex: work.roundIndex,
        paragraphIndex: target.paragraphIndex,
        segmentIndex: work.nextSegmentIndex,
        segmentTotal: work.segmentTotal,
      });

      if (isDeleteOnlyTarget(target.items, target.paragraphIndex)) {
        const keeperIndex = target.deleteAfterRewriteIndex;
        if (keeperIndex != null) {
          const keeperSettled = work.settledItems.filter(
            (item) => (item.resolvedParagraphIndex ?? item.paragraphIndex) === keeperIndex
          );
          const keeperOk = keeperSettled.some(
            (item) => item.status === 'applied' || item.status === 'relocated'
          );
          const keeperFailed = keeperSettled.some(
            (item) => item.status === 'failed' || item.status === 'rolled_back'
          );
          if (!keeperOk || keeperFailed) {
            target.items.forEach((item) => {
              const settled: ChapterAutoLoopItem = {
                ...item,
                status: 'rolled_back',
                note: keeperFailed
                  ? `保留段第 ${keeperIndex} 段改写失败，已跳过删除以免丢内容`
                  : `保留段第 ${keeperIndex} 段尚未改写成功，已跳过删除以免丢内容`,
              };
              work.settledItems.push(settled);
              work.pendingItems = mergePendingItem(work.pendingItems, settled);
              emit({ type: 'item_status', roundIndex: work.roundIndex, item: settled });
            });
            work.remainingTargets = work.remainingTargets.slice(1);
            work.nextSegmentIndex += 1;
            if (work.remainingTargets.length > 0) {
              emitCheckpoint(work.roundIndex, work);
            }
            continue;
          }
        }
        work.replacements.push({
          paragraphIndex: target.paragraphIndex,
          text: '',
          deleteParagraph: true,
        });
        target.items.forEach((item) => {
          const settled: ChapterAutoLoopItem = {
            ...item,
            status: 'deleted',
            note: '已删除该段，前后段直接衔接',
          };
          work.settledItems.push(settled);
          work.pendingItems = mergePendingItem(work.pendingItems, settled);
          emit({ type: 'item_status', roundIndex: work.roundIndex, item: settled });
        });
        work.remainingTargets = work.remainingTargets.slice(1);
        work.nextSegmentIndex += 1;
        if (work.remainingTargets.length > 0) {
          emitCheckpoint(work.roundIndex, work);
        }
        continue;
      }

      let replacementText = '';
      let failureReason: string | undefined;
      try {
        replacementText = await input.deps.rewriteSegment({
          roundIndex: work.roundIndex,
          paragraphIndex: target.paragraphIndex,
          originalParagraph: paragraph.text,
          previousParagraph: indexed.paragraphs.find(
            (entry) => entry.index === target.paragraphIndex - 1
          )?.text,
          nextParagraph: indexed.paragraphs.find(
            (entry) => entry.index === target.paragraphIndex + 1
          )?.text,
          precedingText: extractAutoLoopPrecedingText(indexed.paragraphs, target.paragraphIndex),
          followingText: extractAutoLoopFollowingText(indexed.paragraphs, target.paragraphIndex),
          items: target.items,
        });
      } catch (error) {
        if (input.deps.isAborted()) {
          return 'aborted';
        }
        failureReason = error instanceof Error ? error.message : '段落改写调用失败';
      }

      if (input.deps.isAborted() && !failureReason && !replacementText.trim()) {
        return 'aborted';
      }

      const gate = failureReason
        ? { ok: false as const, reason: failureReason }
        : validateAutoLoopSegment({
            originalText: paragraph.text,
            replacementText,
          });

      if (gate.ok) {
        work.replacements.push({
          paragraphIndex: target.paragraphIndex,
          text: replacementText,
        });
      }

      target.items.forEach((item) => {
        const settled: ChapterAutoLoopItem = gate.ok
          ? { ...item, status: item.status === 'relocated' ? 'relocated' : 'applied' }
          : {
              ...item,
              status: failureReason ? 'failed' : 'rolled_back',
              note: gate.reason ?? item.note,
            };
        work.settledItems.push(settled);
        work.pendingItems = mergePendingItem(work.pendingItems, settled);
        emit({ type: 'item_status', roundIndex: work.roundIndex, item: settled });
      });

      work.remainingTargets = work.remainingTargets.slice(1);
      work.nextSegmentIndex += 1;
      // 只在还有剩余段时落断点。最后一段改完时 remaining 为空，
      // 此时本轮还没过闸门、也还没推进 currentDraft；若在这里写入会话，
      // 刷新会把刚改完的一轮当成没发生过。
      if (work.remainingTargets.length > 0) {
        emitCheckpoint(work.roundIndex, work);
      }
    }

    const appliedCount = work.settledItems.filter(
      (item) =>
        item.status === 'applied' || item.status === 'relocated' || item.status === 'deleted'
    ).length;
    const rolledBackCount = work.settledItems.filter(
      (item) => item.status === 'rolled_back' || item.status === 'failed'
    ).length;

    const roundDraft = applyParagraphReplacements(indexed, work.replacements);
    const roundGate = validateAutoLoopRound({
      storedContent: input.storedContent,
      roundDraft,
    });
    const orderedItems = orderItemsForReport(work.settledItems, work.pendingItems);

    if (!roundGate.ok) {
      const round: AutoLoopRoundResult = {
        roundIndex: work.roundIndex,
        draft: work.currentDraft,
        items: orderedItems,
        appliedCount,
        rolledBackCount,
        unlocatableCount: work.unlocatableCount,
        deferredCount: work.deferredCount,
        discardedCount: work.discardedCount,
        converged: false,
        rolledBack: true,
        rollbackReason: roundGate.reason,
      };
      rounds.push(round);
      emit({ type: 'round_end', roundIndex: work.roundIndex, round });
      return 'rolled_back';
    }

    const decision = shouldContinueAutoLoop({
      roundIndex: work.roundIndex,
      roundBudget: input.roundBudget,
      items: work.diagnosisItems,
      discardedCount: work.discardedCount,
    });
    const round: AutoLoopRoundResult = {
      roundIndex: work.roundIndex,
      draft: roundDraft,
      items: orderedItems,
      appliedCount,
      rolledBackCount,
      unlocatableCount: work.unlocatableCount,
      deferredCount: work.deferredCount,
      discardedCount: work.discardedCount,
      converged: decision.converged,
      rolledBack: false,
    };
    rounds.push(round);
    emit({ type: 'round_end', roundIndex: work.roundIndex, round });
    currentDraft = roundDraft;
    previousItems = orderedItems;
    if (decision.shouldContinue) {
      emitCheckpoint(work.roundIndex + 1);
    }
    return decision.shouldContinue ? 'continue' : 'stop';
  };

  if (rewriteResume && rewriteResume.remainingTargets.length > 0) {
    const indexed = splitIndexedParagraphs(rewriteResume.currentDraft);
    emit({
      type: 'round_start',
      roundIndex: rewriteResume.roundIndex,
      roundBudget: input.roundBudget,
      paragraphCount: indexed.paragraphs.length,
    });
    emit({
      type: 'plan_items',
      roundIndex: rewriteResume.roundIndex,
      items: rewriteResume.pendingItems,
      targetCount: rewriteResume.segmentTotal,
      unlocatableCount: rewriteResume.unlocatableCount,
      deferredCount: rewriteResume.deferredCount,
      discardedCount: rewriteResume.discardedCount,
    });
    const work: RewriteRoundWork = {
      ...rewriteResume,
      remainingTargets: rewriteResume.remainingTargets.map((target) => ({
        paragraphIndex: target.paragraphIndex,
        items: [...target.items],
      })),
      replacements: [...rewriteResume.replacements],
      settledItems: [...rewriteResume.settledItems],
      pendingItems: [...rewriteResume.pendingItems],
    };
    const outcome = await completeRewriteWork(work);
    if (outcome === 'aborted') {
      return finish('aborted', { failedRoundIndex: work.roundIndex, work });
    }
    if (outcome === 'rolled_back') {
      return finish('round_rolled_back');
    }
    if (outcome === 'stop') {
      const last = rounds.at(-1);
      return finish(last?.converged ? 'converged' : 'budget');
    }
    startRoundIndex = rewriteResume.roundIndex + 1;
  }

  for (let roundIndex = startRoundIndex; roundIndex <= input.roundBudget; roundIndex += 1) {
    if (input.deps.isAborted()) {
      return finish('aborted', { failedRoundIndex: roundIndex });
    }

    const indexed = splitIndexedParagraphs(currentDraft);
    emit({
      type: 'round_start',
      roundIndex,
      roundBudget: input.roundBudget,
      paragraphCount: indexed.paragraphs.length,
    });

    const rawPlan = await diagnoseUntilParseable({
      roundIndex,
      roundBudget: input.roundBudget,
      currentDraft,
      indexedBody: renderIndexedParagraphs(indexed),
      previousItems,
      deps: input.deps,
      ...(input.previousWindowTail ? { previousWindowTail: input.previousWindowTail } : {}),
    });

    if (input.deps.isAborted()) {
      return finish('aborted', { failedRoundIndex: roundIndex });
    }

    const parsed = parseAutoLoopPlanItems(rawPlan);
    const carried = carryDeferredItems(previousItems);
    // 整体解不开、或解开了但每一条都不合法：若无顺延可执行，则整轮失败。
    // 有顺延时允许本轮复诊为空，只消化上一轮 deferred。
    if (
      (parsed.parseFailed || (parsed.items.length === 0 && parsed.discardedCount > 0)) &&
      carried.length === 0
    ) {
      return finish('plan_parse_failed', {
        planParseFailureSample: rawPlan.slice(0, 200),
        failedRoundIndex: roundIndex,
      });
    }

    // 上一轮 deferred 硬入队，避免只标「顺延」却指望模型下一轮再提出
    const carriedIds = new Set(carried.map((item) => item.id));
    const carriedKeys = new Set(
      carried.map(
        (item) => `${item.resolvedParagraphIndex ?? item.paragraphIndex}::${item.instruction}`
      )
    );
    const freshItems = parsed.parseFailed
      ? []
      : parsed.items.filter((item) => {
          const key = `${item.resolvedParagraphIndex ?? item.paragraphIndex}::${item.instruction}`;
          return !carriedKeys.has(key);
        });
    const selection = selectAutoLoopTargets({
      items: [...carried, ...freshItems],
      paragraphs: indexed.paragraphs,
      preferItemIds: carriedIds,
      unlimitedHits: roundIndex >= input.roundBudget,
    });

    // 收敛判定看「本轮诊断 + 顺延入队」：仅有顺延也必须继续改，不能空转收工
    const diagnosisForContinue = [...carried, ...(parsed.parseFailed ? [] : parsed.items)];

    // 条目先于任何改写摊给用户：这既是进度，也是"要不要提前停"的依据
    const pendingItems: ChapterAutoLoopItem[] = [
      ...selection.targets.flatMap((target) => target.items),
      ...selection.deferred,
      ...selection.unlocatable,
    ];
    emit({
      type: 'plan_items',
      roundIndex,
      items: pendingItems,
      targetCount: selection.targets.length,
      unlocatableCount: selection.unlocatable.length,
      deferredCount: selection.deferred.length,
      discardedCount: parsed.discardedCount,
    });

    [...selection.unlocatable, ...selection.deferred].forEach((item) => {
      emit({ type: 'item_status', roundIndex, item });
    });

    if (selection.targets.length === 0) {
      const decision = shouldContinueAutoLoop({
        roundIndex,
        roundBudget: input.roundBudget,
        items: diagnosisForContinue,
        discardedCount: parsed.discardedCount,
      });
      const round: AutoLoopRoundResult = {
        roundIndex,
        draft: currentDraft,
        items: [...selection.deferred, ...selection.unlocatable],
        appliedCount: 0,
        rolledBackCount: 0,
        unlocatableCount: selection.unlocatable.length,
        deferredCount: selection.deferred.length,
        discardedCount: parsed.discardedCount,
        converged: decision.converged,
        rolledBack: false,
      };
      rounds.push(round);
      emit({ type: 'round_end', roundIndex, round });
      previousItems = round.items;
      if (!decision.shouldContinue) {
        return finish(decision.converged ? 'converged' : 'budget');
      }
      emitCheckpoint(roundIndex + 1);
      continue;
    }

    const work: RewriteRoundWork = {
      roundIndex,
      currentDraft,
      previousItems,
      diagnosisItems: diagnosisForContinue,
      pendingItems,
      remainingTargets: [...selection.targets],
      replacements: [],
      settledItems: [...selection.deferred, ...selection.unlocatable],
      discardedCount: parsed.discardedCount,
      unlocatableCount: selection.unlocatable.length,
      deferredCount: selection.deferred.length,
      nextSegmentIndex: 1,
      segmentTotal: selection.targets.length,
    };
    emitCheckpoint(roundIndex, work);

    const outcome = await completeRewriteWork(work);
    if (outcome === 'aborted') {
      return finish('aborted', { failedRoundIndex: roundIndex, work });
    }
    if (outcome === 'rolled_back') {
      return finish('round_rolled_back');
    }
    if (outcome === 'stop') {
      const last = rounds.at(-1);
      return finish(last?.converged ? 'converged' : 'budget');
    }
  }

  return finish('budget');
}

/** 让报告里的条目顺序与推送给前端的初始顺序一致，便于前端就地回填状态 */
function orderItemsForReport(
  settled: ChapterAutoLoopItem[],
  pending: ChapterAutoLoopItem[]
): ChapterAutoLoopItem[] {
  const byId = new Map(settled.map((item) => [item.id, item]));
  const ordered = pending.map((item) => byId.get(item.id) ?? item);
  const extras = settled.filter((item) => !pending.some((candidate) => candidate.id === item.id));
  return [...ordered, ...extras];
}

function stripWindowPack(resume: AutoLoopResumeState | undefined): AutoLoopResumeState | undefined {
  if (!resume) {
    return undefined;
  }
  const { windowPack, ...inner } = resume;
  void windowPack;
  return inner;
}

function remapRoundDraft(
  round: AutoLoopRoundResult,
  compose: (draft: string) => string
): AutoLoopRoundResult {
  return { ...round, draft: compose(round.draft) };
}

function stampRoundWindow(
  round: AutoLoopRoundResult,
  windowIndex: number,
  windowTotal: number
): AutoLoopRoundResult {
  return { ...round, windowIndex, windowTotal };
}

function autoLoopRoundIdentity(round: AutoLoopRoundResult): string {
  return `${round.windowIndex ?? 1}:${round.roundIndex}`;
}

function mergeTimelineRounds(
  timeline: AutoLoopRoundResult[],
  incoming: AutoLoopRoundResult[]
): AutoLoopRoundResult[] {
  const merged = [...timeline];
  for (const round of incoming) {
    const key = autoLoopRoundIdentity(round);
    const index = merged.findIndex((item) => autoLoopRoundIdentity(item) === key);
    if (index >= 0) {
      merged[index] = round;
    } else {
      merged.push(round);
    }
  }
  return merged;
}

/** 会话对外 rounds：已结束窗时间线 + 当前窗内层已完成轮（去重）。 */
export function composeAutoLoopTimelineRounds(resume: AutoLoopResumeState): AutoLoopRoundResult[] {
  const pack = resume.windowPack;
  const current = resume.completedRounds;
  if (!pack || pack.windows.length <= 1) {
    return current;
  }
  const currentWindowIndex0 = Math.max(0, pack.windowIndex - 1);
  const stampedCurrent = current.map((round) =>
    stampRoundWindow(
      {
        ...round,
        draft: composeAutoLoopChapterDraft({
          windows: pack.windows,
          completedWindowDrafts: pack.completedWindowDrafts,
          currentWindowIndex0,
          currentDraft: round.draft,
        }),
      },
      round.windowIndex ?? pack.windowIndex,
      round.windowTotal ?? pack.windowTotal
    )
  );
  return mergeTimelineRounds(pack.timelineRounds ?? [], stampedCurrent);
}

function isWindowFailure(reason: AutoLoopStoppedReason): boolean {
  return reason === 'aborted' || reason === 'plan_parse_failed' || reason === 'round_rolled_back';
}

function synthesizeWindowInnerResume(
  inner: AutoLoopResult,
  roundBudget: number
): AutoLoopResumeState {
  if (inner.resume) {
    return inner.resume;
  }
  const last = inner.rounds.at(-1);
  let startRoundIndex = (last?.roundIndex ?? 0) + 1;
  let completedRounds = [...inner.rounds];
  if (startRoundIndex < 1 || startRoundIndex > roundBudget) {
    startRoundIndex = 1;
    completedRounds = [];
  }
  return {
    completedRounds,
    currentDraft: inner.finalDraft,
    previousItems: last?.items ?? [],
    startRoundIndex,
  };
}

export function composeAutoLoopChapterDraft(input: {
  windows: AutoLoopCharWindow[];
  completedWindowDrafts: string[];
  currentWindowIndex0: number;
  currentDraft?: string;
}): string {
  const drafts = input.windows.map((window, index) => {
    if (index < input.currentWindowIndex0) {
      return input.completedWindowDrafts[index] ?? window.text;
    }
    if (index === input.currentWindowIndex0) {
      return input.currentDraft ?? window.text;
    }
    return window.text;
  });
  return stitchAutoLoopCharWindows(input.windows, drafts);
}

export function composeAutoLoopResumeDraft(
  resume: AutoLoopResumeState,
  fallbackStored: string
): string {
  const pack = resume.windowPack;
  if (!pack || pack.windows.length <= 1) {
    return resume.currentDraft || fallbackStored;
  }
  return composeAutoLoopChapterDraft({
    windows: pack.windows,
    completedWindowDrafts: pack.completedWindowDrafts,
    currentWindowIndex0: Math.max(0, pack.windowIndex - 1),
    currentDraft: resume.currentDraft,
  });
}

export async function runChapterAutoLoopWindows(input: {
  storedContent: string;
  instruction: string;
  roundBudget: number;
  deps: AutoLoopEngineDeps;
  onEvent?: (event: AutoLoopEngineEvent) => void;
  onCheckpoint?: (resume: AutoLoopResumeState) => void;
  resume?: AutoLoopResumeState;
  windowing: { segmentCharSize: number; singleSegmentThreshold: number };
}): Promise<AutoLoopResult> {
  const windows =
    input.resume?.windowPack?.windows ??
    splitAutoLoopCharWindows(input.storedContent, input.windowing);
  // 旧会话没有 windowPack：切窗会把整章 currentDraft 塞进第一窗，拼回重复后半章。
  const legacyResumeWithoutPack = Boolean(input.resume && !input.resume.windowPack);

  if (windows.length <= 1 || legacyResumeWithoutPack) {
    return runChapterAutoLoop({
      storedContent: input.storedContent,
      instruction: input.instruction,
      roundBudget: input.roundBudget,
      deps: input.deps,
      onEvent: input.onEvent,
      onCheckpoint: input.onCheckpoint,
      resume: stripWindowPack(input.resume),
    });
  }

  const startWindowIndex0 = Math.max(0, (input.resume?.windowPack?.windowIndex ?? 1) - 1);
  const completedWindowDrafts = [...(input.resume?.windowPack?.completedWindowDrafts ?? [])];
  let timelineRounds = [...(input.resume?.windowPack?.timelineRounds ?? [])];
  let lastResult: AutoLoopResult | undefined;
  const emit = (event: AutoLoopEngineEvent) => input.onEvent?.(event);

  for (let index = startWindowIndex0; index < windows.length; index += 1) {
    const windowIndex = index + 1;
    const windowTotal = windows.length;
    const windowText = windows[index]?.text ?? '';
    const compose = (windowDraft: string) =>
      composeAutoLoopChapterDraft({
        windows,
        completedWindowDrafts,
        currentWindowIndex0: index,
        currentDraft: windowDraft,
      });
    const stamp = (round: AutoLoopRoundResult) =>
      stampRoundWindow(remapRoundDraft(round, compose), windowIndex, windowTotal);
    const attachPack = (innerResume: AutoLoopResumeState): AutoLoopResumeState => ({
      ...innerResume,
      windowPack: {
        windowIndex,
        windowTotal,
        completedWindowDrafts: [...completedWindowDrafts],
        windows,
        timelineRounds: [...timelineRounds],
      },
    });

    if (input.deps.isAborted()) {
      return {
        finalDraft: compose(windowText),
        rounds: lastResult?.rounds ?? timelineRounds,
        stoppedReason: 'aborted',
        resume: attachPack({
          completedRounds: [],
          currentDraft: windowText,
          previousItems: [],
          startRoundIndex: 1,
        }),
      };
    }

    emit({ type: 'window_start', windowIndex, windowTotal });

    const previousWindowTail =
      index > 0
        ? extractAutoLoopWindowTail(
            completedWindowDrafts[index - 1] ?? windows[index - 1]?.text ?? ''
          )
        : undefined;

    const remapEvent = (event: AutoLoopEngineEvent): AutoLoopEngineEvent => {
      if (event.type === 'window_start') {
        return event;
      }
      if (event.type === 'round_end') {
        return {
          ...event,
          windowIndex,
          windowTotal,
          round: stamp(event.round),
        };
      }
      return { ...event, windowIndex, windowTotal };
    };

    const innerResume = index === startWindowIndex0 ? stripWindowPack(input.resume) : undefined;
    const inner = await runChapterAutoLoop({
      storedContent: windowText,
      instruction: input.instruction,
      roundBudget: input.roundBudget,
      deps: input.deps,
      ...(previousWindowTail ? { previousWindowTail } : {}),
      ...(innerResume ? { resume: innerResume } : {}),
      onEvent: (event) => emit(remapEvent(event)),
      onCheckpoint: (resume) => input.onCheckpoint?.(attachPack(resume)),
    });

    const windowRounds = inner.rounds.map(stamp);
    lastResult = {
      ...inner,
      rounds: mergeTimelineRounds(timelineRounds, windowRounds),
      finalDraft: compose(inner.finalDraft),
    };

    if (isWindowFailure(inner.stoppedReason)) {
      return {
        ...lastResult,
        resume: attachPack(synthesizeWindowInnerResume(inner, input.roundBudget)),
      };
    }

    timelineRounds = lastResult.rounds;
    completedWindowDrafts[index] = inner.finalDraft;
    const nextIndex = index + 1;
    if (nextIndex < windows.length) {
      const nextText = windows[nextIndex]?.text ?? '';
      input.onCheckpoint?.({
        completedRounds: [],
        currentDraft: nextText,
        previousItems: [],
        startRoundIndex: 1,
        windowPack: {
          windowIndex: nextIndex + 1,
          windowTotal: windows.length,
          completedWindowDrafts: [...completedWindowDrafts],
          windows,
          timelineRounds: [...timelineRounds],
        },
      });
    }
  }

  return {
    finalDraft: stitchAutoLoopCharWindows(windows, completedWindowDrafts),
    rounds: lastResult?.rounds ?? timelineRounds,
    stoppedReason: lastResult?.stoppedReason ?? 'budget',
  };
}
