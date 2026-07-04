<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  apiClient,
  formatPipelineStageLabel,
  type ChapterItem,
  type ComplianceCheckSessionView,
  type FinalPolishQualityStatus,
  type PipelineOutlineItem,
  type PipelineRuleIssue,
} from '../../services/api';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';
import { confirmAction } from '../../composables/useAppConfirm';
import { isPipelineOutlineEmpty } from '../../utils/pipelineOutline';
import {
  applyAiTaskProgressEvent,
  completeAiTaskProgress,
  createAiTaskProgressState,
  failAiTaskProgress,
  resetAiTaskProgress,
  startAiTaskProgress,
} from '../../composables/useAiTaskProgress';
import { useChapterSseTask } from '../../composables/useChapterSseTask';
import AiTaskProgressPanel from '../common/AiTaskProgressPanel.vue';
import MarkdownContent from '../common/MarkdownContent.vue';
import SseInterruptButton from '../common/SseInterruptButton.vue';
import PipelineOutlineEditor from './PipelineOutlineEditor.vue';
import OutlineReviewLayout from './OutlineReviewLayout.vue';
import { buildChapterDiffLines, buildInlineDiffViews } from '../../utils/chapterOptimizeDiff';

type DialogStep = 'ready' | 'outline' | 'rewriting' | 'review';

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
const session = ref<ComplianceCheckSessionView | null>(null);
const step = ref<DialogStep>('ready');
const running = ref(false);
const applying = ref(false);
const errorMessage = ref('');
const streamingText = ref('');
const aiTaskProgress = createAiTaskProgressState();
const { interruptStream, beginStream, handleStreamError, endStream } =
  useChapterSseTask(aiTaskProgress);
const chapterUpdatedAtSnapshot = ref('');
const outlineRequired = ref<PipelineOutlineItem[]>([]);
const outlineSuggested = ref<PipelineOutlineItem[]>([]);
const outlineRevisionRound = ref(0);
const previewMode = ref<'final' | 'diff'>('diff');
const editableFinalText = ref('');

const isBusy = computed(() => running.value || applying.value);

const originalText = computed(() => session.value?.sourceText ?? props.chapter?.content ?? '');

const finalText = computed(() => editableFinalText.value || session.value?.versionText || '');

const qualityStatus = computed<FinalPolishQualityStatus | null>(
  () => session.value?.qualityStatus ?? null
);

const residualIssues = computed<PipelineRuleIssue[]>(() => session.value?.residualIssues ?? []);

const preScanIssues = computed<PipelineRuleIssue[]>(() => session.value?.preScanIssues ?? []);

const selectedPersonaNames = computed(() => session.value?.selectedPersonaNames ?? []);

const diffLines = computed(() => {
  if (!originalText.value || !finalText.value) {
    return [];
  }
  return buildChapterDiffLines(originalText.value, finalText.value);
});

const inlineDiff = computed(() => buildInlineDiffViews(originalText.value, finalText.value));

const applyBlocked = computed(() => qualityStatus.value === 'blocked');

const modalWidth = computed(() => (step.value === 'outline' ? 1080 : 920));

const qualityStatusLabel = computed(() => {
  switch (qualityStatus.value) {
    case 'passed':
      return '硬规则复扫已通过';
    case 'passed_with_warnings':
      return '已通过，仍有少量风险需留意';
    case 'blocked':
      return '存在阻断性硬风险，需修订或强制应用';
    default:
      return '';
  }
});

function resetState() {
  sessionId.value = '';
  session.value = null;
  step.value = 'ready';
  running.value = false;
  applying.value = false;
  errorMessage.value = '';
  streamingText.value = '';
  outlineRequired.value = [];
  outlineSuggested.value = [];
  outlineRevisionRound.value = 0;
  editableFinalText.value = '';
  resetAiTaskProgress(aiTaskProgress);
}

watch(
  () => props.visible,
  (visible) => {
    if (visible && props.chapter) {
      resetState();
      chapterUpdatedAtSnapshot.value = props.chapter.updatedAt;
    }
    if (!visible) {
      resetState();
    }
  }
);

function syncOutlineFromSession() {
  const outline = session.value?.outline;
  outlineRequired.value = outline?.required ? [...outline.required] : [];
  outlineSuggested.value = outline?.suggested ? [...outline.suggested] : [];
  outlineRevisionRound.value = outline?.revisionRound ?? 0;
}

async function runCompliancePhase(
  phase: 'pre-scan' | 'outline' | 'rewrite',
  progressMessage: string,
  signal: AbortSignal,
  onEnd?: () => void | Promise<void>
) {
  if (!props.chapter || !sessionId.value) {
    return;
  }
  startAiTaskProgress(aiTaskProgress, {
    taskKey: `compliance-check-${phase}`,
    message: progressMessage,
  });
  await apiClient.runComplianceCheckPhaseSSE(
    props.projectId,
    props.chapter.chapterNo,
    sessionId.value,
    phase,
    {
      onStart: (event) => {
        applyAiTaskProgressEvent(aiTaskProgress, event);
      },
      onStage: (event) => {
        applyAiTaskProgressEvent(aiTaskProgress, {
          ...event,
          message: formatPipelineStageLabel(event.stage, event.segmentIndex, event.segmentTotal),
        });
      },
      onEnd: async () => {
        const refreshed = await apiClient.getComplianceCheckSession(
          props.projectId,
          props.chapter!.chapterNo
        );
        session.value = refreshed;
        if (onEnd) {
          await onEnd();
        }
      },
      onError: (message) => {
        errorMessage.value = message;
        failAiTaskProgress(aiTaskProgress, message);
      },
    },
    { signal }
  );
}

async function startComplianceFlow() {
  if (!props.chapter || running.value) {
    return;
  }
  running.value = true;
  errorMessage.value = '';
  streamingText.value = '';

  try {
    const started = await apiClient.startComplianceCheck(props.projectId, props.chapter.chapterNo);
    sessionId.value = started.sessionId;
    const signal = beginStream();

    await runCompliancePhase('pre-scan', '硬规则预扫描…', signal, async () => {
      completeAiTaskProgress(aiTaskProgress, '预扫完成，生成合规大纲…');
    });

    await runCompliancePhase('outline', '生成合规大纲…', signal, async () => {
      syncOutlineFromSession();
      step.value = 'outline';
      completeAiTaskProgress(aiTaskProgress, '合规大纲已生成，请确认');
    });
  } catch (error) {
    if (handleStreamError(error)) {
      return;
    }
    errorMessage.value = error instanceof Error ? error.message : '合规检验失败';
    failAiTaskProgress(aiTaskProgress, errorMessage.value);
    presentErrorFromCaught(error, '合规检验失败');
  } finally {
    running.value = false;
    endStream();
  }
}

async function confirmOutline() {
  if (!props.chapter || !sessionId.value || running.value) {
    return;
  }
  if (isPipelineOutlineEmpty(outlineRequired.value, outlineSuggested.value)) {
    const confirmed = await confirmAction({
      title: '确认空大纲',
      content: '当前无修改项，确认后将保留原文并继续',
      okText: '确认并继续',
    });
    if (!confirmed) {
      return;
    }
  }
  running.value = true;
  errorMessage.value = '';
  try {
    session.value = await apiClient.patchComplianceOutline(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        required: outlineRequired.value,
        suggested: outlineSuggested.value,
        confirmed: true,
      }
    );
    await runRewrite();
  } catch (error) {
    presentErrorFromCaught(error, '确认大纲失败');
  } finally {
    running.value = false;
  }
}

async function runRewrite() {
  if (!props.chapter || !sessionId.value) {
    return;
  }
  step.value = 'rewriting';
  streamingText.value = '';
  startAiTaskProgress(aiTaskProgress, {
    taskKey: 'compliance-rewrite',
    message: '合规改写中…',
  });
  const signal = beginStream();

  try {
    await apiClient.runComplianceCheckPhaseSSE(
    props.projectId,
    props.chapter.chapterNo,
    sessionId.value,
    'rewrite',
    {
      onStart: (event) => {
        applyAiTaskProgressEvent(aiTaskProgress, event);
      },
      onStage: (event) => {
        applyAiTaskProgressEvent(aiTaskProgress, {
          ...event,
          message: formatPipelineStageLabel(event.stage, event.segmentIndex, event.segmentTotal),
        });
      },
      onContent: (piece) => {
        streamingText.value += piece;
      },
      onEnd: async (event) => {
        const endEvent = event as { outlinePassthrough?: boolean };
        const refreshed = await apiClient.getComplianceCheckSession(
          props.projectId,
          props.chapter!.chapterNo
        );
        session.value = refreshed;
        editableFinalText.value = refreshed.versionText ?? streamingText.value;
        step.value = 'review';
        if (endEvent.outlinePassthrough) {
          presentSuccess('无大纲修改项，已保留原文');
        }
        completeAiTaskProgress(aiTaskProgress, '合规改写完成，请审核');
      },
      onError: (message) => {
        errorMessage.value = message;
        failAiTaskProgress(aiTaskProgress, message);
      },
    },
    { signal }
    );
  } catch (error) {
    if (handleStreamError(error)) {
      step.value = 'outline';
      return;
    }
    throw error;
  } finally {
    endStream();
  }
}

async function handleRecheckOutline() {
  if (!props.chapter || !sessionId.value || running.value) {
    return;
  }
  running.value = true;
  try {
    const result = await apiClient.reviseComplianceOutline(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        mode: 'recheck',
        currentOutline: {
          required: outlineRequired.value,
          suggested: outlineSuggested.value,
        },
      }
    );
    outlineRequired.value = result.required;
    outlineSuggested.value = result.suggested;
    outlineRevisionRound.value = result.revisionRound;
  } catch (error) {
    presentErrorFromCaught(error, 'AI 重新检查失败');
  } finally {
    running.value = false;
  }
}

async function handleReviseOutline(feedback: string) {
  if (!props.chapter || !sessionId.value || running.value) {
    return;
  }
  running.value = true;
  try {
    const result = await apiClient.reviseComplianceOutline(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        mode: 'revise',
        userFeedback: feedback,
        currentOutline: {
          required: outlineRequired.value,
          suggested: outlineSuggested.value,
        },
      }
    );
    outlineRequired.value = result.required;
    outlineSuggested.value = result.suggested;
    outlineRevisionRound.value = result.revisionRound;
  } catch (error) {
    presentErrorFromCaught(error, 'AI 修订大纲失败');
  } finally {
    running.value = false;
  }
}

async function applyResult() {
  if (!props.chapter || !sessionId.value || applying.value) {
    return;
  }

  if (applyBlocked.value) {
    const ok = await confirmAction({
      title: '强制应用合规正文',
      content: '硬规则复扫仍有阻断项，确定仍要应用到章节吗？',
      okText: '强制应用',
      danger: true,
    });
    if (!ok) {
      return;
    }
  }

  applying.value = true;
  try {
    const { chapter } = await apiClient.applyComplianceCheck(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        expectedChapterUpdatedAt: chapterUpdatedAtSnapshot.value,
        preserveSummary: true,
        draftTextOverride: editableFinalText.value || undefined,
        forceApply: applyBlocked.value,
      }
    );
    presentSuccess('合规正文已应用到章节');
    emit('applied', chapter);
    emit('close');
  } catch (error) {
    presentErrorFromCaught(error, '应用失败');
  } finally {
    applying.value = false;
  }
}

function handleClose() {
  if (running.value) {
    interruptStream();
    running.value = false;
  }
  if (applying.value) {
    return;
  }
  emit('close');
}
</script>

<template>
  <a-modal
    :open="props.visible"
    :width="modalWidth"
    :title="`终稿合规检验${props.chapter ? ` · 第${props.chapter.chapterNo}章` : ''}`"
    :footer="null"
    :mask-closable="true"
    :closable="true"
    destroy-on-close
    @cancel="handleClose"
  >
    <p class="modal-subtitle">
      发布前硬规则专检：预扫描 → 合规大纲 → 改写 → 复扫与残留修复。人物卡复用本章创作精修检索预览的选角（未精修过则用全部已发布人物）。
    </p>
    <p v-if="selectedPersonaNames.length" class="meta-line">
      已选角色：{{ selectedPersonaNames.join('、') }}
    </p>

    <div v-if="running" class="stream-actions">
      <SseInterruptButton @interrupt="() => { interruptStream(); running = false; }" />
    </div>
    <AiTaskProgressPanel :progress="aiTaskProgress" show-trace-on-error />
    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>

    <section v-if="step === 'ready'" class="step-section">
      <p class="intro-text">
        将先对正文做硬规则预扫描，再生成合规问题大纲；确认后改正文并完成复扫与 semi 残留修复。
      </p>
      <p v-if="!selectedPersonaNames.length" class="field-hint">
        人物卡将复用本章最近一次创作精修检索预览的选角；启动后显示在下方。未精修过则使用全部已发布人物。
      </p>
      <div class="step-actions">
        <button type="button" class="primary-button" :disabled="isBusy" @click="startComplianceFlow">
          {{ running ? '启动中…' : '开始合规检验' }}
        </button>
      </div>
    </section>

    <section v-else-if="step === 'outline'" class="step-section">
      <OutlineReviewLayout :reference-text="originalText" reference-label="本章正文">
        <section v-if="preScanIssues.length" class="issue-section pre-scan-section">
          <h5 class="section-title">硬规则预扫命中（{{ preScanIssues.length }}）</h5>
          <p class="field-hint">以下问题已注入合规大纲生成；对照右侧正文审阅大纲，确认后改写。</p>
          <ul class="issue-list">
            <li v-for="issue in preScanIssues.slice(0, 12)" :key="issue.id" class="issue-item">
              <div class="issue-head">
                <span class="issue-category">{{ issue.category }}</span>
              </div>
              <p class="issue-text">{{ issue.text }}</p>
              <p v-if="issue.context" class="issue-context">{{ issue.context }}</p>
            </li>
          </ul>
        </section>
        <PipelineOutlineEditor
          title="合规修改大纲"
          hint="必须项须落实后再进入改写；可在设置页维护「终稿合规 · 大纲/改写」任务 Prompt。"
          :required="outlineRequired"
          :suggested="outlineSuggested"
          :busy="isBusy"
          :revision-round="outlineRevisionRound"
          :embed-reference="false"
          @update:required="outlineRequired = $event"
          @update:suggested="outlineSuggested = $event"
          @recheck="handleRecheckOutline"
          @revise="handleReviseOutline"
          @confirm="confirmOutline"
        />
      </OutlineReviewLayout>
    </section>

    <section v-else-if="step === 'rewriting'" class="step-section">
      <h4 class="section-title">合规改写预览</h4>
      <div class="stream-preview markdown-pane">
        <MarkdownContent :source="streamingText || '等待输出…'" :throttle-ms="200" />
      </div>
    </section>

    <section v-else-if="step === 'review'" class="step-section result-preview-section">
      <div class="review-head">
        <h4 class="section-title">合规审核</h4>
        <span
          v-if="qualityStatus"
          class="quality-badge"
          :class="[`quality-${qualityStatus}`]"
        >
          {{ qualityStatusLabel }}
        </span>
      </div>

      <section v-if="residualIssues.length" class="issue-section">
        <h5 class="section-title">残留硬规则命中（{{ residualIssues.length }}）</h5>
        <ul class="issue-list">
          <li v-for="issue in residualIssues.slice(0, 12)" :key="issue.id" class="issue-item">
            <div class="issue-head">
              <span class="issue-category">{{ issue.category }}</span>
            </div>
            <p class="issue-text">{{ issue.text }}</p>
          </li>
        </ul>
      </section>

      <div class="preview-toggle">
        <button
          type="button"
          class="preview-toggle-btn"
          :class="{ active: previewMode === 'diff' }"
          @click="previewMode = 'diff'"
        >
          差异对比
        </button>
        <button
          type="button"
          class="preview-toggle-btn"
          :class="{ active: previewMode === 'final' }"
          @click="previewMode = 'final'"
        >
          合规正文
        </button>
      </div>

      <div v-if="previewMode === 'diff'" class="draft-compare-grid">
        <div class="compare-pane">
          <p class="field-label">原文</p>
          <div class="scroll-pane">
            <template v-for="(seg, idx) in inlineDiff.originalSegments" :key="'o-' + idx">
              <span :class="{ 'diff-removed-text': seg.removed }">{{ seg.text }}</span>
            </template>
          </div>
        </div>
        <div class="compare-pane">
          <p class="field-label">合规正文</p>
          <div class="scroll-pane">
            <template v-for="(seg, idx) in inlineDiff.draftSegments" :key="'d-' + idx">
              <span :class="{ 'diff-added-text': seg.added }">{{ seg.text }}</span>
            </template>
          </div>
        </div>
      </div>
      <div v-else class="manual-edit-section">
        <p class="field-label">可微调后应用</p>
        <textarea
          v-model="editableFinalText"
          class="final-editor"
          rows="16"
          :disabled="isBusy"
        />
      </div>

      <div class="step-actions">
        <button type="button" class="secondary-button" :disabled="isBusy" @click="emit('close')">
          取消
        </button>
        <button type="button" class="primary-button" :disabled="applying" @click="applyResult">
          {{ applying ? '应用中…' : applyBlocked ? '强制应用' : '应用合规正文' }}
        </button>
      </div>
    </section>
  </a-modal>
</template>

<style scoped>
.modal-subtitle {
  margin: 0 0 1rem;
  color: #6b7280;
  font-size: 0.85rem;
}

.meta-line {
  margin: -0.5rem 0 0.75rem;
  font-size: 0.8rem;
  color: #6b7280;
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
  gap: 0.75rem;
}

.intro-text {
  margin: 0;
  font-size: 0.88rem;
  color: #374151;
  line-height: 1.6;
}

.field-hint {
  margin: 0;
  font-size: 0.8rem;
  color: #6b7280;
  line-height: 1.5;
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

.stream-preview {
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

.issue-text {
  margin: 0;
  font-size: 0.85rem;
  color: #374151;
}

.issue-context {
  margin: 0.35rem 0 0;
  font-size: 0.78rem;
  color: #6b7280;
  white-space: pre-wrap;
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

.manual-edit-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.final-editor {
  width: 100%;
  min-height: 280px;
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
  margin-top: 0.5rem;
}
</style>
