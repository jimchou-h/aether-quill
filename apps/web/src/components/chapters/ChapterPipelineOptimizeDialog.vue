<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  apiClient,
  formatPipelineStageLabel,
  isTerminalChapterPipelineRunEnd,
  type ChapterItem,
  type ChapterPipelineConfig,
  type ChapterPipelineRunModule,
  type ChapterPipelineSessionView,
  type PipelineOutlineItem,
  type PipelineRuleIssue,
} from '../../services/api';
import {
  presentErrorFromCaught,
  presentSuccess,
} from '../../utils/pageFeedback';
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

type PipelineStep =
  | 'ready'
  | 'character'
  | 'sensory-outline'
  | 'sensory-rewrite'
  | 'rules'
  | 'homogenization'
  | 'done';

interface PipelineStepItem {
  key: PipelineStep | 'sensory';
  label: string;
}

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
const config = ref<ChapterPipelineConfig | null>(null);
const step = ref<PipelineStep>('ready');
const running = ref(false);
const applying = ref(false);
const errorMessage = ref('');
const streamingText = ref('');
const progressLabel = ref('');
const aiTaskProgress = createAiTaskProgressState();
const chapterUpdatedAtSnapshot = ref('');
const outlineRequired = ref<PipelineOutlineItem[]>([]);
const outlineSuggested = ref<PipelineOutlineItem[]>([]);
const ruleIssues = ref<PipelineRuleIssue[]>([]);

const isBusy = computed(() => running.value || applying.value);

const originalText = computed(() => session.value?.versions.original ?? props.chapter?.content ?? '');

const currentVersionText = computed(() => {
  const versions = session.value?.versions;
  if (!versions) {
    return '';
  }
  return (
    versions.final ??
    versions.afterRules ??
    versions.afterSensory ??
    versions.afterCharacter ??
    versions.original ??
    ''
  );
});

const diffLines = computed(() => {
  if (!originalText.value || !currentVersionText.value) {
    return [];
  }
  return buildChapterDiffLines(originalText.value, currentVersionText.value);
});

const diffAddedCount = computed(() => diffLines.value.filter((r) => r.type === 'added').length);
const diffRemovedCount = computed(() => diffLines.value.filter((r) => r.type === 'removed').length);
const diffModifiedCount = computed(() => diffLines.value.filter((r) => r.type === 'modified').length);

const inlineDiff = computed(() =>
  buildInlineDiffViews(originalText.value, currentVersionText.value)
);

const hasResultDiff = computed(
  () => Boolean(originalText.value && currentVersionText.value && diffLines.value.length > 0)
);

const showResultPreview = computed(
  () => Boolean(currentVersionText.value && !running.value && step.value !== 'ready')
);

const previewMode = ref<'final' | 'diff'>('diff');

const pipelineIncomplete = computed(() => {
  if (!session.value || step.value === 'done' || step.value === 'ready') {
    return false;
  }
  const versions = session.value.versions;
  const modules = config.value?.pipelineEnabledModules ?? [1, 2, 3];
  if (modules.includes(4) && config.value?.pipelineHomogenizationEnabled) {
    return !versions.final?.trim();
  }
  if (modules.includes(3)) {
    return !versions.afterRules?.trim();
  }
  if (modules.includes(2)) {
    return !versions.afterSensory?.trim();
  }
  if (modules.includes(1)) {
    return !versions.afterCharacter?.trim();
  }
  return false;
});

const pipelineSteps = computed<PipelineStepItem[]>(() => {
  const modules = config.value?.pipelineEnabledModules ?? [1, 2, 3];
  const steps: PipelineStepItem[] = [{ key: 'ready', label: '准备' }];
  if (modules.includes(1)) {
    steps.push({ key: 'character', label: '角色调整' });
  }
  if (modules.includes(2)) {
    steps.push({ key: 'sensory', label: '感官优化' });
  }
  if (modules.includes(3)) {
    steps.push({ key: 'rules', label: '规则检查' });
  }
  if (modules.includes(4) && config.value?.pipelineHomogenizationEnabled) {
    steps.push({ key: 'homogenization', label: '同质化' });
  }
  steps.push({ key: 'done', label: '应用' });
  return steps;
});

const activeStepIndex = computed(() => {
  const map: Record<PipelineStep, number> = {
    ready: 0,
    character: 1,
    'sensory-outline': 2,
    'sensory-rewrite': 2,
    rules: 3,
    homogenization: 4,
    done: pipelineSteps.value.length - 1,
  };
  const idx = map[step.value];
  if (step.value === 'character') {
    return pipelineSteps.value.findIndex((s) => s.key === 'character') || 0;
  }
  if (step.value === 'sensory-outline' || step.value === 'sensory-rewrite') {
    return Math.max(0, pipelineSteps.value.findIndex((s) => s.key === 'sensory'));
  }
  if (step.value === 'rules') {
    return Math.max(0, pipelineSteps.value.findIndex((s) => s.key === 'rules'));
  }
  if (step.value === 'homogenization') {
    return Math.max(0, pipelineSteps.value.findIndex((s) => s.key === 'homogenization'));
  }
  return idx >= 0 ? idx : 0;
});

function isStepDone(index: number) {
  return index < activeStepIndex.value;
}

function isStepActive(index: number) {
  return index === activeStepIndex.value;
}

function resetState() {
  sessionId.value = '';
  session.value = null;
  config.value = null;
  step.value = 'ready';
  running.value = false;
  applying.value = false;
  errorMessage.value = '';
  streamingText.value = '';
  progressLabel.value = '';
  outlineRequired.value = [];
  outlineSuggested.value = [];
  ruleIssues.value = [];
  previewMode.value = 'diff';
  resetAiTaskProgress(aiTaskProgress);
}

watch(
  () => step.value,
  (nextStep) => {
    if (nextStep === 'done') {
      previewMode.value = 'diff';
    }
  }
);

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
  if (session.value.sensoryOutline) {
    outlineRequired.value = [...session.value.sensoryOutline.required];
    outlineSuggested.value = [...session.value.sensoryOutline.suggested];
  }
  if (session.value.ruleIssues) {
    ruleIssues.value = [...session.value.ruleIssues];
  }
}

async function handleStart(runAll = false) {
  if (!props.chapter?.content?.trim()) {
    errorMessage.value = '章节正文为空';
    return;
  }
  running.value = true;
  errorMessage.value = '';
  try {
    const result = await apiClient.startChapterPipeline(
      props.projectId,
      props.chapter.chapterNo
    );
    sessionId.value = result.sessionId;
    config.value = result.config;
    await refreshSession();
    step.value = 'character';
    if (runAll) {
      await runModule('run-all');
    } else {
      await runModule('character');
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '启动失败';
    presentErrorFromCaught(error, '启动分步精修失败');
  } finally {
    running.value = false;
  }
}

async function runModule(module: ChapterPipelineRunModule) {
  if (!props.chapter || !sessionId.value) {
    return;
  }
  running.value = true;
  streamingText.value = '';
  errorMessage.value = '';
  const isRunAll = module === 'run-all';
  startAiTaskProgress(aiTaskProgress, {
    taskKey: isRunAll ? 'chapter.pipeline.run-all' : 'chapter.pipeline.run',
    message: isRunAll ? '一键精修执行中…' : '分步精修执行中…',
  });

  try {
    await apiClient.runChapterPipelineModuleSSE(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      module,
      undefined,
      {
        onStart: ({ stage }) => {
          streamingText.value = '';
          progressLabel.value = formatPipelineStageLabel(stage);
        },
        onStage: ({ stage, segmentIndex, segmentTotal }) => {
          progressLabel.value = formatPipelineStageLabel(stage, segmentIndex, segmentTotal);
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: isRunAll ? 'chapter.pipeline.run-all' : 'chapter.pipeline.run',
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
          const endEvent = event as PipelineEndEvent;
          if (endEvent.gateRequired && endEvent.gate === 'sensory-outline') {
            step.value = 'sensory-outline';
            await refreshSession();
            completeAiTaskProgress(aiTaskProgress, '等待确认感官大纲');
            return;
          }
          await refreshSession();
          applyPipelineStepFromEnd(endEvent);
          if (isTerminalChapterPipelineRunEnd(module, endEvent)) {
            completeAiTaskProgress(
              aiTaskProgress,
              endEvent.currentModule === 'done' ? '一键精修完成' : '步骤完成'
            );
          } else if (isRunAll) {
            applyAiTaskProgressEvent(aiTaskProgress, {
              taskKey: 'chapter.pipeline.run-all',
              message: progressLabel.value || '继续执行后续模块…',
            });
          }
        },
        onError: (message) => {
          errorMessage.value = message;
          failAiTaskProgress(aiTaskProgress, message);
        },
      }
    );
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '执行失败';
    failAiTaskProgress(aiTaskProgress, errorMessage.value);
    presentErrorFromCaught(error, '分步精修执行失败');
  } finally {
    running.value = false;
  }
}

async function confirmSensoryOutline() {
  if (!props.chapter || !sessionId.value) {
    return;
  }
  running.value = true;
  try {
    session.value = await apiClient.patchChapterPipelineSensoryOutline(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        required: outlineRequired.value,
        suggested: outlineSuggested.value,
        confirmed: true,
      }
    );
    step.value = 'sensory-rewrite';
    await runModule('run-all');
  } catch (error) {
    presentErrorFromCaught(error, '确认大纲失败');
  } finally {
    running.value = false;
  }
}

function removeSuggestedItem(id: string) {
  outlineSuggested.value = outlineSuggested.value.filter((item) => item.id !== id);
}

async function handleApply() {
  if (!props.chapter || !sessionId.value) {
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
      }
    );
    presentSuccess('分步精修已应用');
    emit('applied', result.chapter);
    emit('close');
  } catch (error) {
    presentErrorFromCaught(error, '应用失败');
  } finally {
    applying.value = false;
  }
}

function ruleFixStrategyLabel(strategy: PipelineRuleIssue['fixStrategy']) {
  switch (strategy) {
    case 'auto':
      return '自动';
    case 'ai_segment':
      return 'AI 修段';
    default:
      return '人工';
  }
}

type PipelineEndEvent = {
  gateRequired?: boolean;
  gate?: string;
  currentModule?: number | 'done';
  sensoryOutline?: ChapterPipelineSessionView['sensoryOutline'];
  ruleIssues?: PipelineRuleIssue[];
  versionKey?: string;
  homogenizationReport?: ChapterPipelineSessionView['homogenizationReport'];
};

function applyPipelineStepFromEnd(event: PipelineEndEvent) {
  if (event.sensoryOutline && !event.sensoryOutline.userConfirmed) {
    outlineRequired.value = [...event.sensoryOutline.required];
    outlineSuggested.value = [...event.sensoryOutline.suggested];
    step.value = 'sensory-outline';
    return;
  }
  if (event.ruleIssues) {
    ruleIssues.value = [...event.ruleIssues];
  }
  if (event.currentModule === 'done' || event.versionKey === 'final') {
    step.value = 'done';
    return;
  }
  if (typeof event.currentModule === 'number') {
    if (event.currentModule >= 4) {
      step.value = 'homogenization';
      return;
    }
    if (event.currentModule >= 3) {
      step.value = 'rules';
      return;
    }
    if (event.currentModule >= 2) {
      step.value = 'sensory-rewrite';
      return;
    }
    step.value = 'character';
    return;
  }
  if (event.ruleIssues) {
    step.value = 'rules';
    return;
  }
  if (event.versionKey === 'afterRules') {
    step.value = 'rules';
    return;
  }
  if (event.versionKey === 'afterSensory') {
    step.value = 'sensory-rewrite';
    return;
  }
  if (event.versionKey === 'afterCharacter') {
    step.value = 'character';
    return;
  }
  if (event.homogenizationReport) {
    step.value = 'homogenization';
  }
}
</script>

<template>
  <a-modal
    :open="props.visible"
    :width="920"
    :title="`分步精修${props.chapter ? ` · 第${props.chapter.chapterNo}章` : ''}`"
    :footer="null"
    :mask-closable="!isBusy"
    :closable="!isBusy"
    destroy-on-close
    @cancel="close"
  >
    <p class="modal-subtitle">维度隔离四模块流水线；中间版本仅在会话内流转，应用后才写入章节正文。</p>

    <ol class="stepper">
      <li
        v-for="(item, index) in pipelineSteps"
        :key="`${item.key}-${index}`"
        :class="{ active: isStepActive(index), done: isStepDone(index) }"
      >
        <span class="stepper-no">{{ index + 1 }}</span>
        <span>{{ item.label }}</span>
      </li>
    </ol>

    <AiTaskProgressPanel :progress="aiTaskProgress" show-trace-on-error />
    <p v-if="progressLabel" class="meta-line progress-line">{{ progressLabel }}</p>
    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>

    <section v-if="step === 'ready'" class="step-section">
      <p class="intro-text">
        将按项目预设依次执行各模块。若开启大纲审核，感官优化会在生成大纲后暂停等待确认。
      </p>
      <div class="step-actions">
        <button class="secondary-button" type="button" :disabled="isBusy" @click="close">
          取消
        </button>
        <button class="secondary-button" type="button" :disabled="isBusy" @click="handleStart(true)">
          {{ running ? '执行中…' : '一键精修' }}
        </button>
        <button class="primary-button" type="button" :disabled="isBusy" @click="handleStart()">
          {{ running ? '启动中…' : '开始分步精修' }}
        </button>
      </div>
    </section>

    <section v-else-if="step === 'sensory-outline'" class="step-section">
      <h4 class="section-title">感官优化大纲</h4>
      <p class="meta-line">
        请确认必需项，可删除不需要的建议项后再进入改写。含禁用词的必需项已自动降为建议项并标注告警。
      </p>

      <div class="outline-panel">
        <div class="outline-group">
          <p class="outline-label required">必需项</p>
          <ul v-if="outlineRequired.length" class="outline-list">
            <li v-for="item in outlineRequired" :key="item.id" class="outline-item-row">
              <span>{{ item.text }}</span>
              <ul v-if="item.contentWarnings?.length" class="outline-warnings">
                <li v-for="warning in item.contentWarnings" :key="warning">{{ warning }}</li>
              </ul>
            </li>
          </ul>
          <p v-else class="empty-hint">暂无必需项</p>
        </div>
        <div class="outline-group">
          <p class="outline-label suggested">建议项</p>
          <ul v-if="outlineSuggested.length" class="outline-list">
            <li v-for="item in outlineSuggested" :key="item.id" class="outline-suggested-row">
              <div class="outline-item-body">
                <span>{{ item.text }}</span>
                <ul v-if="item.contentWarnings?.length" class="outline-warnings">
                  <li v-for="warning in item.contentWarnings" :key="warning">{{ warning }}</li>
                </ul>
              </div>
              <button type="button" class="text-button" @click="removeSuggestedItem(item.id)">
                删除
              </button>
            </li>
          </ul>
          <p v-else class="empty-hint">暂无建议项</p>
        </div>
      </div>

      <div class="step-actions">
        <button class="primary-button" type="button" :disabled="isBusy" @click="confirmSensoryOutline">
          {{ running ? '改写中…' : '确认大纲并改写' }}
        </button>
      </div>
    </section>

    <section v-else-if="step === 'rules' && ruleIssues.length" class="step-section">
      <h4 class="section-title">规则扫描清单</h4>
      <ul class="issue-list">
        <li
          v-for="issue in ruleIssues"
          :key="issue.id"
          class="issue-item"
          :class="[issue.fixStrategy, issue.fixed ? 'is-fixed' : '']"
        >
          <div class="issue-head">
            <span class="issue-category">{{ issue.category }}</span>
            <span class="issue-strategy">{{ ruleFixStrategyLabel(issue.fixStrategy) }}</span>
            <span v-if="issue.fixed" class="issue-fixed-badge">已修复</span>
          </div>
          <p class="issue-text">{{ issue.text }}</p>
          <p v-if="issue.context" class="issue-context">{{ issue.context }}</p>
        </li>
      </ul>
    </section>

    <section v-if="streamingText && running" class="step-section">
      <h4 class="section-title">生成预览</h4>
      <pre class="stream-preview">{{ streamingText }}</pre>
    </section>

    <section v-if="showResultPreview" class="step-section result-preview-section">
      <h4 class="section-title">{{ step === 'done' ? '精修结果' : '与原文对比' }}</h4>
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
          最终正文
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
        class="final-preview"
        :class="{ 'final-preview-done': step === 'done' }"
      >{{ currentVersionText }}</pre>
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
          <p class="field-label">精修正文</p>
          <div class="scroll-pane full-text-pane">
            <template v-for="(seg, idx) in inlineDiff.draftSegments" :key="'d-' + idx">
              <span :class="{ 'diff-added-text': seg.added }">{{ seg.text }}</span>
            </template>
          </div>
        </div>
      </div>
      <p v-if="hasResultDiff" class="meta-line compare-hint">
        红色删除线 = 原文有而精修删去；绿色 = 精修新增。两侧均为完整正文，不会漏段。
      </p>
    </section>

    <div
      v-if="pipelineIncomplete && !running && step !== 'ready' && step !== 'sensory-outline'"
      class="step-actions"
    >
      <button class="primary-button" type="button" :disabled="isBusy" @click="runModule('run-all')">
        继续执行后续模块
      </button>
    </div>

    <div v-if="step === 'done'" class="step-actions">
      <button class="secondary-button" type="button" :disabled="isBusy" @click="close">取消</button>
      <button class="primary-button" type="button" :disabled="applying" @click="handleApply">
        {{ applying ? '应用中…' : '应用最终版' }}
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

.stepper {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.5rem;
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
  flex-shrink: 0;
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

.intro-text {
  margin: 0;
  font-size: 0.9rem;
  color: #4b5563;
  line-height: 1.55;
}

.outline-panel {
  display: grid;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.outline-label {
  margin: 0 0 0.45rem;
  font-size: 0.8rem;
  font-weight: 600;
}

.outline-label.required {
  color: #b45309;
}

.outline-label.suggested {
  color: #1d4ed8;
}

.outline-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.88rem;
  color: #374151;
  line-height: 1.55;
}

.outline-item-row {
  margin-bottom: 0.45rem;
}

.outline-item-body {
  flex: 1;
  min-width: 0;
}

.outline-warnings {
  margin: 0.35rem 0 0;
  padding-left: 1rem;
  list-style: disc;
  font-size: 0.78rem;
  color: #b45309;
}

.outline-suggested-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}

.empty-hint {
  margin: 0;
  font-size: 0.82rem;
  color: #9ca3af;
}

.text-button {
  border: none;
  background: transparent;
  color: #2563eb;
  font-size: 0.8rem;
  cursor: pointer;
  flex-shrink: 0;
}

.text-button:hover {
  text-decoration: underline;
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
  border-bottom: 1px solid #f3f4f6;
  background: #fff;
}

.issue-item:last-child {
  border-bottom: none;
}

.issue-item.manual {
  border-left: 3px solid #ef4444;
}

.issue-item.ai_segment {
  border-left: 3px solid #f59e0b;
}

.issue-item.auto {
  border-left: 3px solid #22c55e;
}

.issue-item.is-fixed {
  opacity: 0.72;
  background: #f9fafb;
}

.issue-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  margin-bottom: 0.25rem;
}

.issue-category {
  font-size: 0.72rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.issue-strategy {
  font-size: 0.72rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: #f3f4f6;
  color: #4b5563;
}

.issue-fixed-badge {
  font-size: 0.72rem;
  color: #059669;
}

.issue-text {
  margin: 0;
  font-size: 0.88rem;
  color: #111827;
}

.issue-context {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: #9ca3af;
}

.stream-preview {
  margin: 0;
  max-height: 200px;
  overflow: auto;
  padding: 0.65rem 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
  font-size: 0.82rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.diff-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.preview-toggle {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}

.preview-toggle-btn {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #4b5563;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.preview-toggle-btn.active {
  border-color: #111827;
  background: #111827;
  color: #fff;
}

.final-preview {
  margin: 0;
  max-height: 280px;
  overflow: auto;
  padding: 0.75rem 0.85rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
  font-size: 0.88rem;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.final-preview-done {
  max-height: 420px;
}

.result-preview-section {
  margin-top: 0.25rem;
}

.field-label {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: #6b7280;
}

.draft-compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.compare-pane {
  min-width: 0;
}

.scroll-pane {
  max-height: 360px;
  overflow: auto;
  padding: 0.65rem 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
  font-size: 0.82rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.full-text-pane {
  margin: 0;
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}

.compare-hint {
  margin-top: 0.35rem;
}

.diff-line {
  min-height: 1.6em;
}

.line-added,
.line-removed,
.line-modified,
.line-modified-original {
  padding-left: 0.65rem;
  border-left: 3px solid transparent;
  margin-left: -3px;
}

.line-added {
  background: #dcfce7;
  border-left-color: #22c55e;
}

.line-removed {
  background: #fee2e2;
  border-left-color: #ef4444;
}

.line-modified {
  background: #fef9c3;
  border-left-color: #eab308;
}

.line-modified-original {
  background: #fee2e2;
  border-left-color: #ef4444;
}

.diff-removed-text {
  text-decoration: line-through;
  color: #dc2626;
  opacity: 0.9;
}

.diff-added-text {
  color: #166534;
  font-weight: 500;
}

.diff-badge {
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.diff-added {
  background: #dcfce7;
  color: #166534;
}

.diff-removed {
  background: #fee2e2;
  color: #991b1b;
}

.diff-modified {
  background: #fef9c3;
  color: #854d0e;
}

.step-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
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
