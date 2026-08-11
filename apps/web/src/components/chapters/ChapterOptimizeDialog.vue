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
  resolveWritingOptimizeStepVisual,
  type WritingOptimizeStep,
} from '../../utils/writingOptimizeStepVisual';
import { resolveChapterOptimizePrepProgress } from '../../utils/chapterOptimizePrepProgress';
import AiTaskProgressPanel from '../common/AiTaskProgressPanel.vue';
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

const isBusy = computed(() => generatingPlan.value || generatingDraft.value || applying.value);
const canGeneratePlan = computed(() => Boolean(instruction.value.trim()) && !isBusy.value);
const canRevisePlan = computed(
  () =>
    Boolean(editablePlanText.value.trim()) &&
    Boolean(planRevisionFeedback.value.trim()) &&
    !isBusy.value
);
const canGenerateDraft = computed(() => Boolean(editablePlanText.value.trim()) && !isBusy.value);
const canApply = computed(() => Boolean(draftText.value.trim()) && !isBusy.value);

const stepVisualInput = computed(() => ({
  currentStep: step.value,
  generatingPlan: generatingPlan.value,
  generatingDraft: generatingDraft.value,
  hasPlan: Boolean(editablePlanText.value.trim() || plan.value),
  hasDraft: Boolean(draftText.value.trim()),
  hasError: Boolean(errorMessage.value),
}));

const instructionStepVisual = computed(() =>
  resolveWritingOptimizeStepVisual({ ...stepVisualInput.value, stepKey: 'instruction' })
);
const planStepVisual = computed(() =>
  resolveWritingOptimizeStepVisual({ ...stepVisualInput.value, stepKey: 'plan' })
);
const draftStepVisual = computed(() =>
  resolveWritingOptimizeStepVisual({ ...stepVisualInput.value, stepKey: 'draft' })
);

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
  step.value = 'instruction';
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

function close() {
  if (generatingPlan.value) {
    planStream.abort();
  }
  if (generatingDraft.value) {
    draftStream.abort();
  }
  if (!applying.value) {
    emit('close');
  }
}

function interruptGeneration() {
  planStream.abort();
  draftStream.abort();
  generatingPlan.value = false;
  generatingDraft.value = false;
  cancelAiTaskProgress(aiTaskProgress, '已中断文笔优化生成');
  statusText.value = presentInfo('已中断文笔优化生成');
  clearInterruptHandler();
}

async function runPlanGeneration(revision: boolean) {
  const chapter = props.chapter;
  const normalizedInstruction = instruction.value.trim();
  if (!chapter || !normalizedInstruction) {
    errorMessage.value = '请填写文笔优化要求';
    return;
  }
  const currentPlanText = editablePlanText.value.trim();
  const revisionFeedback = planRevisionFeedback.value.trim();
  if (revision && (!currentPlanText || !revisionFeedback)) {
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

  generatingPlan.value = true;
  errorMessage.value = '';
  statusText.value = message;
  streamedPlanText.value = '';
  if (!revision) {
    plan.value = null;
    editablePlanText.value = '';
    planRevisionRound.value = 0;
  }
  const signal = planStream.begin();
  bindInterruptHandler();

  try {
    await apiClient.optimizeChapterPlanSSE(
      props.projectId,
      chapter.chapterNo,
      {
        instruction: normalizedInstruction,
        ...(revision ? { currentPlanText, revisionFeedback } : {}),
      },
      {
        onStart: (event) => {
          if (event.strategyLabel) {
            statusText.value = event.strategyLabel;
            applyAiTaskProgressEvent(aiTaskProgress, {
              taskKey: 'chapter.optimize.plan',
              stage: 'running',
              message: event.strategyLabel,
            });
          }
        },
        onStage: ({ stage, segmentIndex, segmentTotal, retryCount }) => {
          const label = formatChapterOptimizeStageLabel(
            stage,
            segmentIndex,
            segmentTotal,
            retryCount
          );
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
          if (revision) {
            planRevisionRound.value += 1;
            planRevisionFeedback.value = '';
          }
          step.value = 'plan';
          statusText.value = revision
            ? `方案第 ${planRevisionRound.value} 轮调整已完成`
            : '优化方案已生成，可直接编辑或继续让 AI 调整';
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
      cancelAiTaskProgress(aiTaskProgress, '已中断文笔优化生成');
    } else {
      errorMessage.value = presentErrorFromCaught(error, '生成文笔优化方案失败');
      failAiTaskProgress(aiTaskProgress, errorMessage.value);
    }
  } finally {
    planStream.abort();
    generatingPlan.value = false;
    streamedPlanText.value = '';
    clearInterruptHandler();
  }
}

async function generatePlan() {
  await runPlanGeneration(false);
}

async function revisePlan() {
  await runPlanGeneration(true);
}

async function generateDraft() {
  const chapter = props.chapter;
  const currentPlan = plan.value;
  if (!chapter || !currentPlan) {
    return;
  }

  const started = tryStartAiTaskProgress(aiTaskProgress, {
    taskKey: 'chapter.optimize.draft',
    message: '正在按方案改写正文…',
    source: 'dialog:writing-optimize',
    chapterNo: chapter.chapterNo,
    interruptible: true,
    force: false,
  });
  if (!started.ok) {
    errorMessage.value = '当前有其他 AI 任务进行中，请先等待或中断';
    return;
  }

  generatingDraft.value = true;
  errorMessage.value = '';
  statusText.value = '正在按方案改写正文…';
  draftText.value = '';
  step.value = 'draft';
  const signal = draftStream.begin();
  bindInterruptHandler();

  try {
    await apiClient.optimizeChapterDraftSSE(
      props.projectId,
      chapter.chapterNo,
      {
        instruction: instruction.value.trim(),
        planText: editablePlanText.value.trim(),
        planId: currentPlan.planId,
        segmentDiagnoses: currentPlan.segmentDiagnoses,
      },
      {
        onStart: (event) => {
          statusText.value = event.strategyLabel ?? '正在生成优化正文…';
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.draft',
            stage: 'running',
            message: statusText.value,
          });
        },
        onStage: ({ stage, segmentIndex, segmentTotal }) => {
          const label = formatChapterOptimizeStageLabel(stage, segmentIndex, segmentTotal);
          statusText.value = label;
          const prep = resolveChapterOptimizePrepProgress(stage);
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.optimize.draft',
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
            taskKey: 'chapter.optimize.draft',
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
          statusText.value = '优化正文已生成，请对比确认';
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
      cancelAiTaskProgress(aiTaskProgress, '已中断文笔优化生成');
    } else {
      errorMessage.value = presentErrorFromCaught(error, '生成文笔优化正文失败');
      failAiTaskProgress(aiTaskProgress, errorMessage.value);
    }
  } finally {
    draftStream.abort();
    generatingDraft.value = false;
    clearInterruptHandler();
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
    <p class="modal-subtitle">
      根据自由要求先生成编辑方案，再改写整章正文；只有确认应用后才会覆盖原文。
    </p>

    <ol class="stepper">
      <li :class="[`step--${instructionStepVisual}`, { active: step === 'instruction' }]">
        1. 优化要求
        <span v-if="instructionStepVisual === 'running'" class="step-badge">生成中</span>
      </li>
      <li :class="[`step--${planStepVisual}`, { active: step === 'plan' }]">
        2. 优化方案
        <span v-if="planStepVisual === 'running'" class="step-badge">生成中</span>
        <span v-else-if="planStepVisual === 'awaiting'" class="step-badge step-badge--await"
          >待确认</span
        >
      </li>
      <li :class="[`step--${draftStepVisual}`, { active: step === 'draft' }]">
        3. 正文对比
        <span v-if="draftStepVisual === 'running'" class="step-badge">生成中</span>
        <span v-else-if="draftStepVisual === 'awaiting'" class="step-badge step-badge--await"
          >待确认</span
        >
      </li>
    </ol>

    <AiTaskProgressPanel
      :progress="aiTaskProgress"
      show-trace-on-error
      @interrupt="interruptGeneration"
    />

    <div v-if="generatingPlan || generatingDraft" class="stream-actions">
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
        <button class="secondary-button" type="button" :disabled="isBusy" @click="step = 'plan'">
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
