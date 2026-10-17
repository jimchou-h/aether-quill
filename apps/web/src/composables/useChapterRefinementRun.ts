/**
 * 章节精修编排前端编排（AQ-380 基线）。
 *
 * 一次要求 → 一次启动 → 后台独立 run。SSE 只做观察：关闭面板只结束订阅，
 * 不会取消后台 run；重新打开时用 `restore()` 按 run 列表恢复状态。
 */

import { computed, shallowRef } from 'vue';
import { apiClient, type ChapterItem } from '../services/api';
import { useAbortableSse } from './useAbortableSse';
import { isSseAbortError } from '../utils/sseStream';
import { presentErrorFromCaught, presentInfo } from '../utils/pageFeedback';
import {
  buildRefinementApplyPayload,
  canCancelRefinementRun,
  canDiscardRefinementRun,
  canResumeRefinementRun,
  createRefinementStartRequestIdTracker,
  describeRefinementPauseState,
  formatRefinementPhaseLabel,
  formatRefinementStatusLabel,
  isRefinementActive,
  isRefinementCandidateReady,
  resolveRefinementApplyGate,
  resolveRefinementProgressPercent,
  resolveRefinementResumeRun,
  type RefinementRewritePolicy,
  type RefinementRunSummary,
  type RefinementRunView,
} from '../utils/chapterRefinement';

export interface UseChapterRefinementRunOptions {
  projectId: () => string;
  chapter: () => ChapterItem | null;
  /** 应用成功后的回调：用于刷新编辑器正文（复用旧 apply 副作用） */
  onApplied?: (chapter: ChapterItem) => void;
  /** 测试注入：默认使用真实 apiClient；传入假实现可对 composable 做无网络单测 */
  api?: typeof apiClient;
}

export function useChapterRefinementRun(options: UseChapterRefinementRunOptions) {
  const api = options.api ?? apiClient;
  const instruction = shallowRef('');
  const rewritePolicy = shallowRef<RefinementRewritePolicy>('preserve-plot');
  const run = shallowRef<RefinementRunView | null>(null);
  const runs = shallowRef<RefinementRunSummary[]>([]);
  const starting = shallowRef(false);
  const observing = shallowRef(false);
  const restoring = shallowRef(false);
  const applying = shallowRef(false);
  const cancelling = shallowRef(false);
  const resuming = shallowRef(false);
  const discarding = shallowRef(false);
  const statusText = shallowRef('');
  const errorMessage = shallowRef('');
  const observeStream = useAbortableSse();
  // W2：幂等键生命周期——新逻辑运行分配新 key，同一次创建请求的重试保留 key
  const startRequestIds = createRefinementStartRequestIdTracker();

  const status = computed(() => run.value?.status ?? null);
  const isActive = computed(() => (status.value ? isRefinementActive(status.value) : false));
  const isReady = computed(() => (status.value ? isRefinementCandidateReady(status.value) : false));
  const isBusy = computed(() => starting.value || isActive.value);
  const storageMode = computed(() => run.value?.storageMode ?? runs.value[0]?.storageMode ?? null);
  const baseText = computed(() => run.value?.baseText ?? '');
  const candidateText = computed(() => run.value?.acceptedDraftText ?? '');
  const statusLabel = computed(() =>
    run.value ? formatRefinementStatusLabel(run.value.status) : ''
  );
  const phaseLabel = computed(() => (run.value ? formatRefinementPhaseLabel(run.value.phase) : ''));
  const progressPercent = computed(() => {
    if (!run.value) {
      return 0;
    }
    return resolveRefinementProgressPercent(run.value.progress, run.value.status, run.value.phase);
  });
  const canStart = computed(() => Boolean(instruction.value.trim()) && !isBusy.value);
  const sourceChanged = computed(() => (run.value ? !run.value.sourceCurrent : false));
  const applyGate = computed(() => resolveRefinementApplyGate(run.value));
  const canApply = computed(() => applyGate.value.canApply && !applying.value);
  const canCancel = computed(() => canCancelRefinementRun(run.value) && !cancelling.value);
  const canResume = computed(() => canResumeRefinementRun(run.value) && !resuming.value);
  const canDiscard = computed(() => canDiscardRefinementRun(run.value) && !discarding.value);
  const pauseHint = computed(() => (run.value ? describeRefinementPauseState(run.value) : ''));

  function reset() {
    observeStream.abort();
    instruction.value = '';
    rewritePolicy.value = 'preserve-plot';
    run.value = null;
    runs.value = [];
    starting.value = false;
    observing.value = false;
    restoring.value = false;
    applying.value = false;
    cancelling.value = false;
    resuming.value = false;
    discarding.value = false;
    statusText.value = '';
    errorMessage.value = '';
    startRequestIds.reset();
  }

  /** 只结束观察，不影响后台 run。 */
  function closeObservation() {
    observeStream.abort();
    observing.value = false;
  }

  async function refreshRuns() {
    const chapter = options.chapter();
    if (!options.projectId() || !chapter) {
      runs.value = [];
      return;
    }
    try {
      runs.value = await api.listChapterRefinementRuns(options.projectId(), chapter.chapterNo);
    } catch (error) {
      runs.value = [];
      presentErrorFromCaught(error, '读取精修历史失败');
    }
  }

  async function loadRun(runId: string): Promise<RefinementRunView | null> {
    const chapter = options.chapter();
    if (!options.projectId() || !chapter) {
      return null;
    }
    const view = await api.getChapterRefinementRun(options.projectId(), chapter.chapterNo, runId);
    run.value = view;
    return view;
  }

  function applyStageProgress(event: {
    runId: string;
    revision: number;
    phase: RefinementRunView['phase'];
    unitIndex: number;
    unitTotal: number;
    sceneId?: string;
    message: string;
  }) {
    const current = run.value;
    if (!current || current.runId !== event.runId) {
      return;
    }
    run.value = {
      ...current,
      revision: event.revision,
      phase: event.phase,
      progress: {
        unitIndex: event.unitIndex,
        unitTotal: event.unitTotal,
        ...(event.sceneId ? { sceneId: event.sceneId } : {}),
        message: event.message,
      },
    };
  }

  async function refreshAfterFinish(runId: string) {
    try {
      await loadRun(runId);
    } catch (error) {
      presentErrorFromCaught(error, '读取精修候选失败');
    }
    await refreshRuns();
  }

  function observe(runId: string) {
    const chapter = options.chapter();
    if (!options.projectId() || !chapter) {
      return;
    }
    closeObservation();
    const signal = observeStream.begin();
    observing.value = true;
    void api
      .observeChapterRefinementRunSSE(
        options.projectId(),
        chapter.chapterNo,
        runId,
        (event) => {
          switch (event.event) {
            case 'snapshot':
              run.value = event.run;
              break;
            case 'stage':
              applyStageProgress(event);
              break;
            case 'paused':
              // 暂停只带摘要；回表拉权威 view 以展示已接受候选与暂停原因
              void refreshAfterFinish(runId);
              break;
            case 'finished':
              // finished 只带摘要，候选正文需回表拉权威 view
              void refreshAfterFinish(runId);
              break;
            case 'error':
              errorMessage.value = event.message;
              break;
          }
        },
        { signal }
      )
      .catch((error) => {
        if (isSseAbortError(error)) {
          return;
        }
        presentErrorFromCaught(error, '精修进度观察中断');
      })
      .finally(() => {
        observing.value = false;
      });
  }

  async function start() {
    const chapter = options.chapter();
    if (!chapter || !canStart.value) {
      return;
    }
    errorMessage.value = '';
    statusText.value = '';
    starting.value = true;
    // W2：一次逻辑运行使用同一个幂等键；创建成功后再轮换，
    // 使「完成后再次启动」是新的一次运行，而不是复用旧 key 命中旧 run。
    // 创建失败（含响应丢失）时保留当前 key，重试仍然幂等。
    const requestId = startRequestIds.begin();
    try {
      const summary = await api.createChapterRefinementRun(options.projectId(), chapter.chapterNo, {
        clientRequestId: requestId,
        expectedChapterUpdatedAt: chapter.updatedAt,
        instruction: instruction.value.trim(),
        rewritePolicy: rewritePolicy.value,
      });
      startRequestIds.commit();
      await loadRun(summary.runId);
      observe(summary.runId);
      await refreshRuns();
      statusText.value = presentInfo('已启动智能精修；可以关闭面板，稍后回来查看结果。');
    } catch (error) {
      presentErrorFromCaught(error, '发起智能精修失败');
    } finally {
      starting.value = false;
    }
  }

  /** 打开历史 run：终态直接展示候选，活动态继续订阅。 */
  async function openRun(runId: string) {
    errorMessage.value = '';
    try {
      const view = await loadRun(runId);
      if (!view) {
        return;
      }
      if (isRefinementActive(view.status)) {
        observe(runId);
      } else {
        closeObservation();
      }
    } catch (error) {
      presentErrorFromCaught(error, '读取精修运行失败');
    }
  }

  /** 应用候选：复用旧 apply 入口，planId=runId，保留摘要，成功后回填编辑器正文。 */
  async function apply(): Promise<boolean> {
    const chapter = options.chapter();
    const current = run.value;
    if (!chapter || !current || !canApply.value) {
      return false;
    }
    applying.value = true;
    errorMessage.value = '';
    try {
      const payload = buildRefinementApplyPayload({
        runId: current.runId,
        baseUpdatedAt: current.baseUpdatedAt,
        draftText: current.acceptedDraftText,
      });
      const result = await api.applyChapterOptimization(
        options.projectId(),
        chapter.chapterNo,
        payload
      );
      statusText.value = presentInfo('智能精修正文已应用，编辑器已刷新。');
      options.onApplied?.(result.chapter);
      return true;
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '应用智能精修正文失败');
      return false;
    } finally {
      applying.value = false;
    }
  }

  /** 5.1：取消当前执行尝试；已接受稿保留，可在历史里继续。 */
  async function cancel(): Promise<boolean> {
    const chapter = options.chapter();
    const current = run.value;
    if (!chapter || !current || !canCancel.value) {
      return false;
    }
    cancelling.value = true;
    errorMessage.value = '';
    try {
      await api.cancelChapterRefinementRun(options.projectId(), chapter.chapterNo, current.runId, {
        expectedAttemptId: current.attemptId ?? null,
      });
      closeObservation();
      await refreshAfterFinish(current.runId);
      statusText.value = presentInfo('已取消智能精修，当前成果已保留，可稍后继续。');
      return true;
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '取消智能精修失败');
      return false;
    } finally {
      cancelling.value = false;
    }
  }

  /** 5.1：从 checkpoint 继续；后台另开执行尝试，前端重新订阅。 */
  async function resume(): Promise<boolean> {
    const chapter = options.chapter();
    const current = run.value;
    if (!chapter || !current || !canResume.value) {
      return false;
    }
    resuming.value = true;
    errorMessage.value = '';
    try {
      await api.resumeChapterRefinementRun(options.projectId(), chapter.chapterNo, current.runId, {
        expectedRunRevision: current.revision,
      });
      await loadRun(current.runId);
      observe(current.runId);
      await refreshRuns();
      statusText.value = presentInfo('已继续智能精修，将从断点继续执行。');
      return true;
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '继续智能精修失败');
      return false;
    } finally {
      resuming.value = false;
    }
  }

  /** 5.1：放弃运行并清理候选材料；不触碰章节正文。 */
  async function discard(): Promise<boolean> {
    const chapter = options.chapter();
    const current = run.value;
    if (!chapter || !current || !canDiscard.value) {
      return false;
    }
    discarding.value = true;
    errorMessage.value = '';
    try {
      await api.discardChapterRefinementRun(options.projectId(), chapter.chapterNo, current.runId, {
        expectedRunRevision: current.revision,
      });
      closeObservation();
      run.value = null;
      await refreshRuns();
      statusText.value = presentInfo('已放弃该次智能精修，候选材料已清理（章节正文未改动）。');
      return true;
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '放弃智能精修失败');
      return false;
    } finally {
      discarding.value = false;
    }
  }

  /** 面板（重新）挂载时恢复：优先活动 run，否则最近一次终态 run。 */
  async function restore() {
    const chapter = options.chapter();
    if (!options.projectId() || !chapter) {
      return;
    }
    restoring.value = true;
    errorMessage.value = '';
    try {
      await refreshRuns();
      const target = resolveRefinementResumeRun(runs.value);
      if (!target) {
        run.value = null;
        return;
      }
      await loadRun(target.runId);
      if (isRefinementActive(target.status)) {
        observe(target.runId);
      }
    } catch (error) {
      run.value = null;
      presentErrorFromCaught(error, '恢复精修状态失败');
    } finally {
      restoring.value = false;
    }
  }

  return {
    instruction,
    rewritePolicy,
    run,
    runs,
    starting,
    observing,
    restoring,
    applying,
    cancelling,
    resuming,
    discarding,
    statusText,
    errorMessage,
    status,
    isActive,
    isReady,
    isBusy,
    storageMode,
    baseText,
    candidateText,
    statusLabel,
    phaseLabel,
    progressPercent,
    canStart,
    canApply,
    canCancel,
    canResume,
    canDiscard,
    pauseHint,
    applyGate,
    sourceChanged,
    start,
    apply,
    cancel,
    resume,
    discard,
    restore,
    openRun,
    reset,
    closeObservation,
  };
}
