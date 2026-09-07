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
  parseAutoLoopPlanItems,
  renderIndexedParagraphs,
  selectAutoLoopTargets,
  shouldContinueAutoLoop,
  splitIndexedParagraphs,
  validateAutoLoopRound,
  validateAutoLoopSegment,
} from './chapter-auto-loop.util';
import type { ChapterAutoLoopItem, ParagraphReplacement } from './chapter-auto-loop.util';

export interface AutoLoopDiagnoseInput {
  roundIndex: number;
  roundBudget: number;
  /** 本轮诊断对象：第 1 轮为入库原文，第 2 轮起为上一轮成稿 */
  currentDraft: string;
  /** 带 [n] 编号的正文，供模型照抄编号 */
  indexedBody: string;
  /** 上一轮条目及其最终状态；首轮为空 */
  previousItems: ChapterAutoLoopItem[];
}

export interface AutoLoopRewriteInput {
  roundIndex: number;
  paragraphIndex: number;
  originalParagraph: string;
  previousParagraph?: string;
  nextParagraph?: string;
  items: ChapterAutoLoopItem[];
}

export interface AutoLoopEngineDeps {
  diagnose(input: AutoLoopDiagnoseInput): Promise<string>;
  rewriteSegment(input: AutoLoopRewriteInput): Promise<string>;
  isAborted(): boolean;
}

export type AutoLoopEngineEvent =
  | {
      type: 'round_start';
      roundIndex: number;
      roundBudget: number;
      paragraphCount: number;
    }
  | {
      type: 'plan_items';
      roundIndex: number;
      items: ChapterAutoLoopItem[];
      targetCount: number;
      unlocatableCount: number;
      deferredCount: number;
      discardedCount: number;
    }
  | {
      type: 'segment_start';
      roundIndex: number;
      paragraphIndex: number;
      segmentIndex: number;
      segmentTotal: number;
    }
  | { type: 'item_status'; roundIndex: number; item: ChapterAutoLoopItem }
  | {
      type: 'round_end';
      roundIndex: number;
      round: AutoLoopRoundResult;
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
}

export async function runChapterAutoLoop(input: {
  storedContent: string;
  instruction: string;
  roundBudget: number;
  deps: AutoLoopEngineDeps;
  onEvent?: (event: AutoLoopEngineEvent) => void;
}): Promise<AutoLoopResult> {
  const emit = (event: AutoLoopEngineEvent) => input.onEvent?.(event);
  const rounds: AutoLoopRoundResult[] = [];
  let currentDraft = input.storedContent;
  let previousItems: ChapterAutoLoopItem[] = [];

  const finish = (
    stoppedReason: AutoLoopStoppedReason,
    planParseFailureSample?: string
  ): AutoLoopResult => ({
    finalDraft: currentDraft,
    rounds,
    stoppedReason,
    ...(planParseFailureSample ? { planParseFailureSample } : {}),
  });

  for (let roundIndex = 1; roundIndex <= input.roundBudget; roundIndex += 1) {
    if (input.deps.isAborted()) {
      return finish('aborted');
    }

    const indexed = splitIndexedParagraphs(currentDraft);
    emit({
      type: 'round_start',
      roundIndex,
      roundBudget: input.roundBudget,
      paragraphCount: indexed.paragraphs.length,
    });

    const rawPlan = await input.deps.diagnose({
      roundIndex,
      roundBudget: input.roundBudget,
      currentDraft,
      indexedBody: renderIndexedParagraphs(indexed),
      previousItems,
    });

    if (input.deps.isAborted()) {
      return finish('aborted');
    }

    const parsed = parseAutoLoopPlanItems(rawPlan);
    // 整体解不开、或解开了但每一条都不合法，两者信息量相同：这一轮什么都没读懂。
    // 后者尤其危险——空条目列表会被收敛判定读成"没有 high"，把失败伪装成收工。
    if (parsed.parseFailed || (parsed.items.length === 0 && parsed.discardedCount > 0)) {
      return finish('plan_parse_failed', rawPlan.slice(0, 200));
    }

    const selection = selectAutoLoopTargets({
      items: parsed.items,
      paragraphs: indexed.paragraphs,
    });

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
        items: parsed.items,
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
      continue;
    }

    const replacements: ParagraphReplacement[] = [];
    const settledItems: ChapterAutoLoopItem[] = [...selection.deferred, ...selection.unlocatable];
    let appliedCount = 0;
    let rolledBackCount = 0;
    let abortedDuringRound = false;

    for (let position = 0; position < selection.targets.length; position += 1) {
      if (input.deps.isAborted()) {
        abortedDuringRound = true;
        break;
      }
      const target = selection.targets[position];
      const paragraph = indexed.paragraphs.find((entry) => entry.index === target.paragraphIndex);
      if (!paragraph) {
        continue;
      }

      emit({
        type: 'segment_start',
        roundIndex,
        paragraphIndex: target.paragraphIndex,
        segmentIndex: position + 1,
        segmentTotal: selection.targets.length,
      });

      let replacementText = '';
      let failureReason: string | undefined;
      try {
        replacementText = await input.deps.rewriteSegment({
          roundIndex,
          paragraphIndex: target.paragraphIndex,
          originalParagraph: paragraph.text,
          previousParagraph: indexed.paragraphs.find(
            (entry) => entry.index === target.paragraphIndex - 1
          )?.text,
          nextParagraph: indexed.paragraphs.find(
            (entry) => entry.index === target.paragraphIndex + 1
          )?.text,
          items: target.items,
        });
      } catch (error) {
        failureReason = error instanceof Error ? error.message : '段落改写调用失败';
      }

      const gate = failureReason
        ? { ok: false as const, reason: failureReason }
        : validateAutoLoopSegment({
            originalText: paragraph.text,
            replacementText,
          });

      if (gate.ok) {
        replacements.push({
          paragraphIndex: target.paragraphIndex,
          text: replacementText,
        });
        appliedCount += target.items.length;
      } else {
        rolledBackCount += target.items.length;
      }

      target.items.forEach((item) => {
        const settled: ChapterAutoLoopItem = gate.ok
          ? { ...item, status: item.status === 'relocated' ? 'relocated' : 'applied' }
          : {
              ...item,
              status: failureReason ? 'failed' : 'rolled_back',
              note: gate.reason ?? item.note,
            };
        settledItems.push(settled);
        emit({ type: 'item_status', roundIndex, item: settled });
      });
    }

    if (abortedDuringRound || input.deps.isAborted()) {
      // 被中断的轮次不提交：用户拿到的是最近一次完整走完闸门的成稿
      return finish('aborted');
    }

    const roundDraft = applyParagraphReplacements(indexed, replacements);
    const roundGate = validateAutoLoopRound({
      storedContent: input.storedContent,
      roundDraft,
      instruction: input.instruction,
    });

    const orderedItems = orderItemsForReport(settledItems, pendingItems);

    if (!roundGate.ok) {
      const round: AutoLoopRoundResult = {
        roundIndex,
        draft: currentDraft,
        items: orderedItems,
        appliedCount,
        rolledBackCount,
        unlocatableCount: selection.unlocatable.length,
        deferredCount: selection.deferred.length,
        discardedCount: parsed.discardedCount,
        converged: false,
        rolledBack: true,
        rollbackReason: roundGate.reason,
      };
      rounds.push(round);
      emit({ type: 'round_end', roundIndex, round });
      return finish('round_rolled_back');
    }

    const decision = shouldContinueAutoLoop({
      roundIndex,
      roundBudget: input.roundBudget,
      items: parsed.items,
      discardedCount: parsed.discardedCount,
    });
    const round: AutoLoopRoundResult = {
      roundIndex,
      draft: roundDraft,
      items: orderedItems,
      appliedCount,
      rolledBackCount,
      unlocatableCount: selection.unlocatable.length,
      deferredCount: selection.deferred.length,
      discardedCount: parsed.discardedCount,
      converged: decision.converged,
      rolledBack: false,
    };
    rounds.push(round);
    emit({ type: 'round_end', roundIndex, round });

    currentDraft = roundDraft;
    previousItems = orderedItems;

    if (!decision.shouldContinue) {
      return finish(decision.converged ? 'converged' : 'budget');
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
