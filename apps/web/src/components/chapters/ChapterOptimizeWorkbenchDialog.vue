<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { apiClient, formatChapterOptimizeStageLabel, type ChapterItem } from '../../services/api';
import { useAbortableSse } from '../../composables/useAbortableSse';
import { confirmAction } from '../../composables/useAppConfirm';
import {
  applyAiTaskProgressEvent,
  cancelAiTaskProgress,
  completeAiTaskProgress,
  dismissIdleAiTaskProgress,
  failAiTaskProgress,
  tryStartAiTaskProgress,
} from '../../composables/useAiTaskProgress';
import {
  useChapterAiActivityInterrupt,
  useChapterPageAiActivity,
} from '../../composables/chapterAiActivityContext';
import { isSseAbortError } from '../../utils/sseStream';
import { presentErrorFromCaught, presentInfo, presentSuccess } from '../../utils/pageFeedback';
import { resolveChapterOptimizePrepProgress } from '../../utils/chapterOptimizePrepProgress';
import { shouldRenderOptimizeDiff } from '../../utils/chapterOptimizeDiff';
import { createThrottledTextSink } from '../../utils/throttledTextSink';
import {
  buildWorkbenchDraftModeFields,
  canConfirmWorkbenchPlan,
  canGenerateWorkbenchDraft,
  describeInvalidWorkbenchRange,
  describeSceneRangeOverflow,
  describeWorkbenchRangeBinding,
  isNearCopyWorkbenchDraft,
  isSceneRewriteMode,
  filterWorkbenchReviewItemsForMode,
  locateUniqueAnchor,
  normalizeWorkbenchReviewItems,
  applyWorkbenchSseEndText,
  resolveWorkbenchApplyOffsets,
  resolveWorkbenchCreationSteps,
  resolveWorkbenchDraftProfile,
  resolveWorkbenchReviewProfile,
  resolveWorkbenchSseEndText,
  sliceSpanNeighborhood,
  spliceChapterRange,
  type WorkbenchCreationMode,
  type WorkbenchReviewItem,
  type WorkbenchStepKey,
} from '../../utils/chapterOptimizeWorkbench';
import AiTaskProgressPanel from '../common/AiTaskProgressPanel.vue';
import SseInterruptButton from '../common/SseInterruptButton.vue';
import ChapterOptimizeComparePane from './ChapterOptimizeComparePane.vue';

type WorkbenchStep = WorkbenchStepKey;
type ReviewRowStatus = 'pending' | 'applied' | 'skipped_unlocatable' | 'failed';

interface ReviewRow extends WorkbenchReviewItem {
  status: ReviewRowStatus;
  skipReason?: string;
}

const KIND_LABEL: Record<string, string> = {
  pose: '动作',
  vocab: '用词',
  regression: '改差',
};

const INSTRUCTION_PLACEHOLDER: Record<WorkbenchCreationMode, string> = {
  sex: '例如：在划选范围内加深感官与节奏，保持时序与空间连续，不要省略中间过程。',
  prose: '例如：理顺划选范围内的节奏、对白与衔接，不要增色或堆砌特写。',
  scene: '例如：这一场删掉中间过渡拍、把冲突提前，末拍落在原定散场状态；不要越出范围。',
};

const props = defineProps<{
  visible: boolean;
  projectId: string;
  chapter: ChapterItem | null;
}>();

const emit = defineEmits<{
  close: [];
  applied: [chapter: ChapterItem];
}>();

const step = shallowRef<WorkbenchStep>('range');
const creationMode = shallowRef<WorkbenchCreationMode>('prose');
const instruction = shallowRef('');
const planText = shallowRef('');
const planConfirmed = shallowRef(false);
const planning = shallowRef(false);
const spanInstruction = shallowRef('');
const baseText = shallowRef('');
const baseUpdatedAt = shallowRef('');
const rangeStart = shallowRef(0);
const rangeEnd = shallowRef(0);
const hasRange = shallowRef(false);
const committedStart = shallowRef(0);
const committedEnd = shallowRef(0);
const committedOriginal = shallowRef('');
const rangeDraft = shallowRef('');
const reviewItems = ref<ReviewRow[]>([]);
const reviewed = shallowRef(false);
const statusText = shallowRef('');
const errorMessage = shallowRef('');
const generating = shallowRef(false);
const reviewing = shallowRef(false);
const fixing = shallowRef(false);
const applying = shallowRef(false);
const sseStream = useAbortableSse();
const aiTaskProgress = useChapterPageAiActivity();
const activityInterruptHandler = useChapterAiActivityInterrupt();
const frozenTextareaRef = ref<HTMLTextAreaElement | null>(null);
const rangeDraftTextareaRef = ref<HTMLTextAreaElement | null>(null);

const isBusy = computed(
  () => generating.value || planning.value || reviewing.value || fixing.value || applying.value
);
const isSceneMode = computed(() => isSceneRewriteMode(creationMode.value));
const stepperSteps = computed(() => resolveWorkbenchCreationSteps(creationMode.value));
const draftProfile = computed(() => resolveWorkbenchDraftProfile(creationMode.value));
const reviewProfile = computed(() => resolveWorkbenchReviewProfile(creationMode.value));
const selectedRangeText = computed(() =>
  hasRange.value ? baseText.value.slice(rangeStart.value, rangeEnd.value) : ''
);
const rangeChars = computed(() => selectedRangeText.value.length);
const rangeOverflowHint = computed(() =>
  isSceneMode.value ? describeSceneRangeOverflow(rangeChars.value) : null
);
const applyOffsets = computed(() =>
  resolveWorkbenchApplyOffsets({
    draftText: rangeDraft.value,
    committedStart: committedStart.value,
    committedEnd: committedEnd.value,
    selectedStart: rangeStart.value,
    selectedEnd: rangeEnd.value,
  })
);
const previewText = computed(() => {
  if (!rangeDraft.value) {
    return baseText.value;
  }
  return spliceChapterRange(
    baseText.value,
    applyOffsets.value.start,
    applyOffsets.value.end,
    rangeDraft.value
  );
});
const rangeMeta = computed(() =>
  describeWorkbenchRangeBinding({
    hasSelectedRange: hasRange.value,
    selectedStart: rangeStart.value,
    selectedEnd: rangeEnd.value,
    selectedChars: selectedRangeText.value.length,
    hasDraft: Boolean(rangeDraft.value),
    committedStart: committedStart.value,
    committedEnd: committedEnd.value,
    committedChars: committedOriginal.value.length,
  })
);
const showRangeCompare = computed(
  () => Boolean(committedOriginal.value) && (Boolean(rangeDraft.value.trim()) || generating.value)
);
const instructionPlaceholder = computed(() => INSTRUCTION_PLACEHOLDER[creationMode.value]);
const canGenerate = computed(() =>
  canGenerateWorkbenchDraft({
    mode: creationMode.value,
    hasRange: hasRange.value,
    rangeChars: rangeChars.value,
    instruction: instruction.value,
    planConfirmed: planConfirmed.value,
    busy: isBusy.value,
  })
);
const canPlan = computed(
  () =>
    Boolean(instruction.value.trim()) && hasRange.value && !isBusy.value && !rangeOverflowHint.value
);
const canConfirmPlan = computed(() => canConfirmWorkbenchPlan(planText.value) && !isBusy.value);
const canReview = computed(() => Boolean(rangeDraft.value.trim()) && !isBusy.value);
const canApply = computed(() => Boolean(rangeDraft.value.trim()) && !isBusy.value);
const canFixSelection = computed(
  () => Boolean(rangeDraft.value.trim()) && Boolean(spanInstruction.value.trim()) && !isBusy.value
);

function stepperClass(key: WorkbenchStep): string {
  const order = stepperSteps.value.map((entry) => entry.key);
  const currentIndex = order.indexOf(step.value);
  const keyIndex = order.indexOf(key);
  if (keyIndex < currentIndex) {
    return 'step--done';
  }
  if (key === step.value) {
    if (
      (key === 'generate' && generating.value) ||
      (key === 'plan' && planning.value) ||
      (key === 'review' && (reviewing.value || fixing.value))
    ) {
      return 'step--running';
    }
    if (key === 'apply' && canApply.value) {
      return 'step--awaiting';
    }
    if (key === 'review' && reviewed.value) {
      return 'step--awaiting';
    }
    if (key === 'generate' && rangeDraft.value.trim()) {
      return 'step--awaiting';
    }
    if (key === 'plan' && planConfirmed.value) {
      return 'step--awaiting';
    }
    return 'active';
  }
  return '';
}

function bindInterruptHandler() {
  if (activityInterruptHandler) {
    activityInterruptHandler.value = () => interruptGeneration();
  }
}

function clearInterruptHandler() {
  if (activityInterruptHandler) {
    activityInterruptHandler.value = null;
  }
}

function resetState() {
  step.value = 'range';
  creationMode.value = 'prose';
  instruction.value = '';
  planText.value = '';
  planConfirmed.value = false;
  planning.value = false;
  spanInstruction.value = '';
  baseText.value = props.chapter?.content ?? '';
  baseUpdatedAt.value = props.chapter?.updatedAt ?? '';
  rangeStart.value = 0;
  rangeEnd.value = 0;
  hasRange.value = false;
  committedStart.value = 0;
  committedEnd.value = 0;
  committedOriginal.value = '';
  rangeDraft.value = '';
  reviewItems.value = [];
  reviewed.value = false;
  statusText.value = '';
  errorMessage.value = '';
  generating.value = false;
  reviewing.value = false;
  fixing.value = false;
  applying.value = false;
  sseStream.abort();
  clearInterruptHandler();
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      dismissIdleAiTaskProgress(aiTaskProgress);
      resetState();
    } else {
      dismissIdleAiTaskProgress(aiTaskProgress);
    }
  },
  { immediate: true }
);

watch(creationMode, () => {
  planConfirmed.value = false;
  if (step.value === 'plan') {
    step.value = 'range';
  }
});

watch(planText, () => {
  if (planConfirmed.value) {
    planConfirmed.value = false;
  }
});

function close() {
  if (generating.value || planning.value || fixing.value) {
    sseStream.abort();
  }
  if (!applying.value) {
    emit('close');
  }
}

function interruptGeneration() {
  sseStream.abort();
  generating.value = false;
  planning.value = false;
  fixing.value = false;
  cancelAiTaskProgress(aiTaskProgress, '已中断按场成稿生成');
  statusText.value = presentInfo('已中断按场成稿生成');
  clearInterruptHandler();
}

function captureFrozenRange() {
  const el = frozenTextareaRef.value;
  if (!el) {
    return;
  }
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start >= end) {
    return;
  }
  const invalid = describeInvalidWorkbenchRange(start, end, baseText.value);
  if (invalid) {
    errorMessage.value = invalid;
    return;
  }
  const changed = start !== rangeStart.value || end !== rangeEnd.value;
  rangeStart.value = start;
  rangeEnd.value = end;
  hasRange.value = true;
  errorMessage.value = '';
  if (changed && planConfirmed.value) {
    planConfirmed.value = false;
  }
  if (!rangeDraft.value) {
    step.value = 'range';
  }
}

function currentDraftSelection(): { start: number; end: number } | null {
  const el = rangeDraftTextareaRef.value;
  if (!el) {
    return null;
  }
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end) {
    return null;
  }
  return { start, end };
}

async function generateScenePlan() {
  const chapter = props.chapter;
  if (!chapter) {
    return;
  }
  const rangeError = describeInvalidWorkbenchRange(
    rangeStart.value,
    rangeEnd.value,
    baseText.value
  );
  if (!hasRange.value || rangeError) {
    errorMessage.value = rangeError ?? '请在冻结正文中划选连续范围';
    return;
  }
  if (!instruction.value.trim()) {
    errorMessage.value = '请填写创编要求';
    return;
  }
  const overflow = rangeOverflowHint.value;
  if (overflow) {
    errorMessage.value = overflow;
    return;
  }

  const started = tryStartAiTaskProgress(aiTaskProgress, {
    taskKey: 'chapter.optimize.workbench-plan',
    message: '正在生成创编方案…',
    source: 'dialog:scene-workbench',
    chapterNo: chapter.chapterNo,
    interruptible: true,
  });
  if (!started.ok) {
    errorMessage.value = '当前有其他 AI 任务进行中，请先等待或中断';
    return;
  }

  planning.value = true;
  errorMessage.value = '';
  statusText.value = '正在生成创编方案…';
  planConfirmed.value = false;
  planText.value = '';
  step.value = 'plan';
  const signal = sseStream.begin();
  bindInterruptHandler();
  const planSink = createThrottledTextSink(planText);

  try {
    await apiClient.optimizeWorkbenchPlanSSE(
      props.projectId,
      chapter.chapterNo,
      {
        instruction: instruction.value.trim(),
        profile: draftProfile.value,
        startOffset: rangeStart.value,
        endOffset: rangeEnd.value,
        baseUpdatedAt: baseUpdatedAt.value,
        sourceText: baseText.value,
      },
      {
        onStart: () => {
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.workbench-plan',
            stage: 'running',
            message: '正在生成创编方案…',
          });
        },
        onStage: ({ stage, segmentIndex, segmentTotal }) => {
          const label = formatChapterOptimizeStageLabel(stage, segmentIndex, segmentTotal);
          statusText.value = label;
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.workbench-plan',
            stage,
            message: label,
          });
        },
        onContent: (text) => {
          planSink.append(text);
        },
        onEnd: (event) => {
          planSink.flush();
          planText.value = applyWorkbenchSseEndText(planText.value, event.planText);
          if (!planText.value.trim()) {
            errorMessage.value = '未收到有效创编方案';
            failAiTaskProgress(aiTaskProgress, errorMessage.value);
            return;
          }
          statusText.value = '方案已生成，请确认或编辑后确认';
          completeAiTaskProgress(aiTaskProgress, statusText.value);
        },
        onError: (messageText) => {
          errorMessage.value = messageText;
          failAiTaskProgress(aiTaskProgress, messageText);
        },
      },
      { signal }
    );
  } catch (error) {
    if (isSseAbortError(error)) {
      cancelAiTaskProgress(aiTaskProgress, '已中断创编方案生成');
    } else {
      errorMessage.value = presentErrorFromCaught(error, '创编方案生成失败');
      failAiTaskProgress(aiTaskProgress, errorMessage.value);
    }
  } finally {
    planSink.flush();
    planSink.dispose();
    planning.value = false;
    sseStream.abort();
    clearInterruptHandler();
  }
}

function confirmPlan() {
  if (!canConfirmWorkbenchPlan(planText.value)) {
    errorMessage.value = '方案为空，请先生成或手动填写';
    return;
  }
  planConfirmed.value = true;
  errorMessage.value = '';
  statusText.value = '方案已确认，可以生成范围成稿';
}

async function generateRangeDraft() {
  const chapter = props.chapter;
  if (!chapter) {
    return;
  }
  const rangeError = describeInvalidWorkbenchRange(
    rangeStart.value,
    rangeEnd.value,
    baseText.value
  );
  if (!hasRange.value || rangeError) {
    errorMessage.value = rangeError ?? '请在冻结正文中划选连续范围';
    return;
  }
  if (!instruction.value.trim()) {
    errorMessage.value = '请填写优化要求';
    return;
  }
  if (isSceneMode.value) {
    if (rangeOverflowHint.value) {
      errorMessage.value = rangeOverflowHint.value;
      return;
    }
    if (!planConfirmed.value || !planText.value.trim()) {
      errorMessage.value = '请先生成并确认创编方案';
      return;
    }
  }

  const started = tryStartAiTaskProgress(aiTaskProgress, {
    taskKey: 'chapter.optimize.workbench-draft',
    message: '正在生成范围内成稿…',
    source: 'dialog:scene-workbench',
    chapterNo: chapter.chapterNo,
    interruptible: true,
  });
  if (!started.ok) {
    errorMessage.value = '当前有其他 AI 任务进行中，请先等待或中断';
    return;
  }

  generating.value = true;
  errorMessage.value = '';
  statusText.value = '正在生成范围内成稿…';
  committedStart.value = rangeStart.value;
  committedEnd.value = rangeEnd.value;
  committedOriginal.value = baseText.value.slice(rangeStart.value, rangeEnd.value);
  rangeDraft.value = '';
  reviewItems.value = [];
  reviewed.value = false;
  step.value = 'generate';
  const signal = sseStream.begin();
  bindInterruptHandler();
  const draftSink = createThrottledTextSink(rangeDraft);

  try {
    await apiClient.optimizeWorkbenchDraftSSE(
      props.projectId,
      chapter.chapterNo,
      {
        instruction: instruction.value.trim(),
        profile: draftProfile.value,
        ...buildWorkbenchDraftModeFields(creationMode.value, planText.value),
        startOffset: rangeStart.value,
        endOffset: rangeEnd.value,
        baseUpdatedAt: baseUpdatedAt.value,
        sourceText: baseText.value,
      },
      {
        onStart: (event) => {
          statusText.value = event.strategyLabel
            ? `正在生成范围内成稿… · ${event.strategyLabel}`
            : '正在生成范围内成稿…';
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.workbench-draft',
            stage: 'running',
            message: statusText.value,
          });
        },
        onStage: ({ stage, segmentIndex, segmentTotal }) => {
          const base = formatChapterOptimizeStageLabel(stage, segmentIndex, segmentTotal);
          const label =
            segmentTotal && segmentTotal > 1 && segmentIndex
              ? `${base} · 同场续写 ${segmentIndex}/${segmentTotal}`
              : base;
          statusText.value = label;
          const prep = resolveChapterOptimizePrepProgress(stage);
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.workbench-draft',
            stage,
            message: label,
            currentStep: segmentIndex ?? prep.currentStep,
            totalSteps: segmentTotal ?? prep.totalSteps,
            percent: prep.percent,
          });
        },
        onProgress: (event) => {
          statusText.value = event.message;
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.workbench-draft',
            stage: event.stage ?? 'running',
            message: event.message,
          });
        },
        onContent: (text) => {
          draftSink.append(text);
        },
        onContentReplace: (text) => {
          draftSink.replace(text);
        },
        onEnd: (event) => {
          draftSink.flush();
          rangeDraft.value = applyWorkbenchSseEndText(
            rangeDraft.value,
            resolveWorkbenchSseEndText(event)
          );
          if (!rangeDraft.value.trim()) {
            errorMessage.value = '未收到有效范围内成稿';
            failAiTaskProgress(aiTaskProgress, errorMessage.value);
            return;
          }
          if (isNearCopyWorkbenchDraft(committedOriginal.value, rangeDraft.value)) {
            statusText.value =
              '范围内成稿几乎是原文原样交回。请改一下优化要求后再生成，或把范围划小一点。';
          } else {
            statusText.value = '范围内成稿已生成，可检查或应用';
          }
          completeAiTaskProgress(aiTaskProgress, statusText.value);
        },
        onError: (messageText) => {
          errorMessage.value = messageText;
          failAiTaskProgress(aiTaskProgress, messageText);
        },
      },
      { signal }
    );
  } catch (error) {
    if (isSseAbortError(error)) {
      cancelAiTaskProgress(aiTaskProgress, '已中断按场成稿生成');
    } else {
      errorMessage.value = presentErrorFromCaught(error, '按场成稿生成失败');
      failAiTaskProgress(aiTaskProgress, errorMessage.value);
    }
  } finally {
    draftSink.flush();
    draftSink.dispose();
    generating.value = false;
    sseStream.abort();
    clearInterruptHandler();
  }
}

async function runReview() {
  const chapter = props.chapter;
  if (!chapter || !rangeDraft.value.trim()) {
    return;
  }

  const started = tryStartAiTaskProgress(aiTaskProgress, {
    taskKey: 'chapter.optimize.workbench-review',
    message: '正在检查范围内成稿…',
    source: 'dialog:scene-workbench',
    chapterNo: chapter.chapterNo,
    interruptible: false,
  });
  if (!started.ok) {
    errorMessage.value = '当前有其他 AI 任务进行中，请先等待或中断';
    return;
  }

  reviewing.value = true;
  errorMessage.value = '';
  statusText.value = '正在检查范围内成稿…';
  step.value = 'review';

  try {
    const result = await apiClient.reviewWorkbenchRange(props.projectId, chapter.chapterNo, {
      profile: reviewProfile.value,
      rangeText: rangeDraft.value,
      ...(instruction.value.trim() ? { instruction: instruction.value.trim() } : {}),
    });
    const filtered = filterWorkbenchReviewItemsForMode(
      normalizeWorkbenchReviewItems(result.items),
      creationMode.value
    );
    reviewItems.value = filtered.map((item) => ({ ...item, status: 'pending' as const }));
    reviewed.value = true;
    statusText.value =
      reviewItems.value.length === 0
        ? '检查通过，没有需要修复的条目'
        : `检查完成，共 ${reviewItems.value.length} 条`;
    completeAiTaskProgress(aiTaskProgress, statusText.value);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '按场成稿检查失败');
    failAiTaskProgress(aiTaskProgress, errorMessage.value);
  } finally {
    reviewing.value = false;
  }
}

async function rewriteSpan(input: {
  start: number;
  end: number;
  instructionText: string;
  itemId?: string;
}) {
  const chapter = props.chapter;
  if (!chapter) {
    return;
  }
  const spanText = rangeDraft.value.slice(input.start, input.end);
  if (!spanText) {
    errorMessage.value = '选区为空，请重新划选';
    return;
  }
  if (!input.instructionText.trim()) {
    errorMessage.value = '请填写改写指令';
    return;
  }

  const started = tryStartAiTaskProgress(aiTaskProgress, {
    taskKey: 'chapter.optimize.workbench-fix-span',
    message: '正在修复选区…',
    source: 'dialog:scene-workbench',
    chapterNo: chapter.chapterNo,
    interruptible: true,
  });
  if (!started.ok) {
    errorMessage.value = '当前有其他 AI 任务进行中，请先等待或中断';
    return;
  }

  fixing.value = true;
  errorMessage.value = '';
  statusText.value = '正在修复选区…';
  step.value = 'review';
  const neighborhood = sliceSpanNeighborhood(rangeDraft.value, input.start, input.end);
  const signal = sseStream.begin();
  bindInterruptHandler();
  let streamed = '';

  try {
    await apiClient.optimizeWorkbenchFixSpanSSE(
      props.projectId,
      chapter.chapterNo,
      {
        spanText,
        instruction: input.instructionText.trim(),
        profile: draftProfile.value,
        ...(neighborhood.beforeContext ? { beforeContext: neighborhood.beforeContext } : {}),
        ...(neighborhood.afterContext ? { afterContext: neighborhood.afterContext } : {}),
      },
      {
        onStart: () => {
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.workbench-fix-span',
            stage: 'running',
            message: '正在修复选区…',
          });
        },
        onStage: ({ stage, segmentIndex, segmentTotal }) => {
          const label = formatChapterOptimizeStageLabel(stage, segmentIndex, segmentTotal);
          statusText.value = label;
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.workbench-fix-span',
            stage,
            message: label,
          });
        },
        onContent: (text) => {
          streamed += text;
        },
        onContentReplace: (text) => {
          streamed = text;
        },
        onEnd: (event) => {
          streamed = applyWorkbenchSseEndText(streamed, resolveWorkbenchSseEndText(event));
        },
        onError: (messageText) => {
          errorMessage.value = messageText;
          failAiTaskProgress(aiTaskProgress, messageText);
        },
      },
      { signal }
    );

    if (errorMessage.value) {
      markItem(input.itemId, 'failed');
      return;
    }
    if (!streamed.trim()) {
      errorMessage.value = '未收到有效选区替换';
      failAiTaskProgress(aiTaskProgress, errorMessage.value);
      markItem(input.itemId, 'failed');
      return;
    }

    rangeDraft.value = spliceChapterRange(rangeDraft.value, input.start, input.end, streamed);
    markItem(input.itemId, 'applied');
    statusText.value = '选区已替换';
    completeAiTaskProgress(aiTaskProgress, statusText.value);
  } catch (error) {
    if (isSseAbortError(error)) {
      cancelAiTaskProgress(aiTaskProgress, '已中断按场成稿生成');
    } else {
      errorMessage.value = presentErrorFromCaught(error, '点句修复失败');
      failAiTaskProgress(aiTaskProgress, errorMessage.value);
      markItem(input.itemId, 'failed');
    }
  } finally {
    fixing.value = false;
    sseStream.abort();
    clearInterruptHandler();
  }
}

function markItem(itemId: string | undefined, status: ReviewRowStatus, skipReason?: string) {
  if (!itemId) {
    return;
  }
  reviewItems.value = reviewItems.value.map((item) =>
    item.id === itemId ? { ...item, status, skipReason } : item
  );
}

async function fixReviewItem(item: ReviewRow) {
  if (isBusy.value || item.status === 'applied') {
    return;
  }
  const located = locateUniqueAnchor(rangeDraft.value, item.anchorQuote);
  if (!located) {
    const skipReason = '锚点无法唯一定位（出现 0 次或超过 1 次），已跳过';
    markItem(item.id, 'skipped_unlocatable', skipReason);
    statusText.value = presentInfo(skipReason);
    return;
  }
  await rewriteSpan({
    start: located.start,
    end: located.end,
    instructionText: item.instruction,
    itemId: item.id,
  });
}

async function fixCurrentSelection() {
  const selection = currentDraftSelection();
  if (!selection) {
    errorMessage.value = '请在范围成稿中划选要改的句子';
    return;
  }
  await rewriteSpan({
    start: selection.start,
    end: selection.end,
    instructionText: spanInstruction.value,
  });
}

async function applyDraft() {
  const chapter = props.chapter;
  if (!chapter || !rangeDraft.value.trim()) {
    return;
  }
  const confirmed = await confirmAction({
    title: '应用按场成稿',
    content: `将覆盖第 ${chapter.chapterNo} 章正文，并保留现有摘要。范围外原文保持不变。是否继续？`,
    okText: '确认应用',
  });
  if (!confirmed) {
    return;
  }

  applying.value = true;
  errorMessage.value = '';
  step.value = 'apply';
  try {
    const result = await apiClient.applyChapterOptimization(props.projectId, chapter.chapterNo, {
      draftText: previewText.value,
      expectedChapterUpdatedAt: baseUpdatedAt.value,
      preserveSummary: true,
    });
    presentSuccess('按场成稿已应用');
    emit('applied', result.chapter);
    emit('close');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '应用按场成稿失败');
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <a-modal
    :open="props.visible"
    width="100%"
    wrap-class-name="scene-workbench-fullscreen"
    transition-name=""
    :style="{ top: 0, paddingBottom: 0, maxWidth: '100vw', margin: 0 }"
    :title="`按场成稿${props.chapter ? ` · 第${props.chapter.chapterNo}章` : ''}`"
    :footer="null"
    destroy-on-close
    :mask-closable="!isBusy"
    :closable="!applying"
    @cancel="close"
  >
    <div class="wb-shell">
      <header class="wb-chrome">
        <p class="modal-subtitle">
          打开时冻结本章正文。划一场连续范围一次生成；范围外原文字节级保留。确认应用后才会覆盖章节。「按场创编」会先出可编辑方案，确认后才成稿。
        </p>
        <ol class="stepper">
          <li
            v-for="(entry, index) in stepperSteps"
            :key="entry.key"
            :class="[stepperClass(entry.key), { active: step === entry.key }]"
          >
            {{ index + 1 }}. {{ entry.label }}
          </li>
        </ol>
        <AiTaskProgressPanel
          :progress="aiTaskProgress"
          show-trace-on-error
          @interrupt="interruptGeneration"
        />
        <div v-if="generating || fixing" class="stream-actions">
          <SseInterruptButton @interrupt="interruptGeneration" />
        </div>
        <p v-if="statusText && !aiTaskProgress.active" class="message message-info">
          {{ statusText }}
        </p>
        <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
      </header>

      <div class="wb-body">
        <section class="step-section">
          <div class="profile-row" role="radiogroup" aria-label="成稿档位">
            <label class="profile-option">
              <input v-model="creationMode" type="radio" value="sex" :disabled="isBusy" />
              感官加料
            </label>
            <label class="profile-option">
              <input v-model="creationMode" type="radio" value="prose" :disabled="isBusy" />
              日常文笔
            </label>
            <label class="profile-option">
              <input v-model="creationMode" type="radio" value="scene" :disabled="isBusy" />
              按场创编
            </label>
            <span class="field-hint">当前范围：{{ rangeMeta }}</span>
          </div>
          <p v-if="rangeOverflowHint" class="message message-error">{{ rangeOverflowHint }}</p>
          <label class="field-label" for="scene-workbench-instruction">优化要求</label>
          <textarea
            id="scene-workbench-instruction"
            v-model="instruction"
            class="instruction-input"
            rows="3"
            :disabled="isBusy"
            :placeholder="instructionPlaceholder"
          />
        </section>

        <section class="wb-split">
          <div class="pane">
            <label class="field-label" for="scene-workbench-frozen">冻结正文（划选范围）</label>
            <p class="field-hint">
              划选连续范围后松开即记下起止。重新划选不会清掉已生成的成稿；应用仍按生成时的范围拼回。生成时范围前后各带约
              2000 字只读原文，只为衔接。范围太长时同一场会按窗续写后半，不按高潮拆场。
            </p>
            <textarea
              id="scene-workbench-frozen"
              ref="frozenTextareaRef"
              class="chapter-input"
              readonly
              :value="baseText"
              :disabled="isBusy"
              @mouseup="captureFrozenRange"
              @keyup="captureFrozenRange"
              @select="captureFrozenRange"
            />
          </div>
          <div class="pane">
            <label class="field-label" for="scene-workbench-draft">范围成稿</label>
            <p class="field-hint">生成后可再划选句子，用短指令只改选区。</p>
            <textarea
              id="scene-workbench-draft"
              ref="rangeDraftTextareaRef"
              v-model="rangeDraft"
              class="chapter-input"
              :disabled="isBusy || !rangeDraft"
              placeholder="生成后显示范围内成稿"
            />
            <div class="span-fix">
              <input
                v-model="spanInstruction"
                class="span-input"
                type="text"
                :disabled="isBusy || !rangeDraft"
                placeholder="例如：把拍打改成拍桌沿，只改这一句。"
              />
              <button
                class="secondary-button"
                type="button"
                :disabled="!canFixSelection"
                @click="fixCurrentSelection"
              >
                只改选区
              </button>
            </div>
          </div>
        </section>

        <section v-if="isSceneMode" class="step-section">
          <p class="field-label" for="scene-workbench-plan">创编方案（可编辑）</p>
          <p class="field-hint">
            方案只覆盖划选范围：可在场内删拍、加戏、重排、扩写；范围边界与散场状态锁死。生成、编辑后点「确认方案」，未确认不会成稿。
          </p>
          <textarea
            id="scene-workbench-plan"
            v-model="planText"
            class="chapter-input plan-input"
            :disabled="isBusy"
            placeholder="生成后显示可编辑的创编方案，也可自行填写"
          />
          <div class="plan-actions">
            <button
              class="secondary-button"
              type="button"
              :disabled="!canPlan"
              @click="generateScenePlan"
            >
              {{ planning ? '生成中…' : planText.trim() ? '重新生成方案' : '生成创编方案' }}
            </button>
            <button
              class="secondary-button"
              type="button"
              :disabled="!canConfirmPlan"
              @click="confirmPlan"
            >
              确认方案
            </button>
            <span v-if="planConfirmed" class="field-hint">方案已确认</span>
          </div>
        </section>

        <section v-if="reviewed" class="step-section">
          <p class="field-label">检查条目</p>
          <p v-if="reviewItems.length === 0" class="field-hint">没有需要修复的条目。</p>
          <ul v-else class="review-list">
            <li v-for="item in reviewItems" :key="item.id" class="review-item">
              <div class="review-head">
                <span class="kind-chip">{{ KIND_LABEL[item.kind] ?? item.kind }}</span>
                <span class="review-status">{{
                  item.status === 'applied'
                    ? '已修复'
                    : item.status === 'skipped_unlocatable'
                      ? '无法定位'
                      : item.status === 'failed'
                        ? '失败'
                        : '待处理'
                }}</span>
              </div>
              <p class="review-issue">{{ item.issue }}</p>
              <p class="review-quote">「{{ item.anchorQuote }}」</p>
              <p class="field-hint">{{ item.instruction }}</p>
              <p v-if="item.skipReason" class="message message-info">{{ item.skipReason }}</p>
              <button
                class="secondary-button"
                type="button"
                :disabled="
                  isBusy || item.status === 'applied' || item.status === 'skipped_unlocatable'
                "
                @click="fixReviewItem(item)"
              >
                修复
              </button>
            </li>
          </ul>
        </section>

        <section v-if="showRangeCompare" class="step-section">
          <p class="field-label">范围对照</p>
          <p class="field-hint">
            左侧是生成时划选的原文，右侧绿底是成稿新增。改字请在上方「范围成稿」里改。
          </p>
          <div class="wb-compare">
            <ChapterOptimizeComparePane
              v-model="rangeDraft"
              :original="committedOriginal"
              original-title="划选原文"
              draft-title="范围成稿"
              :show-diff="shouldRenderOptimizeDiff(generating)"
              :show-editors="false"
              :draft-disabled="isBusy"
            />
          </div>
        </section>

        <section v-if="rangeDraft.trim()" class="step-section">
          <p class="field-label">整章预览（范围外为冻结原文）</p>
          <pre class="preview-text">{{ previewText }}</pre>
        </section>
      </div>

      <footer class="wb-footer">
        <button class="secondary-button" type="button" :disabled="applying" @click="close">
          取消
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="!canGenerate"
          @click="generateRangeDraft"
        >
          {{ generating ? '生成中…' : '生成范围成稿' }}
        </button>
        <button class="secondary-button" type="button" :disabled="!canReview" @click="runReview">
          {{ reviewing ? '检查中…' : '检查' }}
        </button>
        <button
          :class="canApply ? 'primary-button' : 'secondary-button'"
          type="button"
          :disabled="!canApply"
          @click="applyDraft"
        >
          {{ applying ? '应用中…' : '应用整章' }}
        </button>
      </footer>
    </div>
  </a-modal>
</template>

<style scoped>
.wb-shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.wb-chrome {
  flex: 0 0 auto;
}
.wb-body {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  gap: 12px;
}
.wb-footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 8px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}
.modal-subtitle {
  margin: 0 0 8px;
  color: #4b5563;
  font-size: 0.9rem;
}
.stepper {
  display: flex;
  gap: 6px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}
.stepper li {
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  background: #f3f4f6;
  color: #6b7280;
  text-align: center;
  font-size: 13px;
}
.stepper li.active {
  background: #dbeafe;
  color: #1d4ed8;
  font-weight: 600;
}
.stepper li.step--running {
  background: #eff6ff;
  color: #1d4ed8;
  box-shadow: inset 0 0 0 1px #93c5fd;
}
.stepper li.step--awaiting,
.stepper li.step--done {
  background: #ecfdf5;
  color: #047857;
}
.step-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wb-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.pane {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}
.profile-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.profile-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #111827;
  font-weight: 600;
}
.field-label {
  margin: 0;
  color: #111827;
  font-weight: 600;
}
.field-hint {
  margin: 0;
  color: #6b7280;
  font-size: 0.82rem;
}
.instruction-input,
.chapter-input,
.span-input {
  width: 100%;
  padding: 0.7rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font: inherit;
  line-height: 1.65;
}
.chapter-input {
  min-height: 280px;
  resize: vertical;
}
.span-fix {
  display: flex;
  gap: 8px;
}
.span-input {
  flex: 1;
}
.plan-input {
  min-height: 180px;
}
.plan-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.review-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.review-item {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
}
.review-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.kind-chip,
.review-status {
  font-size: 0.78rem;
  font-weight: 600;
}
.kind-chip {
  color: #1d4ed8;
}
.review-issue,
.review-quote {
  margin: 0;
}
.review-quote {
  color: #4b5563;
}
.wb-compare {
  max-height: 56vh;
  overflow: auto;
  padding: 4px 0;
}
.preview-text {
  max-height: 240px;
  margin: 0;
  padding: 0.9rem;
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}
.stream-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}
.primary-button,
.secondary-button {
  padding: 0.48rem 0.9rem;
  border-radius: 6px;
  cursor: pointer;
}
.primary-button {
  border: none;
  background: #2563eb;
  color: #fff;
}
.primary-button:hover:not(:disabled) {
  background: #1d4ed8;
}
.secondary-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
}
.secondary-button:hover:not(:disabled) {
  border-color: #93c5fd;
  color: #1d4ed8;
}
.primary-button:disabled,
.secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.message {
  margin: 0 0 8px;
  font-size: 0.86rem;
}
.message-info {
  color: #2563eb;
}
.message-error {
  color: #dc2626;
}
@media (max-width: 960px) {
  .wb-split {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
.scene-workbench-fullscreen.ant-modal-wrap {
  overflow: hidden;
}
.scene-workbench-fullscreen.ant-modal-wrap .ant-modal {
  max-width: 100%;
  top: 0;
  padding-bottom: 0;
  margin: 0;
}
.scene-workbench-fullscreen.ant-modal-wrap .ant-modal-content {
  display: flex;
  flex-direction: column;
  height: 100vh;
  border-radius: 0;
  box-shadow: none;
}
.scene-workbench-fullscreen.ant-modal-wrap .ant-modal-header {
  flex: 0 0 auto;
  padding: 12px 16px;
  margin-bottom: 0;
  border-bottom: 1px solid #e5e7eb;
}
.scene-workbench-fullscreen.ant-modal-wrap .ant-modal-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 16px 0;
  display: flex;
  flex-direction: column;
}
</style>
