<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  apiClient,
  formatPipelineStageLabel,
  type ChapterItem,
  type ChapterPipelineSessionView,
  type FinalPolishQualityStatus,
  type PipelineRuleIssue,
} from '../../services/api';
import { presentErrorFromCaught, presentInfo, presentSuccess } from '../../utils/pageFeedback';
import { confirmAction } from '../../composables/useAppConfirm';
import {
  applyAiTaskProgressEvent,
  completeAiTaskProgress,
  createAiTaskProgressState,
  failAiTaskProgress,
  resetAiTaskProgress,
  startAiTaskProgress,
} from '../../composables/useAiTaskProgress';
import AiTaskProgressPanel from '../common/AiTaskProgressPanel.vue';
import { buildChapterDiffLines, buildInlineDiffViews } from '../../utils/chapterOptimizeDiff';

type DialogStep = 'running' | 'review';

const props = defineProps<{
  visible: boolean;
  projectId: string;
  chapter: ChapterItem | null;
}>();

const emit = defineEmits<{
  close: [];
  applied: [chapter: ChapterItem];
}>();

const sessionId = ref('');
const session = ref<ChapterPipelineSessionView | null>(null);
const step = ref<DialogStep>('running');
const running = ref(false);
const applying = ref(false);
const errorMessage = ref('');
const streamingText = ref('');
const progressLabel = ref('');
const cachedHint = ref('');
const aiTaskProgress = createAiTaskProgressState();
const chapterUpdatedAtSnapshot = ref('');
const previewMode = ref<'final' | 'diff'>('diff');
const editableFinalText = ref('');

const isBusy = computed(() => running.value || applying.value);

const originalText = computed(() => session.value?.versions.original ?? props.chapter?.content ?? '');

const finalText = computed(
  () =>
    session.value?.finalPolishResult?.versionText ??
    session.value?.versions.final ??
    session.value?.versions.afterRules ??
    ''
);

const qualityStatus = computed<FinalPolishQualityStatus | null>(
  () => session.value?.finalPolishResult?.qualityStatus ?? null
);

const residualIssues = computed<PipelineRuleIssue[]>(
  () => session.value?.finalPolishResult?.residualIssues ?? session.value?.ruleIssues ?? []
);

const diffLines = computed(() => {
  if (!originalText.value || !finalText.value) {
    return [];
  }
  return buildChapterDiffLines(originalText.value, finalText.value);
});

const diffAddedCount = computed(() => diffLines.value.filter((row) => row.type === 'added').length);
const diffRemovedCount = computed(() => diffLines.value.filter((row) => row.type === 'removed').length);
const diffModifiedCount = computed(() => diffLines.value.filter((row) => row.type === 'modified').length);

const inlineDiff = computed(() => buildInlineDiffViews(originalText.value, finalText.value));

const hasResultDiff = computed(
  () => Boolean(originalText.value && finalText.value && diffLines.value.length > 0)
);

const applyBlocked = computed(() => qualityStatus.value === 'blocked');

const qualityStatusLabel = computed(() => {
  switch (qualityStatus.value) {
    case 'passed':
      return '质量门禁已通过';
    case 'passed_with_warnings':
      return '已通过，仍有少量硬风险需留意';
    case 'blocked':
      return '存在阻断性硬风险，需手动修订或确认后应用';
    default:
      return '';
  }
});

function resetState() {
  sessionId.value = '';
  session.value = null;
  step.value = 'running';
  running.value = false;
  applying.value = false;
  errorMessage.value = '';
  streamingText.value = '';
  progressLabel.value = '';
  cachedHint.value = '';
  previewMode.value = 'diff';
  editableFinalText.value = '';
  resetAiTaskProgress(aiTaskProgress);
}

watch(
  () => [step.value, finalText.value] as const,
  ([currentStep, text]) => {
    if (currentStep === 'review' && text) {
      editableFinalText.value = text;
    }
  }
);

watch(
  () => props.visible,
  (visible) => {
    if (visible && props.chapter) {
      resetState();
      chapterUpdatedAtSnapshot.value = props.chapter.updatedAt;
      void startFinalPolish();
    }
    if (!visible) {
      resetState();
    }
  }
);

function close() {
  if (isBusy.value) {
    return;
  }
  emit('close');
}

async function refreshSession() {
  if (!sessionId.value || !props.chapter) {
    return;
  }
  session.value = await apiClient.getChapterPipelineSession(
    props.projectId,
    props.chapter.chapterNo,
    sessionId.value
  );
}

async function runFinalPolishPipeline(forceRegenerate = false) {
  if (!props.chapter?.content?.trim()) {
    errorMessage.value = '章节正文为空';
    step.value = 'review';
    return;
  }

  running.value = true;
  errorMessage.value = '';
  if (forceRegenerate) {
    cachedHint.value = '';
    streamingText.value = '';
    step.value = 'running';
  }
  resetAiTaskProgress(aiTaskProgress);
  startAiTaskProgress(aiTaskProgress, {
    taskKey: 'chapter.pipeline.final-polish',
    message: forceRegenerate ? '正在换一版终稿…' : '一键终稿执行中…',
  });

  try {
    if (!sessionId.value) {
      const result = await apiClient.startChapterPipeline(
        props.projectId,
        props.chapter.chapterNo,
        { mode: 'final-polish' }
      );
      sessionId.value = result.sessionId;
      await refreshSession();
    }

    await apiClient.runChapterPipelineModuleSSE(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      'final-polish',
      forceRegenerate ? { forceRegenerate: true } : undefined,
      {
        onStart: ({ stage }) => {
          if (!forceRegenerate) {
            streamingText.value = '';
          }
          progressLabel.value = formatPipelineStageLabel(stage);
        },
        onStage: ({ stage, segmentIndex, segmentTotal }) => {
          progressLabel.value = formatPipelineStageLabel(stage, segmentIndex, segmentTotal);
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.pipeline.final-polish',
            stage,
            message: progressLabel.value,
            currentStep: segmentIndex,
            totalSteps: segmentTotal,
          });
        },
        onContent: (text) => {
          streamingText.value += text;
        },
        onEnd: async (event) => {
          if (event.cachedFromFingerprint && !forceRegenerate) {
            cachedHint.value = '当前章节已基于最新配置完成一键终稿，可直接审核或应用。';
            presentInfo(cachedHint.value);
          }
          await refreshSession();
          step.value = 'review';
          completeAiTaskProgress(aiTaskProgress, '终稿已生成，等待审核');
        },
        onError: (message) => {
          errorMessage.value = message;
          step.value = 'review';
          failAiTaskProgress(aiTaskProgress, message);
        },
      }
    );
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '一键终稿失败';
    step.value = 'review';
    failAiTaskProgress(aiTaskProgress, errorMessage.value);
    presentErrorFromCaught(error, '一键终稿失败');
  } finally {
    running.value = false;
  }
}

async function startFinalPolish() {
  await runFinalPolishPipeline(false);
}

async function handleRegenerate() {
  await runFinalPolishPipeline(true);
}

async function handleApply() {
  if (!props.chapter || !sessionId.value || applyBlocked.value) {
    return;
  }
  await doApply(finalText.value.trim(), false);
}

async function handleApplyWithOverride() {
  if (!props.chapter || !sessionId.value || !applyBlocked.value) {
    return;
  }
  const text = editableFinalText.value.trim();
  if (!text) {
    return;
  }
  const unchanged = text === finalText.value.trim();
  if (unchanged) {
    const ok = await confirmAction({
      title: '强制应用终稿',
      content:
        '仍存在未解决的硬风险。若未在下方手动修订，将按 AI 原稿强制覆盖章节正文。确认继续？',
    });
    if (!ok) {
      return;
    }
  }
  await doApply(text, true);
}

async function doApply(text: string, useOverride: boolean) {
  if (!props.chapter || !sessionId.value || !text) {
    return;
  }
  applying.value = true;
  try {
    const result = await apiClient.applyChapterPipeline(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        expectedChapterUpdatedAt: chapterUpdatedAtSnapshot.value,
        preserveSummary: true,
        useVersion: 'final',
        draftTextOverride: useOverride ? text : undefined,
      }
    );
    presentSuccess('终稿已应用到章节');
    emit('applied', result.chapter);
    emit('close');
  } catch (error) {
    presentErrorFromCaught(error, '应用终稿失败');
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <a-modal
    :open="props.visible"
    :width="920"
    :title="`一键终稿${props.chapter ? ` · 第${props.chapter.chapterNo}章` : ''}`"
    :footer="null"
    :mask-closable="!isBusy"
    :closable="!isBusy"
    destroy-on-close
    @cancel="close"
  >
    <p class="modal-subtitle">
      一次点击，后台自动跑完「角色 → 感官 → 规则」全流程（等同分步精修 run-all，无需逐步确认）；生成后在此审核，不满意可点「换一版」。
    </p>

    <AiTaskProgressPanel :progress="aiTaskProgress" show-trace-on-error />
    <p v-if="progressLabel && step === 'running'" class="meta-line progress-line">{{ progressLabel }}</p>
    <p v-if="cachedHint" class="message message-info">{{ cachedHint }}</p>
    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>

    <section v-if="step === 'running' && streamingText" class="step-section">
      <h4 class="section-title">生成预览</h4>
      <pre class="stream-preview">{{ streamingText }}</pre>
    </section>

    <section v-if="step === 'review' && finalText" class="step-section result-preview-section">
      <div class="review-head">
        <h4 class="section-title">终稿审核</h4>
        <span
          v-if="qualityStatus"
          class="quality-badge"
          :class="[`quality-${qualityStatus}`]"
        >
          {{ qualityStatusLabel }}
        </span>
      </div>

      <section v-if="residualIssues.length && applyBlocked" class="issue-section">
        <h5 class="section-title">残留硬风险</h5>
        <ul class="issue-list">
          <li v-for="issue in residualIssues" :key="issue.id" class="issue-item">
            <div class="issue-head">
              <span class="issue-category">{{ issue.category }}</span>
              <span class="issue-strategy">{{ issue.fixStrategy }}</span>
            </div>
            <p class="issue-text">{{ issue.text }}</p>
            <p v-if="issue.context" class="issue-context">{{ issue.context }}</p>
          </li>
        </ul>
      </section>

      <div v-if="applyBlocked" class="manual-edit-section">
        <p class="field-label">手动修订终稿</p>
        <p class="blocked-hint editable-hint">
          对照上方风险项修订正文后应用；若保持原稿不变，点击「应用终稿」时将提示确认强制应用。
        </p>
        <textarea
          v-model="editableFinalText"
          class="final-editor"
          rows="18"
          :disabled="isBusy"
        />
      </div>

      <template v-else>
        <div v-if="hasResultDiff" class="diff-summary">
          <span class="diff-badge diff-added">+{{ diffAddedCount }} 新增</span>
          <span class="diff-badge diff-removed">-{{ diffRemovedCount }} 删除</span>
          <span class="diff-badge diff-modified">~{{ diffModifiedCount }} 修改</span>
        </div>

        <div v-if="hasResultDiff" class="preview-toggle">
          <button
            type="button"
            class="preview-toggle-btn"
            :class="{ active: previewMode === 'final' }"
            @click="previewMode = 'final'"
          >
            终稿正文
          </button>
          <button
            type="button"
            class="preview-toggle-btn"
            :class="{ active: previewMode === 'diff' }"
            @click="previewMode = 'diff'"
          >
            对比视图
          </button>
        </div>

        <pre
          v-if="previewMode === 'final' || !hasResultDiff"
          class="final-preview final-preview-done"
        >{{ finalText }}</pre>
        <div v-else class="draft-compare-grid">
          <div class="compare-pane">
            <p class="field-label">原文（快照）</p>
            <div class="scroll-pane full-text-pane">
              <template v-for="(seg, idx) in inlineDiff.originalSegments" :key="'o-' + idx">
                <span :class="{ 'diff-removed-text': seg.removed }">{{ seg.text }}</span>
              </template>
            </div>
          </div>
          <div class="compare-pane">
            <p class="field-label">终稿正文</p>
            <div class="scroll-pane full-text-pane">
              <template v-for="(seg, idx) in inlineDiff.draftSegments" :key="'d-' + idx">
                <span :class="{ 'diff-added-text': seg.added }">{{ seg.text }}</span>
              </template>
            </div>
          </div>
        </div>
      </template>

      <section v-if="residualIssues.length && !applyBlocked" class="issue-section">
        <h5 class="section-title">残留硬风险</h5>
        <ul class="issue-list">
          <li v-for="issue in residualIssues" :key="issue.id" class="issue-item">
            <div class="issue-head">
              <span class="issue-category">{{ issue.category }}</span>
              <span class="issue-strategy">{{ issue.fixStrategy }}</span>
            </div>
            <p class="issue-text">{{ issue.text }}</p>
            <p v-if="issue.context" class="issue-context">{{ issue.context }}</p>
          </li>
        </ul>
      </section>
    </section>

    <div v-if="step === 'review'" class="step-actions">
      <button class="secondary-button" type="button" :disabled="isBusy" @click="close">取消</button>
      <button
        class="secondary-button"
        type="button"
        :disabled="isBusy"
        @click="handleRegenerate"
      >
        {{ running ? '生成中…' : '换一版' }}
      </button>
      <button
        v-if="applyBlocked"
        class="primary-button"
        type="button"
        :disabled="isBusy || !editableFinalText.trim()"
        @click="handleApplyWithOverride"
      >
        {{ applying ? '应用中…' : '应用终稿' }}
      </button>
      <button
        v-else
        class="primary-button"
        type="button"
        :disabled="isBusy || !finalText"
        @click="handleApply"
      >
        {{ applying ? '应用中…' : '应用到章节' }}
      </button>
    </div>
  </a-modal>
</template>

<style scoped>
.modal-subtitle {
  margin: 0 0 1rem;
  color: #6b7280;
  font-size: 0.85rem;
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

.message-info {
  background: #eff6ff;
  color: #1d4ed8;
}

.meta-line {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  color: #6b7280;
}

.progress-line {
  color: #374151;
}

.step-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-title {
  margin: 0;
  font-size: 0.95rem;
  color: #111827;
}

.review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.quality-badge {
  font-size: 0.78rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-weight: 600;
}

.quality-passed {
  background: #ecfdf5;
  color: #047857;
}

.quality-passed_with_warnings {
  background: #fffbeb;
  color: #b45309;
}

.quality-blocked {
  background: #fef2f2;
  color: #b91c1c;
}

.stream-preview,
.final-preview {
  margin: 0;
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
  font-size: 0.88rem;
  line-height: 1.65;
}

.diff-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.diff-badge {
  font-size: 0.78rem;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
}

.diff-added {
  background: #ecfdf5;
  color: #047857;
}

.diff-removed {
  background: #fef2f2;
  color: #b91c1c;
}

.diff-modified {
  background: #eff6ff;
  color: #1d4ed8;
}

.preview-toggle {
  display: flex;
  gap: 0.5rem;
}

.preview-toggle-btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.82rem;
  cursor: pointer;
}

.preview-toggle-btn.active {
  border-color: #111827;
  background: #111827;
  color: #fff;
}

.draft-compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.compare-pane {
  min-width: 0;
}

.field-label {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  color: #6b7280;
}

.scroll-pane {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
  padding: 0.65rem;
  max-height: 280px;
  overflow: auto;
  font-size: 0.86rem;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.diff-removed-text {
  background: #fee2e2;
  text-decoration: line-through;
}

.diff-added-text {
  background: #dcfce7;
}

.issue-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.issue-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.issue-item {
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid #e5e7eb;
}

.issue-item:last-child {
  border-bottom: none;
}

.issue-head {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
  font-size: 0.75rem;
}

.issue-category {
  font-weight: 600;
  color: #111827;
}

.issue-strategy {
  color: #6b7280;
}

.issue-text {
  margin: 0;
  font-size: 0.85rem;
  color: #374151;
}

.issue-context {
  margin: 0.35rem 0 0;
  font-size: 0.78rem;
  color: #6b7280;
}

.blocked-hint {
  margin: 0;
  font-size: 0.82rem;
  color: #b91c1c;
}

.editable-hint {
  margin-bottom: 0.5rem;
}

.manual-edit-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.final-editor {
  width: 100%;
  min-height: 320px;
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  font-size: 0.88rem;
  line-height: 1.65;
  resize: vertical;
  font-family: inherit;
}

.final-editor:disabled {
  background: #f3f4f6;
  cursor: not-allowed;
}

.step-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1rem;
}
</style>
