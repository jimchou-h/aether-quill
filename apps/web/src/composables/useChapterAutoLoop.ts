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
  type AutoLoopPromptLabCall,
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
  describeAutoLoopResumeAction,
  describeAutoLoopStoppedReason,
  formatAutoLoopWindowPrefix,
  mergeAutoLoopItemStatus,
  resolveAutoLoopAcceptableDraft,
  restoreAutoLoopSessionView,
  upsertAutoLoopTimelineRound,
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
  const promptLabCalls = shallowRef<AutoLoopPromptLabCall[]>([]);
  const activeRoundIndex = shallowRef(0);
  const activeRoundBudget = shallowRef(0);
  const paragraphCount = shallowRef(0);
  const stoppedReason = shallowRef<ChapterAutoLoopStoppedReason | null>(null);
  const baseUpdatedAt = shallowRef('');
  const statusText = shallowRef('');
  const errorMessage = shallowRef('');
  const restoredFromSession = shallowRef(false);
  const stoppedByUser = shallowRef(false);
  const resumable = shallowRef(false);
  const resumeStage = shallowRef<'diagnose' | 'rewrite' | null>(null);
  const resumeRoundIndex = shallowRef(0);
  const resumeSegmentIndex = shallowRef(0);
  const resumeSegmentTotal = shallowRef(0);
  const resumeWindowIndex = shallowRef(0);
  const resumeWindowTotal = shallowRef(0);

  const acceptableDraft = computed(() =>
    resolveAutoLoopAcceptableDraft({ rounds: rounds.value, storedContent: '' })
  );
  const hasAcceptableDraft = computed(() => Boolean(acceptableDraft.value.trim()));
  const stoppedReasonText = computed(() =>
    stoppedReason.value ? describeAutoLoopStoppedReason(stoppedReason.value) : ''
  );
  const canResume = computed(() => resumable.value && !running.value);
  const resumeActionText = computed(() =>
    describeAutoLoopResumeAction({
      resumeStage: resumeStage.value,
      resumeRoundIndex: resumeRoundIndex.value,
      resumeSegmentIndex: resumeSegmentIndex.value,
      resumeSegmentTotal: resumeSegmentTotal.value,
      resumeWindowIndex: resumeWindowIndex.value,
      resumeWindowTotal: resumeWindowTotal.value,
    })
  );

  function applyResumeSummary(input: {
    resumable?: boolean;
    resumeStage?: 'diagnose' | 'rewrite' | null;
    resumeRoundIndex?: number;
    resumeSegmentIndex?: number;
    resumeSegmentTotal?: number;
    resumeWindowIndex?: number;
    resumeWindowTotal?: number;
  }) {
    resumable.value = input.resumable === true;
    resumeStage.value = input.resumeStage ?? null;
    resumeRoundIndex.value = input.resumeRoundIndex ?? 0;
    resumeSegmentIndex.value = input.resumeSegmentIndex ?? 0;
    resumeSegmentTotal.value = input.resumeSegmentTotal ?? 0;
    resumeWindowIndex.value = input.resumeWindowIndex ?? 0;
    resumeWindowTotal.value = input.resumeWindowTotal ?? 0;
  }

  function reset() {
    stream.abort();
    running.value = false;
    rounds.value = [];
    liveItems.value = [];
    promptLabCalls.value = [];
    activeRoundIndex.value = 0;
    activeRoundBudget.value = 0;
    paragraphCount.value = 0;
    stoppedReason.value = null;
    baseUpdatedAt.value = '';
    statusText.value = '';
    errorMessage.value = '';
    restoredFromSession.value = false;
    stoppedByUser.value = false;
    applyResumeSummary({ resumable: false });
  }

  function applyRestoredSession(view: AutoLoopSessionView) {
    rounds.value = view.rounds;
    promptLabCalls.value = view.promptLabCalls;
    liveItems.value =
      view.inProgressItems.length > 0 ? view.inProgressItems : (view.rounds.at(-1)?.items ?? []);
    activeRoundIndex.value = view.resumeRoundIndex || view.rounds.length;
    activeRoundBudget.value = view.roundBudget;
    stoppedReason.value = view.stoppedReason;
    baseUpdatedAt.value = view.baseUpdatedAt;
    errorMessage.value = view.errorMessage;
    restoredFromSession.value = true;
    applyResumeSummary(view);
    statusText.value = view.stoppedReason
      ? `已恢复上次循环：${describeAutoLoopStoppedReason(view.stoppedReason)}`
      : '已恢复上次循环进度';
    if (view.finalDraft.trim()) {
      options.onDraftAvailable(view.finalDraft);
    }
  }

  /** 打开弹窗时静默尝试恢复；无会话就当全新开始，不打扰用户。 */
  async function restoreSession(input?: {
    onlyIfResumable?: boolean;
  }): Promise<AutoLoopSessionView | null> {
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
      if (!view.restored || (input?.onlyIfResumable && !view.resumable)) {
        if (input?.onlyIfResumable) {
          applyResumeSummary({ resumable: false });
        }
        return null;
      }
      applyRestoredSession(view);
      return view;
    } catch {
      // 恢复是纯增益路径：失败就走全新开始，不该把用户拦在门外
      return null;
    }
  }

  async function confirmResumeFromServer() {
    for (const delay of [200, 500, 1000]) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, delay);
      });
      const view = await restoreSession({ onlyIfResumable: true });
      if (view) {
        return;
      }
    }
    applyResumeSummary({ resumable: false });
  }

  async function start(input: {
    instruction: string;
    roundBudget: number;
    appearingCharacters?: string[];
    resume?: boolean;
  }): Promise<'ok' | 'error' | 'aborted' | 'busy'> {
    const chapter = options.chapter();
    if (!chapter || running.value) {
      return 'busy';
    }

    const started = tryStartAiTaskProgress(options.aiTaskProgress, {
      taskKey: CHAPTER_AUTO_LOOP_TASK_KEY,
      message: input.resume ? '从失败处继续自动优化…' : '自动优化循环启动中…',
      source: 'dialog:writing-optimize',
      chapterNo: chapter.chapterNo,
      interruptible: true,
    });
    if (!started.ok) {
      return 'busy';
    }

    running.value = true;
    stoppedByUser.value = false;
    if (!input.resume) {
      rounds.value = [];
      liveItems.value = [];
      promptLabCalls.value = [];
      activeRoundIndex.value = 0;
      restoredFromSession.value = false;
      applyResumeSummary({ resumable: false });
    }
    stoppedReason.value = null;
    errorMessage.value = '';
    statusText.value = input.resume ? '从失败处继续自动优化…' : '自动优化循环启动中…';

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
          ...(input.resume ? { resume: true } : {}),
        },
        {
          onStart: (event) => {
            baseUpdatedAt.value = event.baseUpdatedAt;
            activeRoundBudget.value = event.roundBudget;
            setStatus(`自动优化循环开始，最多 ${event.roundBudget} 轮`);
          },
          onStage: ({
            stage,
            roundIndex,
            segmentIndex,
            segmentTotal,
            windowIndex,
            windowTotal,
          }) => {
            if (windowIndex) {
              resumeWindowIndex.value = windowIndex;
            }
            if (windowTotal) {
              resumeWindowTotal.value = windowTotal;
            }
            const windowLabel = formatAutoLoopWindowPrefix(
              windowIndex ?? resumeWindowIndex.value,
              windowTotal ?? resumeWindowTotal.value
            );
            const roundLabel = roundIndex ? `第 ${roundIndex} 轮` : '';
            const head = [windowLabel, roundLabel].filter(Boolean).join(' ');
            if (stage === 'syncing_context') {
              setStatus('正在同步章节上下文…', stage);
              return;
            }
            if (stage === 'loop_diagnose') {
              resumeStage.value = 'diagnose';
              if (roundIndex) {
                resumeRoundIndex.value = roundIndex;
              }
              resumeSegmentIndex.value = 0;
              resumeSegmentTotal.value = 0;
              setStatus(head ? `${head}复诊中…` : '复诊中…', stage);
              return;
            }
            if (stage === 'loop_segment_rewrite') {
              resumeStage.value = 'rewrite';
              if (roundIndex) {
                resumeRoundIndex.value = roundIndex;
              }
              if (segmentIndex) {
                resumeSegmentIndex.value = segmentIndex;
              }
              if (segmentTotal) {
                resumeSegmentTotal.value = segmentTotal;
              }
              const position =
                segmentIndex && segmentTotal ? `（${segmentIndex}/${segmentTotal} 段）` : '';
              setStatus(head ? `${head}逐段改写中${position}` : `逐段改写中${position}`, stage);
              return;
            }
            setStatus(head ? `${head}整章校验中…` : '整章校验中…', stage);
          },
          onProgress: (event) => {
            setStatus(event.message, event.stage ?? 'running');
          },
          onWindowStart: ({ windowIndex, windowTotal }) => {
            resumeWindowIndex.value = windowIndex;
            resumeWindowTotal.value = windowTotal;
            liveItems.value = [];
            activeRoundIndex.value = 0;
            const windowLabel = formatAutoLoopWindowPrefix(windowIndex, windowTotal);
            if (windowLabel) {
              setStatus(`${windowLabel}开始，本窗最多 ${activeRoundBudget.value} 轮`);
            }
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
            const stamped: ChapterAutoLoopRound = {
              ...event.round,
              windowIndex:
                event.round.windowIndex ?? event.windowIndex ?? (resumeWindowIndex.value || 1),
              windowTotal:
                event.round.windowTotal ?? event.windowTotal ?? (resumeWindowTotal.value || 1),
            };
            rounds.value = upsertAutoLoopTimelineRound(rounds.value, stamped);
            liveItems.value = stamped.items;
            if (!stamped.rolledBack && stamped.draft.trim()) {
              options.onDraftAvailable(stamped.draft);
            }
          },
          onPromptLabCall: (call) => {
            const next = [...promptLabCalls.value];
            const index = next.findIndex((item) => item.id === call.id);
            if (index >= 0) {
              next[index] = call;
            } else {
              next.push(call);
            }
            promptLabCalls.value = next;
          },
          onEnd: (event) => {
            stoppedReason.value = event.stoppedReason;
            if (event.baseUpdatedAt) {
              baseUpdatedAt.value = event.baseUpdatedAt;
            }
            if (event.finalDraftText.trim()) {
              options.onDraftAvailable(event.finalDraftText);
            }
            applyResumeSummary(event);
            if (event.stoppedReason === 'plan_parse_failed') {
              outcome = 'error';
              return;
            }
            outcome = 'ok';
            statusText.value = describeAutoLoopStoppedReason(event.stoppedReason);
            completeAiTaskProgress(options.aiTaskProgress, statusText.value);
          },
          onError: (message) => {
            errorMessage.value = message;
            statusText.value = message;
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
        applyResumeSummary({ resumable: false });
        cancelAiTaskProgress(options.aiTaskProgress, '已停止自动优化循环');
        await confirmResumeFromServer();
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
    applyResumeSummary({ resumable: false });
    statusText.value = hasAcceptableDraft.value
      ? '已停止，保留最近完成轮的成稿'
      : '已停止，尚无完成轮成稿';
    cancelAiTaskProgress(options.aiTaskProgress, statusText.value);
    void confirmResumeFromServer();
  }

  return {
    running,
    rounds,
    liveItems,
    promptLabCalls,
    activeRoundIndex,
    activeRoundBudget,
    paragraphCount,
    stoppedReason,
    stoppedReasonText,
    baseUpdatedAt,
    statusText,
    errorMessage,
    restoredFromSession,
    resumable,
    canResume,
    resumeActionText,
    acceptableDraft,
    hasAcceptableDraft,
    liveWindowIndex: resumeWindowIndex,
    liveWindowTotal: resumeWindowTotal,
    start,
    stopAndAccept,
    restoreSession,
    reset,
  };
}
