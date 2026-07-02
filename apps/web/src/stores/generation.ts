import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  apiClient,
  type CitationItem,
  type ConsistencyNote,
  type GenerationPhase,
  type UsedRelationEventItem,
  type WriteChapterOutlineResult,
} from '../services/api';
import {
  applyAiTaskProgressEvent,
  cancelAiTaskProgress,
  completeAiTaskProgress,
  createAiTaskProgressState,
  failAiTaskProgress,
  resetAiTaskProgress,
  startAiTaskProgress,
} from '../composables/useAiTaskProgress';
import { isSseAbortError } from '../utils/sseStream';
import { presentError, presentErrorFromCaught } from '../utils/pageFeedback';

export type GenerationStatus = 'idle' | 'streaming' | 'done' | 'error';
export type OutlineStatus = 'idle' | 'streaming' | 'done' | 'error';

export const useGenerationStore = defineStore('generation', () => {
  const status = ref<GenerationStatus>('idle');
  const traceId = ref('');
  const chapterNo = ref(1);
  const draftText = ref('');
  const citations = ref<CitationItem[]>([]);
  const consistencyNotes = ref<ConsistencyNote[]>([]);
  const usedRelationEvents = ref<UsedRelationEventItem[]>([]);
  const errorMessage = ref('');
  const accepting = ref(false);
  const generationPhase = ref<GenerationPhase | null>(null);
  const phasePanelCollapsed = ref(false);
  const aiTaskProgress = createAiTaskProgressState();
  let outlineAbortController: AbortController | null = null;
  let draftAbortController: AbortController | null = null;

  const outlineStatus = ref<OutlineStatus>('idle');
  const outlineText = ref('');
  const outlineId = ref('');
  const outlineTraceId = ref('');
  const outlineConfirmed = ref(false);
  const outlineErrorMessage = ref('');

  const isStreaming = computed(() => status.value === 'streaming');
  const isDone = computed(() => status.value === 'done');
  const isError = computed(() => status.value === 'error');
  const isIdle = computed(() => status.value === 'idle');
  const isAccepting = computed(() => accepting.value);

  const isOutlineStreaming = computed(() => outlineStatus.value === 'streaming');
  const hasOutline = computed(
    () => outlineStatus.value === 'done' && Boolean(outlineText.value.trim())
  );

  function resetDraft() {
    status.value = 'idle';
    traceId.value = '';
    draftText.value = '';
    citations.value = [];
    consistencyNotes.value = [];
    usedRelationEvents.value = [];
    errorMessage.value = '';
    accepting.value = false;
    generationPhase.value = null;
    phasePanelCollapsed.value = false;
    resetAiTaskProgress(aiTaskProgress);
  }

  function resetOutline() {
    outlineStatus.value = 'idle';
    outlineText.value = '';
    outlineId.value = '';
    outlineTraceId.value = '';
    outlineConfirmed.value = false;
    outlineErrorMessage.value = '';
  }

  function reset() {
    resetDraft();
    resetOutline();
    chapterNo.value = 1;
  }

  function invalidateOutlineConfirmation() {
    outlineConfirmed.value = false;
  }

  function setOutlineText(value: string) {
    if (outlineText.value !== value) {
      outlineText.value = value;
      invalidateOutlineConfirmation();
    }
  }

  function confirmOutline() {
    if (!outlineText.value.trim()) {
      outlineErrorMessage.value = presentError('大纲内容为空，无法确认');
      return false;
    }
    outlineConfirmed.value = true;
    outlineErrorMessage.value = '';
    return true;
  }

  type WriteTask = {
    chapterNo: number;
    goal: string;
    pov: string;
    mustInclude: string[];
    avoid: string[];
    targetWords?: number;
    appearingCharacters?: string[];
    selectedEventIds?: string[];
  };

  function interruptStreaming() {
    outlineAbortController?.abort();
    draftAbortController?.abort();
    outlineAbortController = null;
    draftAbortController = null;
    if (outlineStatus.value === 'streaming') {
      outlineStatus.value = 'idle';
      cancelAiTaskProgress(aiTaskProgress, '大纲生成已中断');
    }
    if (status.value === 'streaming') {
      status.value = 'idle';
      cancelAiTaskProgress(aiTaskProgress, '正文生成已中断');
    }
  }

  async function generateOutline(projectId: string, task: WriteTask) {
    resetOutline();
    resetDraft();
    outlineStatus.value = 'streaming';
    outlineText.value = '';
    chapterNo.value = task.chapterNo;
    outlineAbortController?.abort();
    outlineAbortController = new AbortController();

    try {
      await apiClient.generateWriteOutlineSSE(
        projectId,
        task,
        {
        onStart: (event) => {
          outlineId.value = event.outlineId;
          outlineTraceId.value = event.traceId;
          chapterNo.value = event.chapterNo;
        },
        onContent: (text) => {
          outlineText.value += text;
        },
        onEnd: (result: WriteChapterOutlineResult) => {
          outlineText.value = result.outlineText;
          outlineId.value = result.outlineId;
          outlineTraceId.value = result.traceId;
          outlineStatus.value = 'done';
          invalidateOutlineConfirmation();
        },
        onError: (msg) => {
          outlineErrorMessage.value = presentError(msg);
          outlineStatus.value = 'error';
        },
      },
      { signal: outlineAbortController.signal }
      );
    } catch (error) {
      if (isSseAbortError(error)) {
        cancelAiTaskProgress(aiTaskProgress, '大纲生成已中断');
        outlineStatus.value = 'idle';
        return;
      }
      outlineErrorMessage.value = presentErrorFromCaught(error, '生成章节大纲失败');
      outlineStatus.value = 'error';
    } finally {
      outlineAbortController = null;
    }
  }

  async function generate(
    projectId: string,
    task: WriteTask
  ) {
    if (!outlineConfirmed.value || !outlineText.value.trim()) {
      errorMessage.value = presentError('请先确认章节大纲后再生成正文');
      return;
    }

    resetDraft();
    status.value = 'streaming';
    draftText.value = '';
    resetAiTaskProgress(aiTaskProgress);
    startAiTaskProgress(aiTaskProgress, {
      taskKey: 'write.chapter.draft',
      message: '正在生成章节正文…',
    });
    draftAbortController?.abort();
    draftAbortController = new AbortController();

    try {
      await apiClient.generateDraftSSE(
        projectId,
        task,
        {
          confirmedOutlineText: outlineText.value.trim(),
          outlineId: outlineId.value || undefined,
          outlineTraceId: outlineTraceId.value || undefined,
        },
        [],
        {
          onPhase: (phase) => {
            generationPhase.value = phase;
            phasePanelCollapsed.value = false;
            if (phase === 'content_safety_scan') {
              applyAiTaskProgressEvent(aiTaskProgress, {
                traceId: traceId.value || undefined,
                taskKey: 'write.chapter.draft',
                stage: phase,
                message: '正在执行内容安全扫描…',
              });
            }
          },
          onProgress: (event) => {
            applyAiTaskProgressEvent(aiTaskProgress, event);
          },
          onStart: (id, chNo) => {
            traceId.value = id;
            chapterNo.value = chNo;
            applyAiTaskProgressEvent(aiTaskProgress, {
              traceId: id,
              taskKey: 'write.chapter.draft',
              stage: 'start',
              message: '正在整理叙事上下文…',
            });
          },
          onContent: (text) => {
            draftText.value += text;
          },
          onContentReplace: (text) => {
            draftText.value = text;
          },
          onEnd: (id, cites, notes, usedEvents, meta) => {
            traceId.value = id;
            if (meta?.finalText) {
              draftText.value = meta.finalText;
            }
            citations.value = cites;
            consistencyNotes.value = notes;
            usedRelationEvents.value = usedEvents;
            status.value = 'done';
            phasePanelCollapsed.value = true;
            completeAiTaskProgress(aiTaskProgress, '章节正文生成完成');
          },
          onError: (msg) => {
            errorMessage.value = presentError(msg);
            status.value = 'error';
            failAiTaskProgress(aiTaskProgress, msg, traceId.value || undefined);
          },
        },
        { signal: draftAbortController.signal }
      );
    } catch (error) {
      if (isSseAbortError(error)) {
        cancelAiTaskProgress(aiTaskProgress, '正文生成已中断');
        status.value = 'idle';
        return;
      }
      errorMessage.value = presentErrorFromCaught(error, '生成请求失败');
      status.value = 'error';
    } finally {
      draftAbortController = null;
    }
  }

  async function acceptDraft(projectId: string, chapterNoVal: number) {
    if (!draftText.value.trim()) {
      errorMessage.value = presentError('草稿内容为空，无法接受');
      return;
    }

    accepting.value = true;
    try {
      await apiClient.upsertChapter(projectId, {
        chapterNo: chapterNoVal,
        title: `第${chapterNoVal}章`,
        content: draftText.value,
      });
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '接受草稿失败');
    } finally {
      accepting.value = false;
    }
  }

  return {
    status,
    traceId,
    chapterNo,
    draftText,
    citations,
    consistencyNotes,
    usedRelationEvents,
    errorMessage,
    accepting,
    generationPhase,
    phasePanelCollapsed,
    aiTaskProgress,
    outlineStatus,
    outlineText,
    outlineId,
    outlineTraceId,
    outlineConfirmed,
    outlineErrorMessage,
    isStreaming,
    isDone,
    isError,
    isIdle,
    isAccepting,
    isOutlineStreaming,
    hasOutline,
    reset,
    resetDraft,
    resetOutline,
    invalidateOutlineConfirmation,
    setOutlineText,
    confirmOutline,
    generateOutline,
    generate,
    interruptStreaming,
    acceptDraft,
  };
});
