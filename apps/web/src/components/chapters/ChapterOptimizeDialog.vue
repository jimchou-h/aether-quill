<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import {
  apiClient,
  formatChapterOptimizeStageLabel,
  type ChapterItem,
  type ChapterOptimizationPlanResult,
  type PersonaItem,
} from '../../services/api';
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
import {
  resolveWritingOptimizeStepperSteps,
  resolveWritingOptimizeStepVisual,
  type WritingOptimizeRewriteMode,
  type WritingOptimizeStep,
} from '../../utils/writingOptimizeStepVisual';
import { resolveChapterOptimizePrepProgress } from '../../utils/chapterOptimizePrepProgress';
import { shouldRenderOptimizeDiff } from '../../utils/chapterOptimizeDiff';
import { createThrottledTextSink } from '../../utils/throttledTextSink';
import { formatWritingOptimizePassLabel } from '../../utils/writingOptimizeMultiPass';
import {
  formatFromPlanClosedRunStatus,
  shouldRunFromPlanRefinePass,
} from '../../utils/fromPlanClosedRun';
import { useChapterAutoLoop } from '../../composables/useChapterAutoLoop';
import { useChapterAutoLoopPrefs } from '../../composables/useChapterAutoLoopPrefs';
import { canOpenPromptLabKind } from '../../utils/autoLoopPromptLab';
import {
  suggestAutoLoopPersonaNames,
  toggleAutoLoopPersonaName,
} from '../../utils/autoLoopPersonas';
import {
  AUTO_LOOP_ROUND_BUDGET_MAX,
  AUTO_LOOP_ROUND_BUDGET_MIN,
} from '../../utils/chapterAutoLoopPrefs';
import AiTaskProgressPanel from '../common/AiTaskProgressPanel.vue';
import AutoLoopRoundsPanel from './AutoLoopRoundsPanel.vue';
import AutoLoopPromptLabDrawer from './AutoLoopPromptLabDrawer.vue';
import ChapterOptimizeComparePane from './ChapterOptimizeComparePane.vue';
import SseInterruptButton from '../common/SseInterruptButton.vue';
import type { AutoLoopPromptLabCall } from '../../services/api';

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
const { roundBudget } = useChapterAutoLoopPrefs();
const personaOptions = ref<PersonaItem[]>([]);
const selectedPersonaNames = ref<string[]>([]);
const personasLoading = shallowRef(false);
const passLoopAborted = shallowRef(false);
const closedRunStatus = shallowRef('');
const roundBudgetOptions = Array.from(
  { length: AUTO_LOOP_ROUND_BUDGET_MAX - AUTO_LOOP_ROUND_BUDGET_MIN + 1 },
  (_, index) => AUTO_LOOP_ROUND_BUDGET_MIN + index
);

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
  canResume: autoLoopCanResume,
  resumeActionText: autoLoopResumeActionText,
  liveWindowIndex: autoLoopWindowIndex,
  liveWindowTotal: autoLoopWindowTotal,
  promptLabCalls: autoLoopPromptLabCalls,
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

const promptLabOpen = shallowRef(false);
const promptLabCall = shallowRef<AutoLoopPromptLabCall | null>(null);

function openPromptLab(call: AutoLoopPromptLabCall) {
  if (!canOpenPromptLabKind(call.kind)) {
    return;
  }
  promptLabCall.value = call;
  promptLabOpen.value = true;
}

function closePromptLab() {
  promptLabOpen.value = false;
}

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
const canContinueAutoLoop = computed(
  () => canStartAutoLoop.value && autoLoopCanResume.value && !autoLoopRunning.value
);
const personaChipOptions = computed(() => {
  const content = props.chapter?.content ?? '';
  return personaOptions.value.filter(
    (persona) => persona.status === 'published' || content.includes(persona.name)
  );
});

async function loadAutoLoopPersonas() {
  if (!props.visible || !props.projectId || rewriteMode.value !== 'auto-loop') {
    return;
  }
  personasLoading.value = true;
  try {
    const list = await apiClient.getPersonas(props.projectId);
    personaOptions.value = list;
    selectedPersonaNames.value = suggestAutoLoopPersonaNames(list, props.chapter?.content ?? '');
  } catch {
    personaOptions.value = [];
    selectedPersonaNames.value = [];
  } finally {
    personasLoading.value = false;
  }
}

function togglePersonaChip(name: string) {
  selectedPersonaNames.value = toggleAutoLoopPersonaName(selectedPersonaNames.value, name);
}

const modeSubtitle = computed(() => {
  if (isAutoLoopMode.value) {
    return '只补「要求没落地」或「上轮改坏」的段落；复诊和改写会带上勾选角色的角色卡。未命中段落逐字节保留。随时可以停下并收下当前成稿。';
  }
  if (isDirectMode.value) {
    return '根据自由要求直接改写整章正文；只有确认应用后才会覆盖原文。';
  }
  return '根据自由要求先生成编辑方案，再按冻结合同改写并验收；最多再补一刀后收口。只有确认应用后才会覆盖原文。';
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
  closedRunStatus.value = '';
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
  closedRunStatus.value = '';
  generatingPlan.value = false;
  generatingDraft.value = false;
  applying.value = false;
  planStream.abort();
  draftStream.abort();
  autoLoopReset();
  personaOptions.value = [];
  selectedPersonaNames.value = [];
  personasLoading.value = false;
  clearInterruptHandler();
}

watch(
  () => props.visible,
  (visible) => {
    closePromptLab();
    if (visible) {
      // Drop completed banners from prior page/dialog work so they don't sit under this modal.
      dismissIdleAiTaskProgress(aiTaskProgress);
      resetState();
    } else {
      dismissIdleAiTaskProgress(aiTaskProgress);
    }
  },
  { immediate: true }
);

watch(
  () => [props.visible, rewriteMode.value, props.projectId, props.chapter?.chapterNo] as const,
  ([visible, mode]) => {
    if (!visible || mode !== 'auto-loop') {
      return;
    }
    void loadAutoLoopPersonas();
  }
);
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
      ...(selectedPersonaNames.value.length
        ? { appearingCharacters: [...selectedPersonaNames.value] }
        : {}),
    });
    if (outcome === 'busy') {
      step.value = 'instruction';
    }
  } finally {
    clearInterruptHandler();
  }
}

async function continueAutoLoop() {
  if (!props.chapter || !canStartAutoLoop.value || autoLoopRunning.value) {
    return;
  }
  errorMessage.value = '';
  statusText.value = '';
  step.value = 'loop';
  const view = await autoLoopRestoreSession({ onlyIfResumable: true });
  if (!view) {
    return;
  }
  bindInterruptHandler();
  try {
    const outcome = await runAutoLoop({
      instruction: instruction.value.trim(),
      roundBudget: roundBudget.value,
      resume: true,
      ...(selectedPersonaNames.value.length
        ? { appearingCharacters: [...selectedPersonaNames.value] }
        : {}),
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
  const planSink = createThrottledTextSink(streamedPlanText);

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
          planSink.append(text);
        },
        onEnd: (result) => {
          planSink.dispose();
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
    planSink.dispose();
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

  const started = tryStartAiTaskProgress(aiTaskProgress, {
    taskKey: 'chapter.optimize.plan',
    message: formatWritingOptimizePassLabel('plan', 1, 1),
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
  closedRunStatus.value = '';
  try {
    await runSinglePlanPass({
      chapter,
      revision: false,
      revisionFeedback: '',
      passIndex: 1,
      passTotal: 1,
      completeOnEnd: true,
    });
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
  reviewGaps?: string;
  completeOnEnd: boolean;
}): Promise<PassOutcome> {
  const currentPlan = plan.value;
  const taskKey = input.isDirect ? 'chapter.optimize.direct-draft' : 'chapter.optimize.draft';
  const passLabel = input.isDirect
    ? '正在按要求改写正文…'
    : formatFromPlanClosedRunStatus({
        phase: input.passIndex > 1 ? 'draft2' : 'draft1',
      });
  statusText.value = passLabel;
  draftText.value = '';
  step.value = 'draft';

  const signal = draftStream.begin();
  bindInterruptHandler();
  let outcome: PassOutcome = 'error';
  const draftSink = createThrottledTextSink(draftText);

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
            ...(input.reviewGaps ? { reviewGaps: input.reviewGaps } : {}),
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
          draftSink.append(text);
        },
        onContentReplace: (text) => {
          draftSink.replace(text);
        },
        onEnd: (event) => {
          draftSink.flush();
          if (event.finalDraftText?.trim()) {
            draftSink.replace(event.finalDraftText);
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
    draftSink.flush();
    draftSink.dispose();
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

  const progressMessage = isDirect
    ? '正在按要求改写正文…'
    : formatFromPlanClosedRunStatus({ phase: 'draft1' });
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
  closedRunStatus.value = '';
  let lastSuccessful = draftText.value.trim();
  try {
    const firstOutcome = await runSingleDraftPass({
      chapter,
      isDirect,
      passIndex: 1,
      passTotal: isDirect ? 1 : 2,
      completeOnEnd: isDirect,
    });
    if (firstOutcome !== 'ok' || isDirect) {
      if (firstOutcome !== 'ok') {
        draftText.value = lastSuccessful;
      }
      return;
    }

    lastSuccessful = draftText.value.trim();
    const review = await runFrozenReview(chapter);
    if (review === 'aborted') {
      draftText.value = lastSuccessful;
      return;
    }
    if (!shouldRunFromPlanRefinePass(review.hasMaterialGaps)) {
      closedRunStatus.value = formatFromPlanClosedRunStatus({
        phase: 'closed',
        hasMaterialGaps: false,
      });
      statusText.value = closedRunStatus.value;
      completeAiTaskProgress(aiTaskProgress, closedRunStatus.value);
      return;
    }

    const refineOutcome = await runSingleDraftPass({
      chapter,
      isDirect: false,
      passIndex: 2,
      passTotal: 2,
      sourceText: lastSuccessful,
      reviewGaps: review.reviewText,
      completeOnEnd: true,
    });
    if (refineOutcome !== 'ok') {
      draftText.value = lastSuccessful;
    }
    closedRunStatus.value = formatFromPlanClosedRunStatus({
      phase: 'closed',
      hasMaterialGaps: refineOutcome === 'ok',
    });
    if (refineOutcome === 'ok') {
      statusText.value = closedRunStatus.value;
      completeAiTaskProgress(aiTaskProgress, closedRunStatus.value);
    }
  } finally {
    generatingDraft.value = false;
  }
}

async function runFrozenReview(
  chapter: ChapterItem
): Promise<{ hasMaterialGaps: boolean; reviewText: string } | 'aborted'> {
  const currentPlan = plan.value;
  const draft = draftText.value.trim();
  if (!currentPlan || !draft) {
    return { hasMaterialGaps: false, reviewText: '' };
  }

  const passLabel = formatFromPlanClosedRunStatus({ phase: 'review' });
  statusText.value = passLabel;
  applyAiTaskProgressEvent(aiTaskProgress, {
    taskKey: 'chapter.optimize.draft',
    stage: 'frozen_review',
    message: passLabel,
  });

  const signal = planStream.begin();
  bindInterruptHandler();
  let outcome: { hasMaterialGaps: boolean; reviewText: string } | 'aborted' | 'error' = 'error';

  try {
    await apiClient.optimizeChapterReviewSSE(
      props.projectId,
      chapter.chapterNo,
      {
        instruction: instruction.value.trim(),
        planText: editablePlanText.value.trim(),
        draftText: draft,
        planId: currentPlan.planId,
      },
      {
        onStage: ({ stage }) => {
          const label = `${passLabel} · ${formatChapterOptimizeStageLabel(stage)}`;
          statusText.value = label;
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.draft',
            stage,
            message: label,
          });
        },
        onEnd: (event) => {
          outcome = {
            hasMaterialGaps: event.hasMaterialGaps,
            reviewText: event.reviewText,
          };
        },
        onError: (messageText) => {
          errorMessage.value = messageText;
          outcome = 'error';
        },
      },
      { signal }
    );
  } catch (error) {
    if (isSseAbortError(error) || passLoopAborted.value) {
      outcome = 'aborted';
      cancelAiTaskProgress(aiTaskProgress, '已中断文笔优化生成');
    } else {
      errorMessage.value = presentErrorFromCaught(error, '冻结验收失败');
      outcome = 'error';
    }
  } finally {
    planStream.abort();
    clearInterruptHandler();
  }

  if (outcome === 'aborted') {
    return 'aborted';
  }
  if (outcome === 'error') {
    return { hasMaterialGaps: false, reviewText: '' };
  }
  return outcome;
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
    width="100%"
    wrap-class-name="writing-optimize-fullscreen"
    transition-name=""
    :style="{ top: 0, paddingBottom: 0, maxWidth: '100vw', margin: 0 }"
    :title="`文笔优化${props.chapter ? ` · 第${props.chapter.chapterNo}章` : ''}`"
    :footer="null"
    destroy-on-close
    :mask-closable="!isBusy"
    :closable="!applying"
    @cancel="close"
  >
    <div class="wo-shell">
      <header class="wo-chrome">
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
          <span class="field-hint">
            1～5，对每一窗生效。每轮＝复诊该窗上一稿 + 只改命中段落；中间轮每轮最多约 12
            段，多出来的顺延。最后一轮会把本轮点到的条目全部改完再结束。没有明显未落实或改坏会提前收敛。
          </span>
        </div>

        <ol class="stepper">
          <li
            v-for="(stepKey, index) in stepperSteps"
            :key="stepKey"
            :class="[`step--${stepVisualFor(stepKey)}`, { active: step === stepKey }]"
          >
            {{ index + 1 }}. {{ stepperLabels[stepKey] }}
            <span v-if="stepVisualFor(stepKey) === 'running'" class="step-badge">生成中</span>
            <span
              v-else-if="stepVisualFor(stepKey) === 'awaiting'"
              class="step-badge step-badge--await"
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
        <p v-if="statusText && !aiTaskProgress.active" class="message message-info">
          {{ statusText }}
        </p>
        <p v-if="closedRunStatus && !isBusy" class="message message-info">{{ closedRunStatus }}</p>
        <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
        <pre v-if="generatingPlan && streamedPlanText" class="plan-stream-preview">{{
          streamedPlanText
        }}</pre>
      </header>

      <div class="wo-body">
        <section v-if="step === 'instruction'" class="step-section step-section--fill">
          <label class="field-label" for="writing-optimize-instruction">文笔优化要求</label>
          <textarea
            id="writing-optimize-instruction"
            v-model="instruction"
            class="instruction-input"
            rows="6"
            :disabled="isBusy"
            placeholder="例如：收紧节奏，减少解释性叙述，加强人物之间的张力，同时保持剧情和人物设定不变。"
          />
          <div v-if="isAutoLoopMode" class="persona-picker">
            <p class="field-label">角色卡</p>
            <p class="field-hint">
              复诊和改写都会注入勾选角色的人设与角色卡全文。默认勾上正文里出现的名字；不勾则按正文出场人物，没有名字时用全部已发布人物。
            </p>
            <p v-if="personasLoading" class="field-hint">正在加载人物…</p>
            <p v-else-if="personaChipOptions.length === 0" class="field-hint">
              项目还没有可注入的人物。
            </p>
            <div v-else class="chip-list">
              <button
                v-for="persona in personaChipOptions"
                :key="persona.id"
                type="button"
                class="chip-button"
                :class="{ 'chip-button-active': selectedPersonaNames.includes(persona.name) }"
                :disabled="isBusy"
                @click="togglePersonaChip(persona.name)"
              >
                {{ persona.name }}
              </button>
            </div>
          </div>
        </section>

        <section v-else-if="step === 'plan'" class="step-section step-section--fill">
          <div class="plan-editor-head">
            <label class="field-label" for="writing-optimize-plan"
              >当前优化方案（可直接编辑）</label
            >
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
        </section>

        <section v-else-if="step === 'loop'" class="wo-loop">
          <p v-if="autoLoopRestored" class="message message-info">
            已恢复上次未看完的循环结果，可直接对比应用，或从失败处继续。
          </p>
          <p v-if="autoLoopError" class="message message-error">
            {{ autoLoopError }}
          </p>
          <p v-else-if="autoLoopStoppedText" class="message message-info">
            {{ autoLoopStoppedText }}
          </p>

          <div class="wo-loop-split">
            <aside class="wo-rail">
              <AutoLoopRoundsPanel
                :rounds="autoLoopRounds"
                :live-items="autoLoopItems"
                :active-round-index="autoLoopRoundIndex"
                :active-round-budget="autoLoopActiveBudget"
                :live-window-index="autoLoopWindowIndex"
                :live-window-total="autoLoopWindowTotal"
                :paragraph-count="autoLoopParagraphCount"
                :running="autoLoopRunning"
                :prompt-lab-calls="autoLoopPromptLabCalls"
                @open-diagnose-lab="openPromptLab"
              />
            </aside>
            <div class="wo-main">
              <ChapterOptimizeComparePane
                v-model="draftText"
                :original="originalText"
                draft-title="循环成稿（可编辑）"
                :draft-disabled="autoLoopRunning || applying"
                :show-diff="shouldRenderOptimizeDiff(autoLoopRunning)"
              />
            </div>
          </div>
        </section>

        <section v-else class="step-section step-section--fill">
          <ChapterOptimizeComparePane
            v-model="draftText"
            :original="originalText"
            draft-title="优化正文（可编辑）"
            :draft-disabled="generatingDraft || applying"
            :show-diff="shouldRenderOptimizeDiff(generatingDraft)"
          />
        </section>
      </div>

      <footer class="wo-footer">
        <template v-if="step === 'instruction'">
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
        </template>
        <template v-else-if="step === 'plan'">
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
            按方案改写并收口
          </button>
        </template>
        <template v-else-if="step === 'loop'">
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
            v-if="autoLoopCanResume && !autoLoopRunning"
            class="primary-button"
            type="button"
            :disabled="!canContinueAutoLoop"
            @click="continueAutoLoop"
          >
            {{ autoLoopResumeActionText }}
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
        </template>
        <template v-else>
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
            重新按方案改写并收口
          </button>
          <button class="primary-button" type="button" :disabled="!canApply" @click="applyDraft">
            {{ applying ? '应用中…' : '应用优化正文' }}
          </button>
        </template>
      </footer>
    </div>
  </a-modal>
  <AutoLoopPromptLabDrawer
    :open="promptLabOpen"
    :project-id="projectId"
    :chapter-no="chapter?.chapterNo ?? 0"
    :call="promptLabCall"
    @close="closePromptLab"
  />
</template>

<style scoped>
.wo-shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  overflow: visible;
}
.wo-chrome {
  flex: 0 0 auto;
}
.wo-body {
  flex: 1 0 auto;
  overflow: visible;
  display: flex;
  flex-direction: column;
}
.wo-footer {
  flex: 0 0 auto;
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 0 8px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}
.wo-loop {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wo-loop-split {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
.wo-rail {
  height: auto;
  overflow: visible;
  padding: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
}
.wo-main {
  min-width: 0;
  overflow: visible;
}
.modal-subtitle {
  margin: 0 0 8px;
  color: #6b7280;
  font-size: 13px;
}

.mode-toggle {
  display: flex;
  gap: 0;
  margin: 0 0 8px;
  padding: 3px;
  width: fit-content;
  max-width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f3f4f6;
}

.mode-toggle-button {
  padding: 6px 14px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #4b5563;
  cursor: pointer;
  transition:
    background-color 180ms ease,
    color 180ms ease;
}

.mode-toggle-button:hover:not(:disabled) {
  color: #1f2937;
}

.mode-toggle-button.active {
  background: #fff;
  color: #1d4ed8;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.mode-toggle-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.mode-toggle-button:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.run-prefs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin: 0 0 8px;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.run-pref {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #374151;
  font-size: 13px;
}

.run-pref--check {
  font-weight: 600;
}

.run-pref select {
  padding: 2px 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
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
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.step-section--fill {
  flex: 1 0 auto;
}

.field-label {
  margin: 0;
  color: #111827;
  font-weight: 600;
}

.instruction-input,
.plan-input,
.revision-feedback-input {
  width: 100%;
  padding: 0.7rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font: inherit;
  line-height: 1.65;
  resize: vertical;
}

.instruction-input {
  flex: 1;
  min-height: 160px;
  resize: none;
}

.plan-input {
  flex: 1;
  min-height: 160px;
  resize: none;
}

.plan-stream-preview {
  max-height: 120px;
  margin: 0 0 8px;
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
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    opacity 180ms ease;
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

.primary-button:focus-visible,
.secondary-button:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
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

.persona-picker {
  display: grid;
  gap: 0.45rem;
  margin-top: 0.85rem;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.chip-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  border-radius: 8px;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  font-size: 0.85rem;
}

.chip-button:hover:not(:disabled) {
  border-color: #93c5fd;
  background: #f0f5ff;
}

.chip-button-active {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.chip-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 960px) {
  .wo-loop-split {
    grid-template-columns: 1fr;
  }
}
</style>

<style>
.writing-optimize-fullscreen.ant-modal-wrap {
  overflow: hidden;
}
.writing-optimize-fullscreen.ant-modal-wrap .ant-modal {
  max-width: 100%;
  top: 0;
  padding-bottom: 0;
  margin: 0;
}
.writing-optimize-fullscreen.ant-modal-wrap .ant-modal-content {
  display: flex;
  flex-direction: column;
  height: 100vh;
  border-radius: 0;
  box-shadow: none;
}
.writing-optimize-fullscreen.ant-modal-wrap .ant-modal-header {
  flex: 0 0 auto;
  padding: 12px 16px;
  margin-bottom: 0;
  border-bottom: 1px solid #e5e7eb;
}
.writing-optimize-fullscreen.ant-modal-wrap .ant-modal-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 16px 0;
  display: flex;
  flex-direction: column;
}
</style>
