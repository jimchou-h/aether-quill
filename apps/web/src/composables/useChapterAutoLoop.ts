/**
 * 自动优化循环的前端编排（openspec: add-chapter-auto-optimize-loop）
 *
 * 循环整体跑在后端一条 SSE 上，前端这里只做三件事：把事件摊平成
 * 「轮 + 条目」两级视图、把每轮成稿回填给弹窗、以及在中断时保住
 * 最近完成轮的成果。因此状态与副作用集中在这个 composable，
 * 弹窗只负责呈现。
 */

import { computed, shallowRef, type Ref } from 'vue';
import {
  apiClient,
  type ChapterAutoLoopItem,
  type ChapterAutoLoopRound,
  type ChapterAutoLoopStoppedReason,
  type ChapterItem,
} from '../services/api';
import { useAbortableSse } from './useAbortableSse';
import {
  applyAiTaskProgressEvent,
  cancelAiTaskProgress,
  completeAiTaskProgress,
  failAiTaskProgress,
  tryStartAiTaskProgress,
  type AiTaskProgressState,
} from './useAiTaskProgress';
import { isSseAbortError } from '../utils/sseStream';
import { presentErrorFromCaught } from '../utils/pageFeedback';
import {
  describeAutoLoopStoppedReason,
  mergeAutoLoopItemStatus,
  resolveAutoLoopAcceptableDraft,
  restoreAutoLoopSessionView,
  type AutoLoopSessionView,
} from '../utils/chapterAutoLoopItems';

export const CHAPTER_AUTO_LOOP_TASK_KEY = 'chapter.optimize.auto-loop';

export interface UseChapterAutoLoopOptions {
  projectId: () => string;
  chapter: () => ChapterItem | null;
  aiTaskProgress: Ref<AiTaskProgressState>;
  /** 每有一轮成稿就回填到弹窗的可编辑草稿，用户随时可以停下来应用 */
  onDraftAvailable: (draft: string) => void;
}

export function useChapterAutoLoop(options: UseChapterAutoLoopOptions) {
  const stream = useAbortableSse();
  const running = shallowRef(false);
  const rounds = shallowRef<ChapterAutoLoopRound[]>([]);
  const liveItems = shallowRef<ChapterAutoLoopItem[]>([]);
  const activeRoundIndex = shallowRef(0);
  const activeRoundBudget = shallowRef(0);
  const paragraphCount = shallowRef(0);
  const stoppedReason = shallowRef<ChapterAutoLoopStoppedReason | null>(null);
  const baseUpdatedAt = shallowRef('');
  const statusText = shallowRef('');
  const errorMessage = shallowRef('');
  const restoredFromSession = shallowRef(false);
  const stoppedByUser = shallowRef(false);

  const acceptableDraft = computed(() =>
    resolveAutoLoopAcceptableDraft({ rounds: rounds.value, storedContent: '' })
  );
  const hasAcceptableDraft = computed(() => Boolean(acceptableDraft.value.trim()));
  const stoppedReasonText = computed(() =>
    stoppedReason.value ? describeAutoLoopStoppedReason(stoppedReason.value) : ''
  );

  function reset() {
    stream.abort();
    running.value = false;
    rounds.value = [];
    liveItems.value = [];
    activeRoundIndex.value = 0;
    activeRoundBudget.value = 0;
    paragraphCount.value = 0;
    stoppedReason.value = null;
    baseUpdatedAt.value = '';
    statusText.value = '';
    errorMessage.value = '';
    restoredFromSession.value = false;
    stoppedByUser.value = false;
  }

  /** 打开弹窗时静默尝试恢复；无会话就当全新开始，不打扰用户。 */
  async function restoreSession(): Promise<AutoLoopSessionView | null> {
    const chapter = options.chapter();
    if (!chapter) {
      return null;
    }
    try {
      const session = await apiClient.getChapterAutoLoopSession(
        options.projectId(),
        chapter.chapterNo
      );
      const view = restoreAutoLoopSessionView(session);
      if (!view.restored) {
        return null;
      }
      rounds.value = view.rounds;
      liveItems.value = view.rounds.at(-1)?.items ?? [];
      activeRoundIndex.value = view.rounds.length;
      activeRoundBudget.value = view.roundBudget;
      stoppedReason.value = view.stoppedReason;
      baseUpdatedAt.value = view.baseUpdatedAt;
      errorMessage.value = view.errorMessage;
      restoredFromSession.value = true;
      statusText.value = view.stoppedReason
        ? `已恢复上次循环：${describeAutoLoopStoppedReason(view.stoppedReason)}`
        : '已恢复上次循环进度';
      if (view.finalDraft.trim()) {
        options.onDraftAvailable(view.finalDraft);
      }
      return view;
    } catch {
      // 恢复是纯增益路径：失败就走全新开始，不该把用户拦在门外
      return null;
    }
  }

  async function start(input: {
    instruction: string;
    roundBudget: number;
    appearingCharacters?: string[];
  }): Promise<'ok' | 'error' | 'aborted' | 'busy'> {
    const chapter = options.chapter();
    if (!chapter || running.value) {
      return 'busy';
    }

    const started = tryStartAiTaskProgress(options.aiTaskProgress, {
      taskKey: CHAPTER_AUTO_LOOP_TASK_KEY,
      message: '自动优化循环启动中…',
      source: 'dialog:writing-optimize',
      chapterNo: chapter.chapterNo,
      interruptible: true,
    });
    if (!started.ok) {
      return 'busy';
    }

    running.value = true;
    stoppedByUser.value = false;
    rounds.value = [];
    liveItems.value = [];
    activeRoundIndex.value = 0;
    stoppedReason.value = null;
    errorMessage.value = '';
    restoredFromSession.value = false;
    statusText.value = '自动优化循环启动中…';

    const setStatus = (message: string, stage = 'running') => {
      statusText.value = message;
      applyAiTaskProgressEvent(options.aiTaskProgress, {
        taskKey: CHAPTER_AUTO_LOOP_TASK_KEY,
        stage,
        message,
      });
    };

    let outcome: 'ok' | 'error' | 'aborted' = 'error';
    const signal = stream.begin();
    try {
      await apiClient.autoLoopChapterSSE(
        options.projectId(),
        chapter.chapterNo,
        {
          instruction: input.instruction,
          roundBudget: input.roundBudget,
          ...(input.appearingCharacters?.length
            ? { appearingCharacters: input.appearingCharacters }
            : {}),
        },
        {
          onStart: (event) => {
            baseUpdatedAt.value = event.baseUpdatedAt;
            activeRoundBudget.value = event.roundBudget;
            setStatus(`自动优化循环开始，最多 ${event.roundBudget} 轮`);
          },
          onStage: ({ stage, roundIndex, segmentIndex, segmentTotal }) => {
            const roundLabel = roundIndex ? `第 ${roundIndex} 轮` : '';
            if (stage === 'syncing_context') {
              setStatus('正在同步章节上下文…', stage);
              return;
            }
            if (stage === 'loop_diagnose') {
              setStatus(`${roundLabel}复诊中…`, stage);
              return;
            }
            if (stage === 'loop_segment_rewrite') {
              const position =
                segmentIndex && segmentTotal ? `（${segmentIndex}/${segmentTotal} 段）` : '';
              setStatus(`${roundLabel}逐段改写中${position}`, stage);
              return;
            }
            setStatus(`${roundLabel}整章校验中…`, stage);
          },
          onProgress: (event) => {
            setStatus(event.message, event.stage ?? 'running');
          },
          onRoundStart: (event) => {
            activeRoundIndex.value = event.roundIndex;
            activeRoundBudget.value = event.roundBudget;
            paragraphCount.value = event.paragraphCount;
            liveItems.value = [];
          },
          onPlanItems: (event) => {
            // 条目先于任何改写抵达，用户能在改动落地前就看到"要动哪几段"
            liveItems.value = event.items;
            setStatus(
              `第 ${event.roundIndex} 轮复诊完成：命中 ${event.targetCount} 段，共 ${event.items.length} 条`
            );
          },
          onItemStatus: (event) => {
            liveItems.value = mergeAutoLoopItemStatus(liveItems.value, event.item);
          },
          onRoundEnd: (event) => {
            rounds.value = [...rounds.value, event.round];
            liveItems.value = event.round.items;
            if (!event.round.rolledBack && event.round.draft.trim()) {
              options.onDraftAvailable(event.round.draft);
            }
          },
          onEnd: (event) => {
            stoppedReason.value = event.stoppedReason;
            if (event.baseUpdatedAt) {
              baseUpdatedAt.value = event.baseUpdatedAt;
            }
            if (event.finalDraftText.trim()) {
              options.onDraftAvailable(event.finalDraftText);
            }
            outcome = 'ok';
            statusText.value = describeAutoLoopStoppedReason(event.stoppedReason);
            completeAiTaskProgress(options.aiTaskProgress, statusText.value);
          },
          onError: (message) => {
            errorMessage.value = message;
            outcome = 'error';
            failAiTaskProgress(options.aiTaskProgress, message);
          },
        },
        { signal }
      );
    } catch (error) {
      if (isSseAbortError(error) || stoppedByUser.value) {
        outcome = 'aborted';
        stoppedReason.value = 'aborted';
        cancelAiTaskProgress(options.aiTaskProgress, '已停止自动优化循环');
      } else {
        errorMessage.value = presentErrorFromCaught(error, '自动优化循环失败');
        outcome = 'error';
        failAiTaskProgress(options.aiTaskProgress, errorMessage.value);
      }
    } finally {
      stream.abort();
      running.value = false;
    }
    return outcome;
  }

  /**
   * 「停在当前轮并收下」：中断流即可，最近完成轮的成稿早已通过
   * `loop_round_end` 回填，不需要再跑一次也不用等本轮结束。
   */
  function stopAndAccept() {
    stoppedByUser.value = true;
    stream.abort();
    running.value = false;
    stoppedReason.value = 'aborted';
    statusText.value = hasAcceptableDraft.value
      ? '已停止，保留最近完成轮的成稿'
      : '已停止，尚无完成轮成稿';
    cancelAiTaskProgress(options.aiTaskProgress, statusText.value);
  }

  return {
    running,
    rounds,
    liveItems,
    activeRoundIndex,
    activeRoundBudget,
    paragraphCount,
    stoppedReason,
    stoppedReasonText,
    baseUpdatedAt,
    statusText,
    errorMessage,
    restoredFromSession,
    acceptableDraft,
    hasAcceptableDraft,
    start,
    stopAndAccept,
    restoreSession,
    reset,
  };
}
