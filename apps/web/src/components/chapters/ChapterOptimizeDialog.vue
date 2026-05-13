<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  apiClient,
  type ChapterItem,
  type ChapterOptimizationPlanResult,
} from '../../services/api';
import {
  presentError,
  presentErrorFromCaught,
  presentInfo,
  presentSuccess,
} from '../../utils/pageFeedback';

type Step = 'instruction' | 'plan' | 'draft';

const props = defineProps<{
  visible: boolean;
  projectId: string;
  chapter: ChapterItem | null;
}>();

const emit = defineEmits<{
  close: [];
  applied: [chapter: ChapterItem];
}>();

const step = ref<Step>('instruction');
const instruction = ref('');
const plan = ref<ChapterOptimizationPlanResult | null>(null);
const draftText = ref('');
const draftTraceId = ref('');

const generatingPlan = ref(false);
const generatingDraft = ref(false);
const applying = ref(false);
const errorMessage = ref('');

const chapterUpdatedAtSnapshot = ref<string>('');

const stepIndex = computed(() => {
  switch (step.value) {
    case 'instruction':
      return 0;
    case 'plan':
      return 1;
    case 'draft':
      return 2;
    default:
      return 0;
  }
});

const isBusy = computed(() => generatingPlan.value || generatingDraft.value || applying.value);

watch(
  () => props.visible,
  (next) => {
    if (next) {
      resetState();
    }
  },
  { immediate: true }
);

function resetState() {
  step.value = 'instruction';
  instruction.value = '';
  plan.value = null;
  draftText.value = '';
  draftTraceId.value = '';
  errorMessage.value = '';
  chapterUpdatedAtSnapshot.value = props.chapter?.updatedAt || '';
}

function close() {
  if (isBusy.value) {
    return;
  }
  emit('close');
}

async function handleGeneratePlan() {
  if (!props.chapter || !instruction.value.trim()) {
    errorMessage.value = presentError('请填写优化要求');
    return;
  }

  generatingPlan.value = true;
  errorMessage.value = '';
  try {
    await apiClient.optimizeChapterPlanSSE(
      props.projectId,
      props.chapter.chapterNo,
      { instruction: instruction.value.trim() },
      {
        onStart: (p) => {
          plan.value = {
            planText: '',
            planId: p.planId,
            traceId: p.traceId,
            basis: p.basis,
          };
          step.value = 'plan';
        },
        onContent: (text) => {
          if (plan.value) {
            plan.value = { ...plan.value, planText: plan.value.planText + text };
          }
        },
        onEnd: (result) => {
          plan.value = result;
          presentSuccess('优化方案已生成，可直接修改方案文本后再生成正文');
        },
        onError: (message) => {
          errorMessage.value = presentError(message || '生成优化方案失败');
          plan.value = null;
          step.value = 'instruction';
        },
      }
    );
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '生成优化方案失败');
    plan.value = null;
    step.value = 'instruction';
  } finally {
    generatingPlan.value = false;
  }
}

async function handleRegeneratePlan() {
  if (!props.chapter) return;
  generatingPlan.value = true;
  errorMessage.value = '';
  try {
    await apiClient.optimizeChapterPlanSSE(
      props.projectId,
      props.chapter.chapterNo,
      { instruction: instruction.value.trim() },
      {
        onStart: (p) => {
          plan.value = {
            planText: '',
            planId: p.planId,
            traceId: p.traceId,
            basis: p.basis,
          };
        },
        onContent: (text) => {
          if (plan.value) {
            plan.value = { ...plan.value, planText: plan.value.planText + text };
          }
        },
        onEnd: (result) => {
          plan.value = result;
          presentInfo('优化方案已重新生成，可按需编辑后再生成正文');
        },
        onError: (message) => {
          errorMessage.value = presentError(message || '重新生成优化方案失败');
        },
      }
    );
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '重新生成优化方案失败');
  } finally {
    generatingPlan.value = false;
  }
}

async function handleGenerateDraft() {
  if (!props.chapter || !plan.value) return;

  const planBody = plan.value.planText.trim();
  if (!planBody) {
    errorMessage.value = presentError('方案内容不能为空，请填写或重新生成方案');
    return;
  }

  draftText.value = '';
  draftTraceId.value = '';
  step.value = 'draft';
  generatingDraft.value = true;
  errorMessage.value = '';

  try {
    await apiClient.optimizeChapterDraftSSE(
      props.projectId,
      props.chapter.chapterNo,
      {
        instruction: instruction.value.trim(),
        planText: planBody,
        planId: plan.value.planId,
      },
      {
        onStart: (traceId) => {
          draftTraceId.value = traceId;
        },
        onContent: (text) => {
          draftText.value += text;
        },
        onEnd: () => {
          generatingDraft.value = false;
          presentSuccess('优化正文已生成，请确认是否覆盖原章节');
        },
        onError: (message) => {
          generatingDraft.value = false;
          errorMessage.value = presentError(message || '优化正文生成失败');
        },
      }
    );
  } catch (error) {
    generatingDraft.value = false;
    errorMessage.value = presentErrorFromCaught(error, '优化正文生成失败');
  }
}

async function handleRegenerateDraft() {
  await handleGenerateDraft();
}

function handleBackToInstruction() {
  if (isBusy.value) return;
  step.value = 'instruction';
}

function handleBackToPlan() {
  if (isBusy.value) return;
  step.value = 'plan';
}

async function handleApply() {
  if (!props.chapter || !draftText.value.trim()) {
    errorMessage.value = presentError('暂无可应用的优化正文');
    return;
  }

  applying.value = true;
  errorMessage.value = '';
  try {
    const result = await apiClient.applyChapterOptimization(
      props.projectId,
      props.chapter.chapterNo,
      {
        draftText: draftText.value.trim(),
        expectedChapterUpdatedAt: chapterUpdatedAtSnapshot.value,
        planId: plan.value?.planId,
      }
    );
    presentSuccess(`第${props.chapter.chapterNo}章已更新为优化后的正文`);
    emit('applied', result.chapter);
    emit('close');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '应用优化正文失败');
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <div v-if="props.visible" class="modal-overlay" role="presentation" @click.self="close">
    <section
      class="modal-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="optimize-modal-title"
    >
      <header class="modal-header">
        <div>
          <h3 id="optimize-modal-title" class="modal-title">
            章节优化{{ props.chapter ? ` · 第${props.chapter.chapterNo}章` : '' }}
          </h3>
          <p class="modal-subtitle">
            三步流程：输入要求 → 确认或编辑方案 → 生成正文 → 覆盖原章节
          </p>
        </div>
        <button
          type="button"
          class="modal-close"
          aria-label="关闭弹窗"
          :disabled="isBusy"
          @click="close"
        >
          ×
        </button>
      </header>

      <ol class="stepper" :data-step="stepIndex">
        <li :class="{ active: step === 'instruction', done: stepIndex > 0 }">
          <span class="stepper-no">1</span>
          <span>输入要求</span>
        </li>
        <li :class="{ active: step === 'plan', done: stepIndex > 1 }">
          <span class="stepper-no">2</span>
          <span>确认方案</span>
        </li>
        <li :class="{ active: step === 'draft' }">
          <span class="stepper-no">3</span>
          <span>确认正文</span>
        </li>
      </ol>

      <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>

      <section v-if="step === 'instruction'" class="step-section">
        <label class="field-label" for="optimize-instruction">优化要求</label>
        <textarea
          id="optimize-instruction"
          v-model="instruction"
          class="field-textarea"
          placeholder="例如：增加主角心理描写、把战斗场景节奏放快、修正某段对话不自然的地方……"
          :disabled="generatingPlan"
        />
        <div class="step-actions">
          <button class="secondary-button" type="button" :disabled="isBusy" @click="close">
            取消
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="!instruction.trim() || generatingPlan"
            @click="handleGeneratePlan"
          >
            {{ generatingPlan ? '生成方案中...' : '生成优化方案' }}
          </button>
        </div>
      </section>

      <section v-else-if="step === 'plan'" class="step-section">
        <h4 class="section-title">优化方案</h4>
        <label class="field-label" for="optimize-plan-text">方案内容</label>
        <textarea
          v-if="plan"
          id="optimize-plan-text"
          v-model="plan.planText"
          class="field-textarea plan-text-editor"
          :readonly="generatingPlan"
          placeholder="生成完成后可在此修改要点，再点击「确认方案，生成正文」"
        />
        <p class="meta-line">
          基于：人物 {{ plan?.basis.usedPersonaId ? '已应用' : '未配置' }} · 大纲
          {{ plan?.basis.outlineUsed ? '已注入' : '未注入' }} · 章节摘要
          {{ plan?.basis.chapterSummaryCount }} 条 · 关系事件
          {{ plan?.basis.usedRelationEvents.length || 0 }} 条
        </p>
        <div class="step-actions">
          <button class="secondary-button" type="button" :disabled="isBusy" @click="close">
            取消优化
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="isBusy"
            @click="handleBackToInstruction"
          >
            返回修改要求
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="isBusy"
            @click="handleRegeneratePlan"
          >
            {{ generatingPlan ? '生成中...' : '重新生成方案' }}
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="!plan?.planText?.trim() || isBusy"
            @click="handleGenerateDraft"
          >
            确认方案，生成正文
          </button>
        </div>
      </section>

      <section v-else-if="step === 'draft'" class="step-section">
        <h4 class="section-title">优化正文</h4>
        <pre class="result-text">{{ draftText || '正在等待生成...' }}</pre>
        <p v-if="draftTraceId" class="meta-line">trace: {{ draftTraceId }}</p>
        <div class="step-actions">
          <button class="secondary-button" type="button" :disabled="isBusy" @click="close">
            取消优化
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="isBusy"
            @click="handleBackToPlan"
          >
            返回方案
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="generatingDraft || applying"
            @click="handleRegenerateDraft"
          >
            {{ generatingDraft ? '生成中...' : '重新生成正文' }}
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="!draftText.trim() || isBusy"
            @click="handleApply"
          >
            {{ applying ? '应用中...' : '确认覆盖原章节' }}
          </button>
        </div>
      </section>
    </section>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(15, 23, 42, 0.45);
}

.modal-dialog {
  width: min(820px, 100%);
  max-height: calc(100vh - 3rem);
  overflow: auto;
  border-radius: 12px;
  background: #fff;
  padding: 1.25rem 1.4rem;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.18);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.modal-title {
  margin: 0;
  font-size: 1.1rem;
}

.modal-subtitle {
  margin: 0.35rem 0 0;
  color: #6b7280;
  font-size: 0.85rem;
}

.modal-close {
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.modal-close:hover:not(:disabled) {
  color: #111827;
}

.modal-close:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stepper {
  display: flex;
  gap: 1.5rem;
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  font-size: 0.85rem;
  color: #9ca3af;
}

.stepper li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.stepper li.active {
  color: #111827;
  font-weight: 600;
}

.stepper li.done {
  color: #059669;
}

.stepper-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  background: #e5e7eb;
  color: #4b5563;
  font-size: 0.75rem;
}

.stepper li.active .stepper-no {
  background: #111827;
  color: #fff;
}

.stepper li.done .stepper-no {
  background: #059669;
  color: #fff;
}

.message {
  margin: 0 0 0.8rem;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  font-size: 0.85rem;
}

.message-error {
  background: #fef2f2;
  color: #991b1b;
}

.step-section {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.section-title {
  margin: 0;
  font-size: 0.95rem;
  color: #111827;
}

.field-label {
  font-size: 0.8rem;
  color: #6b7280;
}

.field-textarea {
  width: 100%;
  min-height: 160px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.55rem 0.65rem;
  font-size: 0.9rem;
  font-family: inherit;
  resize: vertical;
}

.plan-text-editor {
  min-height: 220px;
  max-height: 420px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.plan-text-editor:read-only {
  background: #f9fafb;
  cursor: wait;
}

.result-text {
  margin: 0;
  padding: 0.85rem;
  border-radius: 8px;
  background: #fafafa;
  border: 1px solid #e5e7eb;
  white-space: pre-wrap;
  color: #1f2937;
  min-height: 220px;
  max-height: 420px;
  overflow: auto;
  font-size: 0.9rem;
  line-height: 1.6;
}

.meta-line {
  margin: 0;
  font-size: 0.75rem;
  color: #6b7280;
}

.step-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
}

.primary-button {
  background: #111827;
  color: #fff;
  border: none;
}

.secondary-button {
  background: #fff;
  color: #111827;
  border: 1px solid #d1d5db;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
