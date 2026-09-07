<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import {
  apiClient,
  formatChapterOptimizeStageLabel,
  type ChapterItem,
  type ChapterOptimizationPlanResult,
} from '../../services/api';
import { useAbortableSse } from '../../composables/useAbortableSse';
import { confirmAction } from '../../composables/useAppConfirm';
import {
  applyAiTaskProgressEvent,
  cancelAiTaskProgress,
  completeAiTaskProgress,
  failAiTaskProgress,
  tryStartAiTaskProgress,
} from '../../composables/useAiTaskProgress';
import {
  useChapterAiActivityInterrupt,
  useChapterPageAiActivity,
} from '../../composables/chapterAiActivityContext';
import { isSseAbortError } from '../../utils/sseStream';
import { presentErrorFromCaught, presentInfo, presentSuccess } from '../../utils/pageFeedback';
import {
  resolveWritingOptimizeStepperSteps,
  resolveWritingOptimizeStepVisual,
  type WritingOptimizeRewriteMode,
  type WritingOptimizeStep,
} from '../../utils/writingOptimizeStepVisual';
import { resolveChapterOptimizePrepProgress } from '../../utils/chapterOptimizePrepProgress';
import {
  WRITING_OPTIMIZE_PASS_MAX,
  WRITING_OPTIMIZE_PASS_MIN,
  WRITING_OPTIMIZE_PLAN_REFINE_FEEDBACK,
  formatWritingOptimizePassLabel,
  resolveDraftSourceText,
} from '../../utils/writingOptimizeMultiPass';
import { useWritingOptimizeRunPrefs } from '../../composables/useWritingOptimizeRunPrefs';
import { useChapterAutoLoop } from '../../composables/useChapterAutoLoop';
import { useChapterAutoLoopPrefs } from '../../composables/useChapterAutoLoopPrefs';
import {
  AUTO_LOOP_ROUND_BUDGET_MAX,
  AUTO_LOOP_ROUND_BUDGET_MIN,
} from '../../utils/chapterAutoLoopPrefs';
import AiTaskProgressPanel from '../common/AiTaskProgressPanel.vue';
import AutoLoopRoundsPanel from './AutoLoopRoundsPanel.vue';
import SseInterruptButton from '../common/SseInterruptButton.vue';

type OptimizeStep = WritingOptimizeStep;

const props = defineProps<{
  visible: boolean;
  projectId: string;
  chapter: ChapterItem | null;
}>();

const emit = defineEmits<{
  close: [];
  applied: [chapter: ChapterItem];
}>();

const step = shallowRef<OptimizeStep>('instruction');
const rewriteMode = shallowRef<WritingOptimizeRewriteMode>('from-plan');
const instruction = shallowRef('');
const plan = shallowRef<ChapterOptimizationPlanResult | null>(null);
const editablePlanText = shallowRef('');
const planRevisionFeedback = shallowRef('');
const planRevisionRound = shallowRef(0);
const streamedPlanText = shallowRef('');
const draftText = shallowRef('');
const originalText = shallowRef('');
const expectedChapterUpdatedAt = shallowRef('');
const statusText = shallowRef('');
const errorMessage = shallowRef('');
const generatingPlan = shallowRef(false);
const generatingDraft = shallowRef(false);
const applying = shallowRef(false);
const planStream = useAbortableSse();
const draftStream = useAbortableSse();
const aiTaskProgress = useChapterPageAiActivity();
const activityInterruptHandler = useChapterAiActivityInterrupt();
const { autoStartDraft, planPassCount, draftPassCount } = useWritingOptimizeRunPrefs();
const { roundBudget } = useChapterAutoLoopPrefs();
const passLoopAborted = shallowRef(false);
const passCountOptions = [WRITING_OPTIMIZE_PASS_MIN, 2, WRITING_OPTIMIZE_PASS_MAX];
const roundBudgetOptions = [AUTO_LOOP_ROUND_BUDGET_MIN, 2, AUTO_LOOP_ROUND_BUDGET_MAX];

const {
  running: autoLoopRunning,
  rounds: autoLoopRounds,
  liveItems: autoLoopItems,
  activeRoundIndex: autoLoopRoundIndex,
  activeRoundBudget: autoLoopActiveBudget,
  paragraphCount: autoLoopParagraphCount,
  stoppedReasonText: autoLoopStoppedText,
  baseUpdatedAt: autoLoopBaseUpdatedAt,
  statusText: autoLoopStatusText,
  errorMessage: autoLoopError,
  restoredFromSession: autoLoopRestored,
  start: runAutoLoop,
  stopAndAccept: autoLoopStopAndAccept,
  restoreSession: autoLoopRestoreSession,
  reset: autoLoopReset,
} = useChapterAutoLoop({
  projectId: () => props.projectId,
  chapter: () => props.chapter,
  aiTaskProgress,
  // 每轮成稿即时回填到可编辑草稿，用户随时停下就能直接应用
  onDraftAvailable: (draft) => {
    draftText.value = draft;
  },
});

const isBusy = computed(
  () => generatingPlan.value || generatingDraft.value || applying.value || autoLoopRunning.value
);
const canGeneratePlan = computed(() => Boolean(instruction.value.trim()) && !isBusy.value);
const canRevisePlan = computed(
  () =>
    Boolean(editablePlanText.value.trim()) &&
    Boolean(planRevisionFeedback.value.trim()) &&
    !isBusy.value
);
const canGenerateDraft = computed(() => {
  if (isBusy.value) {
    return false;
  }
  if (rewriteMode.value === 'direct') {
    return Boolean(instruction.value.trim());
  }
  return Boolean(editablePlanText.value.trim());
});
const canApply = computed(() => Boolean(draftText.value.trim()) && !isBusy.value);

const isDirectMode = computed(() => rewriteMode.value === 'direct');
const isAutoLoopMode = computed(() => rewriteMode.value === 'auto-loop');
const stepperSteps = computed(() => resolveWritingOptimizeStepperSteps(rewriteMode.value));
const stepperLabels: Record<WritingOptimizeStep, string> = {
  instruction: '优化要求',
  plan: '优化方案',
  draft: '正文对比',
  loop: '自动循环',
};

const stepVisualInput = computed(() => ({
  currentStep: step.value,
  generatingPlan: generatingPlan.value,
  // 循环跑在后端一条流上，对步骤条而言与"正在改写正文"同义
  generatingDraft: generatingDraft.value || autoLoopRunning.value,
  hasPlan: Boolean(editablePlanText.value.trim() || plan.value),
  hasDraft: Boolean(draftText.value.trim()),
  hasError: Boolean(errorMessage.value || autoLoopError.value),
  rewriteMode: rewriteMode.value,
}));

const canStartAutoLoop = computed(() => Boolean(instruction.value.trim()) && !isBusy.value);

const modeSubtitle = computed(() => {
  if (isAutoLoopMode.value) {
    return '按同一要求反复「复诊 → 只改命中段落」，未命中段落逐字节保留；随时可以停下并收下当前成稿。';
  }
  if (isDirectMode.value) {
    return '根据自由要求直接改写整章正文；只有确认应用后才会覆盖原文。';
  }
  return '根据自由要求先生成编辑方案，再改写整章正文。可连跑方案/正文多轮；只有确认应用后才会覆盖原文。';
});

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

function setRewriteMode(mode: WritingOptimizeRewriteMode) {
  if (isBusy.value || rewriteMode.value === mode) {
    return;
  }
  rewriteMode.value = mode;
  step.value = 'instruction';
  plan.value = null;
  editablePlanText.value = '';
  planRevisionFeedback.value = '';
  planRevisionRound.value = 0;
  streamedPlanText.value = '';
  draftText.value = '';
  errorMessage.value = '';
  statusText.value = '';
  autoLoopReset();
  if (mode === 'auto-loop') {
    void resumeAutoLoopSession();
  }
}

/** 循环单章要跑几分钟，误关弹窗不该等于白跑一遍。 */
async function resumeAutoLoopSession() {
  const view = await autoLoopRestoreSession();
  if (!view || rewriteMode.value !== 'auto-loop') {
    return;
  }
  if (view.instruction.trim()) {
    instruction.value = view.instruction;
  }
  if (view.roundBudget > 0) {
    roundBudget.value = view.roundBudget;
  }
  if (view.storedContent.trim()) {
    originalText.value = view.storedContent;
  }
  if (view.baseUpdatedAt) {
    expectedChapterUpdatedAt.value = view.baseUpdatedAt;
  }
  step.value = 'loop';
}

function stepVisualFor(stepKey: WritingOptimizeStep) {
  return resolveWritingOptimizeStepVisual({ ...stepVisualInput.value, stepKey });
}

function resetState() {
  step.value = 'instruction';
  rewriteMode.value = 'from-plan';
  instruction.value = '';
  plan.value = null;
  editablePlanText.value = '';
  planRevisionFeedback.value = '';
  planRevisionRound.value = 0;
  streamedPlanText.value = '';
  draftText.value = '';
  originalText.value = props.chapter?.content ?? '';
  expectedChapterUpdatedAt.value = props.chapter?.updatedAt ?? '';
  statusText.value = '';
  errorMessage.value = '';
  generatingPlan.value = false;
  generatingDraft.value = false;
  applying.value = false;
  planStream.abort();
  draftStream.abort();
  autoLoopReset();
  clearInterruptHandler();
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      resetState();
    }
  },
  { immediate: true }
);

// 循环的乐观锁基线由后端在开跑时快照，可能早于弹窗打开时的快照（会话恢复场景）
watch(
  () => autoLoopBaseUpdatedAt.value,
  (baseUpdatedAt) => {
    if (baseUpdatedAt) {
      expectedChapterUpdatedAt.value = baseUpdatedAt;
    }
  }
);

function close() {
  if (generatingPlan.value) {
    planStream.abort();
  }
  if (generatingDraft.value) {
    draftStream.abort();
  }
  if (autoLoopRunning.value) {
    // 后端会话保留各轮成稿，关掉弹窗不会丢；恢复入口在切回 auto-loop 模式时
    autoLoopStopAndAccept();
  }
  if (!applying.value) {
    emit('close');
  }
}

function interruptGeneration() {
  if (autoLoopRunning.value) {
    autoLoopStopAndAccept();
    statusText.value = presentInfo(autoLoopStatusText.value);
    clearInterruptHandler();
    return;
  }
  passLoopAborted.value = true;
  planStream.abort();
  draftStream.abort();
  generatingPlan.value = false;
  generatingDraft.value = false;
  cancelAiTaskProgress(aiTaskProgress, '已中断文笔优化生成');
  statusText.value = presentInfo('已中断文笔优化生成');
  clearInterruptHandler();
}

async function startAutoLoop() {
  if (!props.chapter || !canStartAutoLoop.value) {
    return;
  }
  errorMessage.value = '';
  statusText.value = '';
  draftText.value = '';
  originalText.value = props.chapter.content ?? '';
  expectedChapterUpdatedAt.value = props.chapter.updatedAt ?? '';
  step.value = 'loop';
  bindInterruptHandler();
  try {
    const outcome = await runAutoLoop({
      instruction: instruction.value.trim(),
      roundBudget: roundBudget.value,
    });
    if (outcome === 'busy') {
      step.value = 'instruction';
    }
  } finally {
    clearInterruptHandler();
  }
}

function stopAutoLoopAndAccept() {
  autoLoopStopAndAccept();
  clearInterruptHandler();
}

type PassOutcome = 'ok' | 'error' | 'aborted';

async function runSinglePlanPass(input: {
  chapter: ChapterItem;
  revision: boolean;
  revisionFeedback: string;
  passIndex: number;
  passTotal: number;
  completeOnEnd: boolean;
}): Promise<PassOutcome> {
  const normalizedInstruction = instruction.value.trim();
  const currentPlanText = editablePlanText.value.trim();
  if (input.revision && !currentPlanText) {
    errorMessage.value = '请保留当前方案后再继续';
    return 'error';
  }

  const passLabel = formatWritingOptimizePassLabel('plan', input.passIndex, input.passTotal);
  statusText.value = passLabel;
  streamedPlanText.value = '';
  if (!input.revision) {
    plan.value = null;
    editablePlanText.value = '';
    planRevisionRound.value = 0;
  }

  const signal = planStream.begin();
  bindInterruptHandler();
  let outcome: PassOutcome = 'error';

  try {
    await apiClient.optimizeChapterPlanSSE(
      props.projectId,
      input.chapter.chapterNo,
      {
        instruction: normalizedInstruction,
        ...(input.revision ? { currentPlanText, revisionFeedback: input.revisionFeedback } : {}),
      },
      {
        onStart: (event) => {
          if (event.strategyLabel) {
            statusText.value = `${passLabel} · ${event.strategyLabel}`;
            applyAiTaskProgressEvent(aiTaskProgress, {
              taskKey: 'chapter.optimize.plan',
              stage: 'running',
              message: statusText.value,
            });
          }
        },
        onStage: ({ stage, segmentIndex, segmentTotal, retryCount }) => {
          const label = `${passLabel} · ${formatChapterOptimizeStageLabel(
            stage,
            segmentIndex,
            segmentTotal,
            retryCount
          )}`;
          statusText.value = label;
          const prep = resolveChapterOptimizePrepProgress(stage);
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.plan',
            stage,
            message: label,
            currentStep: segmentIndex ?? prep.currentStep,
            totalSteps: segmentTotal ?? prep.totalSteps,
            percent: prep.percent,
          });
        },
        onContent: (text) => {
          streamedPlanText.value += text;
        },
        onEnd: (result) => {
          plan.value = result;
          editablePlanText.value = result.planText;
          if (input.revision) {
            planRevisionRound.value += 1;
            if (input.revisionFeedback === planRevisionFeedback.value.trim()) {
              planRevisionFeedback.value = '';
            }
          }
          step.value = 'plan';
          statusText.value =
            input.passTotal > 1
              ? `${passLabel}已完成`
              : input.revision
                ? `方案第 ${planRevisionRound.value} 轮调整已完成`
                : '优化方案已生成，可直接编辑或继续让 AI 调整';
          outcome = 'ok';
          if (input.completeOnEnd) {
            completeAiTaskProgress(aiTaskProgress, statusText.value);
          }
        },
        onError: (messageText) => {
          errorMessage.value = messageText;
          outcome = 'error';
          failAiTaskProgress(aiTaskProgress, messageText);
        },
      },
      { signal }
    );
  } catch (error) {
    if (isSseAbortError(error) || passLoopAborted.value) {
      outcome = 'aborted';
      cancelAiTaskProgress(aiTaskProgress, '已中断文笔优化生成');
    } else {
      errorMessage.value = presentErrorFromCaught(error, '生成文笔优化方案失败');
      outcome = 'error';
      failAiTaskProgress(aiTaskProgress, errorMessage.value);
    }
  } finally {
    planStream.abort();
    streamedPlanText.value = '';
    clearInterruptHandler();
  }

  return outcome;
}

async function runPlanGeneration(revision: boolean) {
  const chapter = props.chapter;
  const normalizedInstruction = instruction.value.trim();
  if (!chapter || !normalizedInstruction) {
    errorMessage.value = '请填写文笔优化要求';
    return;
  }
  const revisionFeedback = planRevisionFeedback.value.trim();
  if (revision && (!editablePlanText.value.trim() || !revisionFeedback)) {
    errorMessage.value = '请保留当前方案并填写本轮修改意见';
    return;
  }

  const message = revision ? '正在按意见调整当前方案…' : '正在分析原文并生成优化方案…';
  const started = tryStartAiTaskProgress(aiTaskProgress, {
    taskKey: 'chapter.optimize.plan',
    message,
    source: 'dialog:writing-optimize',
    chapterNo: chapter.chapterNo,
    interruptible: true,
    force: false,
  });
  if (!started.ok) {
    errorMessage.value = '当前有其他 AI 任务进行中，请先等待或中断';
    return;
  }

  passLoopAborted.value = false;
  generatingPlan.value = true;
  errorMessage.value = '';
  try {
    await runSinglePlanPass({
      chapter,
      revision,
      revisionFeedback,
      passIndex: 1,
      passTotal: 1,
      completeOnEnd: true,
    });
  } finally {
    generatingPlan.value = false;
  }
}

async function generatePlan() {
  const chapter = props.chapter;
  const normalizedInstruction = instruction.value.trim();
  if (!chapter || !normalizedInstruction) {
    errorMessage.value = '请填写文笔优化要求';
    return;
  }

  const total = rewriteMode.value === 'direct' ? 1 : planPassCount.value;
  const started = tryStartAiTaskProgress(aiTaskProgress, {
    taskKey: 'chapter.optimize.plan',
    message: formatWritingOptimizePassLabel('plan', 1, total),
    source: 'dialog:writing-optimize',
    chapterNo: chapter.chapterNo,
    interruptible: true,
    force: false,
  });
  if (!started.ok) {
    errorMessage.value = '当前有其他 AI 任务进行中，请先等待或中断';
    return;
  }

  passLoopAborted.value = false;
  generatingPlan.value = true;
  errorMessage.value = '';
  let allOk = true;
  try {
    for (let passIndex = 1; passIndex <= total; passIndex += 1) {
      if (passLoopAborted.value) {
        allOk = false;
        break;
      }
      const outcome = await runSinglePlanPass({
        chapter,
        revision: passIndex > 1,
        revisionFeedback: WRITING_OPTIMIZE_PLAN_REFINE_FEEDBACK,
        passIndex,
        passTotal: total,
        completeOnEnd: passIndex === total,
      });
      if (outcome !== 'ok') {
        allOk = false;
        break;
      }
    }
    if (
      allOk &&
      autoStartDraft.value &&
      rewriteMode.value === 'from-plan' &&
      !passLoopAborted.value
    ) {
      generatingPlan.value = false;
      await generateDraft();
    }
  } finally {
    generatingPlan.value = false;
  }
}

async function revisePlan() {
  await runPlanGeneration(true);
}

async function runSingleDraftPass(input: {
  chapter: ChapterItem;
  isDirect: boolean;
  passIndex: number;
  passTotal: number;
  sourceText?: string;
  completeOnEnd: boolean;
}): Promise<PassOutcome> {
  const currentPlan = plan.value;
  const taskKey = input.isDirect ? 'chapter.optimize.direct-draft' : 'chapter.optimize.draft';
  const passLabel = input.isDirect
    ? '正在按要求改写正文…'
    : formatWritingOptimizePassLabel('draft', input.passIndex, input.passTotal);
  statusText.value = passLabel;
  draftText.value = '';
  step.value = 'draft';

  const signal = draftStream.begin();
  bindInterruptHandler();
  let outcome: PassOutcome = 'error';

  try {
    await apiClient.optimizeChapterDraftSSE(
      props.projectId,
      input.chapter.chapterNo,
      input.isDirect
        ? {
            instruction: instruction.value.trim(),
            rewriteMode: 'direct',
          }
        : {
            instruction: instruction.value.trim(),
            planText: editablePlanText.value.trim(),
            planId: currentPlan?.planId,
            segmentDiagnoses: currentPlan?.segmentDiagnoses,
            rewriteMode: 'from-plan',
            ...(input.sourceText ? { sourceText: input.sourceText } : {}),
          },
      {
        onStart: (event) => {
          statusText.value = event.strategyLabel
            ? `${passLabel} · ${event.strategyLabel}`
            : passLabel;
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey,
            stage: 'running',
            message: statusText.value,
          });
        },
        onStage: ({ stage, segmentIndex, segmentTotal }) => {
          const label = `${passLabel} · ${formatChapterOptimizeStageLabel(stage, segmentIndex, segmentTotal)}`;
          statusText.value = label;
          const prep = resolveChapterOptimizePrepProgress(stage);
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey,
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
            taskKey,
            stage: event.stage ?? 'running',
            message: event.message,
          });
        },
        onContent: (text) => {
          draftText.value += text;
        },
        onContentReplace: (text) => {
          draftText.value = text;
        },
        onEnd: (event) => {
          if (event.finalDraftText?.trim()) {
            draftText.value = event.finalDraftText;
          }
          outcome = draftText.value.trim() ? 'ok' : 'error';
          statusText.value =
            input.passTotal > 1 ? `${passLabel}已完成` : '优化正文已生成，请对比确认';
          if (outcome === 'error') {
            errorMessage.value = '未收到有效响应';
            failAiTaskProgress(aiTaskProgress, errorMessage.value);
          } else if (input.completeOnEnd) {
            completeAiTaskProgress(aiTaskProgress, '优化正文已生成，请对比确认');
          }
        },
        onError: (messageText) => {
          errorMessage.value = messageText;
          outcome = 'error';
          failAiTaskProgress(aiTaskProgress, messageText);
        },
      },
      { signal }
    );
  } catch (error) {
    if (isSseAbortError(error) || passLoopAborted.value) {
      outcome = 'aborted';
      cancelAiTaskProgress(aiTaskProgress, '已中断文笔优化生成');
    } else {
      errorMessage.value = presentErrorFromCaught(error, '生成文笔优化正文失败');
      outcome = 'error';
      failAiTaskProgress(aiTaskProgress, errorMessage.value);
    }
  } finally {
    draftStream.abort();
    clearInterruptHandler();
  }

  return outcome;
}

async function generateDraft() {
  const chapter = props.chapter;
  const currentPlan = plan.value;
  const isDirect = rewriteMode.value === 'direct';
  if (!chapter) {
    return;
  }
  if (isDirect && !instruction.value.trim()) {
    errorMessage.value = '请填写文笔优化要求';
    return;
  }
  if (!isDirect && !currentPlan) {
    return;
  }

  const total = isDirect ? 1 : draftPassCount.value;
  const progressMessage = isDirect
    ? '正在按要求改写正文…'
    : formatWritingOptimizePassLabel('draft', 1, total);
  const started = tryStartAiTaskProgress(aiTaskProgress, {
    taskKey: isDirect ? 'chapter.optimize.direct-draft' : 'chapter.optimize.draft',
    message: progressMessage,
    source: 'dialog:writing-optimize',
    chapterNo: chapter.chapterNo,
    interruptible: true,
    force: false,
  });
  if (!started.ok) {
    errorMessage.value = '当前有其他 AI 任务进行中，请先等待或中断';
    return;
  }

  passLoopAborted.value = false;
  generatingDraft.value = true;
  errorMessage.value = '';
  let lastSuccessful = draftText.value.trim();
  try {
    for (let passIndex = 1; passIndex <= total; passIndex += 1) {
      if (passLoopAborted.value) {
        draftText.value = lastSuccessful;
        break;
      }
      const outcome = await runSingleDraftPass({
        chapter,
        isDirect,
        passIndex,
        passTotal: total,
        sourceText: isDirect ? undefined : resolveDraftSourceText(passIndex, lastSuccessful),
        completeOnEnd: passIndex === total,
      });
      if (outcome === 'ok') {
        lastSuccessful = draftText.value.trim();
        continue;
      }
      draftText.value = lastSuccessful;
      break;
    }
  } finally {
    generatingDraft.value = false;
  }
}

async function applyDraft() {
  const chapter = props.chapter;
  if (!chapter || !draftText.value.trim()) {
    return;
  }
  const confirmed = await confirmAction({
    title: '应用文笔优化正文',
    content: `将覆盖第 ${chapter.chapterNo} 章正文，并保留现有摘要。是否继续？`,
    okText: '确认应用',
  });
  if (!confirmed) {
    return;
  }

  applying.value = true;
  errorMessage.value = '';
  try {
    const result = await apiClient.applyChapterOptimization(props.projectId, chapter.chapterNo, {
      draftText: draftText.value,
      expectedChapterUpdatedAt: expectedChapterUpdatedAt.value,
      planId: plan.value?.planId,
      preserveSummary: true,
    });
    presentSuccess('文笔优化正文已应用');
    emit('applied', result.chapter);
    emit('close');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '应用文笔优化正文失败');
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <a-modal
    :open="props.visible"
    :width="1080"
    :title="`文笔优化${props.chapter ? ` · 第${props.chapter.chapterNo}章` : ''}`"
    :footer="null"
    destroy-on-close
    :mask-closable="!isBusy"
    :closable="!applying"
    @cancel="close"
  >
    <p class="modal-subtitle">{{ modeSubtitle }}</p>

    <div class="mode-toggle" role="radiogroup" aria-label="文笔优化模式">
      <button
        type="button"
        class="mode-toggle-button"
        :class="{ active: rewriteMode === 'from-plan' }"
        :disabled="isBusy"
        @click="setRewriteMode('from-plan')"
      >
        方案改写
      </button>
      <button
        type="button"
        class="mode-toggle-button"
        :class="{ active: rewriteMode === 'direct' }"
        :disabled="isBusy"
        @click="setRewriteMode('direct')"
      >
        直接改写
      </button>
      <button
        type="button"
        class="mode-toggle-button"
        :class="{ active: rewriteMode === 'auto-loop' }"
        :disabled="isBusy"
        @click="setRewriteMode('auto-loop')"
      >
        自动循环
      </button>
    </div>

    <div v-if="isAutoLoopMode" class="run-prefs">
      <label class="run-pref">
        循环轮数上限
        <select v-model.number="roundBudget" :disabled="isBusy">
          <option v-for="count in roundBudgetOptions" :key="`round-${count}`" :value="count">
            {{ count }}
          </option>
        </select>
      </label>
      <span class="field-hint">每轮＝复诊上一稿 + 只改命中段落；无严重问题会提前收敛。</span>
    </div>

    <div v-else-if="!isDirectMode" class="run-prefs">
      <label class="run-pref run-pref--check">
        <input v-model="autoStartDraft" type="checkbox" :disabled="isBusy" />
        方案完成后自动生成正文
      </label>
      <label class="run-pref">
        方案次数
        <select v-model.number="planPassCount" :disabled="isBusy">
          <option v-for="count in passCountOptions" :key="`plan-${count}`" :value="count">
            {{ count }}
          </option>
        </select>
      </label>
      <label class="run-pref">
        正文次数
        <select v-model.number="draftPassCount" :disabled="isBusy">
          <option v-for="count in passCountOptions" :key="`draft-${count}`" :value="count">
            {{ count }}
          </option>
        </select>
      </label>
    </div>

    <ol class="stepper">
      <li
        v-for="(stepKey, index) in stepperSteps"
        :key="stepKey"
        :class="[`step--${stepVisualFor(stepKey)}`, { active: step === stepKey }]"
      >
        {{ index + 1 }}. {{ stepperLabels[stepKey] }}
        <span v-if="stepVisualFor(stepKey) === 'running'" class="step-badge">生成中</span>
        <span v-else-if="stepVisualFor(stepKey) === 'awaiting'" class="step-badge step-badge--await"
          >待确认</span
        >
      </li>
    </ol>

    <AiTaskProgressPanel
      :progress="aiTaskProgress"
      show-trace-on-error
      @interrupt="interruptGeneration"
    />

    <div v-if="generatingPlan || generatingDraft || autoLoopRunning" class="stream-actions">
      <SseInterruptButton @interrupt="interruptGeneration" />
    </div>
    <p v-if="statusText && !aiTaskProgress.active" class="message message-info">{{ statusText }}</p>
    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <pre v-if="generatingPlan && streamedPlanText" class="plan-stream-preview">{{
      streamedPlanText
    }}</pre>

    <section v-if="step === 'instruction'" class="step-section">
      <label class="field-label" for="writing-optimize-instruction">文笔优化要求</label>
      <textarea
        id="writing-optimize-instruction"
        v-model="instruction"
        class="instruction-input"
        rows="6"
        maxlength="2000"
        :disabled="isBusy"
        placeholder="例如：收紧节奏，减少解释性叙述，加强人物之间的张力，同时保持剧情和人物设定不变。"
      />
      <div class="actions">
        <button class="secondary-button" type="button" :disabled="isBusy" @click="close">
          取消
        </button>
        <button
          v-if="isAutoLoopMode"
          class="primary-button"
          type="button"
          :disabled="!canStartAutoLoop"
          @click="startAutoLoop"
        >
          {{ autoLoopRunning ? '循环中…' : '开始自动循环' }}
        </button>
        <button
          v-else-if="isDirectMode"
          class="primary-button"
          type="button"
          :disabled="!canGenerateDraft"
          @click="generateDraft"
        >
          {{ generatingDraft ? '生成中…' : '直接生成正文' }}
        </button>
        <button
          v-else
          class="primary-button"
          type="button"
          :disabled="!canGeneratePlan"
          @click="generatePlan"
        >
          {{ generatingPlan ? '生成中…' : '生成优化方案' }}
        </button>
      </div>
    </section>

    <section v-else-if="step === 'plan'" class="step-section">
      <div class="plan-editor-head">
        <label class="field-label" for="writing-optimize-plan">当前优化方案（可直接编辑）</label>
        <span v-if="planRevisionRound > 0" class="revision-badge">
          已完成 {{ planRevisionRound }} 轮 AI 调整
        </span>
      </div>
      <textarea
        id="writing-optimize-plan"
        v-model="editablePlanText"
        class="plan-input"
        rows="14"
        :disabled="isBusy"
      />

      <div class="revision-panel">
        <label class="field-label" for="writing-optimize-plan-feedback">方案修改意见</label>
        <textarea
          id="writing-optimize-plan-feedback"
          v-model="planRevisionFeedback"
          class="revision-feedback-input"
          rows="4"
          maxlength="2000"
          :disabled="isBusy"
          placeholder="例如：保留第二项不变；第三项不要删减对白，改为增加人物心理活动。"
        />
        <div class="revision-actions">
          <span class="field-hint">AI 将基于上方当前方案调整；可反复提交多轮意见。</span>
          <button
            class="secondary-button"
            type="button"
            :disabled="!canRevisePlan"
            @click="revisePlan"
          >
            {{ generatingPlan ? '调整中…' : 'AI 按意见修改方案' }}
          </button>
        </div>
      </div>

      <div class="actions">
        <button
          class="secondary-button"
          type="button"
          :disabled="isBusy"
          @click="step = 'instruction'"
        >
          修改要求
        </button>
        <button class="secondary-button" type="button" :disabled="isBusy" @click="generatePlan">
          放弃当前方案并重生成
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="!canGenerateDraft"
          @click="generateDraft"
        >
          生成优化正文
        </button>
      </div>
    </section>

    <section v-else-if="step === 'loop'" class="step-section">
      <p v-if="autoLoopRestored" class="message message-info">
        已恢复上次未看完的循环结果，可直接对比应用，或重新开始。
      </p>
      <p v-if="autoLoopError" class="message message-error">
        {{ autoLoopError }}
      </p>
      <p v-else-if="autoLoopStoppedText" class="message message-info">
        {{ autoLoopStoppedText }}
      </p>

      <AutoLoopRoundsPanel
        :rounds="autoLoopRounds"
        :live-items="autoLoopItems"
        :active-round-index="autoLoopRoundIndex"
        :active-round-budget="autoLoopActiveBudget"
        :paragraph-count="autoLoopParagraphCount"
        :running="autoLoopRunning"
      />

      <div class="compare-grid">
        <div class="compare-panel">
          <h4 class="panel-title">原文</h4>
          <pre class="original-text">{{ originalText }}</pre>
        </div>
        <div class="compare-panel">
          <h4 class="panel-title">循环成稿（可编辑）</h4>
          <textarea
            v-model="draftText"
            class="draft-input"
            :disabled="autoLoopRunning || applying"
          />
        </div>
      </div>

      <div class="actions">
        <button
          v-if="autoLoopRunning"
          class="secondary-button"
          type="button"
          @click="stopAutoLoopAndAccept"
        >
          停在当前轮并收下
        </button>
        <button
          v-else
          class="secondary-button"
          type="button"
          :disabled="isBusy"
          @click="step = 'instruction'"
        >
          修改要求
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="!canStartAutoLoop"
          @click="startAutoLoop"
        >
          重新开始循环
        </button>
        <button class="primary-button" type="button" :disabled="!canApply" @click="applyDraft">
          {{ applying ? '应用中…' : '应用循环成稿' }}
        </button>
      </div>
    </section>

    <section v-else class="step-section">
      <div class="compare-grid">
        <div class="compare-panel">
          <h4 class="panel-title">原文</h4>
          <pre class="original-text">{{ originalText }}</pre>
        </div>
        <div class="compare-panel">
          <h4 class="panel-title">优化正文（可编辑）</h4>
          <textarea
            v-model="draftText"
            class="draft-input"
            :disabled="generatingDraft || applying"
          />
        </div>
      </div>
      <div class="actions">
        <button
          v-if="isDirectMode"
          class="secondary-button"
          type="button"
          :disabled="isBusy"
          @click="step = 'instruction'"
        >
          修改要求
        </button>
        <button
          v-else
          class="secondary-button"
          type="button"
          :disabled="isBusy"
          @click="step = 'plan'"
        >
          返回方案
        </button>
        <button class="secondary-button" type="button" :disabled="isBusy" @click="generateDraft">
          重新生成正文
        </button>
        <button class="primary-button" type="button" :disabled="!canApply" @click="applyDraft">
          {{ applying ? '应用中…' : '应用优化正文' }}
        </button>
      </div>
    </section>
  </a-modal>
</template>

<style scoped>
.modal-subtitle {
  margin: 0 0 0.8rem;
  color: #6b7280;
  font-size: 0.88rem;
}

.mode-toggle {
  display: flex;
  gap: 0.5rem;
  margin: 0 0 0.85rem;
}

.mode-toggle-button {
  flex: 1;
  padding: 0.45rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #4b5563;
  cursor: pointer;
}

.mode-toggle-button.active {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
  font-weight: 600;
}

.mode-toggle-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.run-prefs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.85rem 1.25rem;
  margin: 0 0 1rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
}

.run-pref {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: #374151;
  font-size: 0.86rem;
}

.run-pref--check {
  font-weight: 600;
}

.run-pref select {
  padding: 0.2rem 0.4rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
}

.stepper {
  display: flex;
  gap: 0.5rem;
  margin: 0 0 1rem;
  padding: 0;
  list-style: none;
}

.stepper li {
  flex: 1;
  padding: 0.55rem 0.75rem;
  border-radius: 6px;
  background: #f3f4f6;
  color: #6b7280;
  text-align: center;
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

.stepper li.step--awaiting {
  background: #ecfdf5;
  color: #047857;
}

.stepper li.step--failed {
  background: #fef2f2;
  color: #b91c1c;
}

.step-badge {
  display: inline-block;
  margin-left: 0.35rem;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 0.72rem;
  font-weight: 600;
}

.step-badge--await {
  background: #d1fae5;
  color: #047857;
}

.step-section {
  display: grid;
  gap: 0.85rem;
}

.field-label,
.panel-title {
  margin: 0;
  color: #111827;
  font-weight: 600;
}

.instruction-input,
.plan-input,
.revision-feedback-input,
.draft-input {
  width: 100%;
  padding: 0.7rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font: inherit;
  line-height: 1.65;
  resize: vertical;
}

.plan-input {
  min-height: 280px;
}

.plan-stream-preview {
  max-height: 220px;
  margin: 0.5rem 0;
  padding: 0.9rem;
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}

.plan-editor-head,
.revision-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.revision-badge {
  color: #2563eb;
  font-size: 0.82rem;
}

.revision-panel {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
}

.field-hint {
  color: #6b7280;
  font-size: 0.82rem;
}

.compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.compare-panel {
  display: grid;
  grid-template-rows: auto minmax(420px, 60vh);
  gap: 0.5rem;
  min-width: 0;
}

.original-text,
.draft-input {
  min-height: 420px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.original-text {
  padding: 0.7rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
  font-family: inherit;
  line-height: 1.65;
}

.actions,
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

.secondary-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
}

.primary-button:disabled,
.secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.message {
  margin: 0.5rem 0;
  font-size: 0.86rem;
}

.message-info {
  color: #2563eb;
}

.message-error {
  color: #dc2626;
}

@media (max-width: 820px) {
  .compare-grid {
    grid-template-columns: 1fr;
  }
}
</style>
