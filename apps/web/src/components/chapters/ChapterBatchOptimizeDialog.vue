<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  apiClient,
  DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE,
  formatChapterOptimizeStageLabel,
  resolveChapterOptimizeStrategyLabel,
  type ChapterItem,
  type ChapterOptimizationBasis,
  type ChapterOptimizationPlanResult,
  type ChapterOptimizeSegmentRecovery,
} from '../../services/api';
import {
  presentError,
  presentErrorFromCaught,
  presentInfo,
  presentSuccess,
} from '../../utils/pageFeedback';
import { buildChapterDiffLines } from '../../utils/chapterOptimizeDiff';

type Phase = 'instruction' | 'workspace';
type BatchItemStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'applied'
  | 'apply_failed'
  | 'error';

interface BatchOptimizeItem {
  chapterNo: number;
  title: string;
  originalContent: string;
  expectedChapterUpdatedAt: string;
  planText: string;
  planId?: string;
  planBasis: ChapterOptimizationBasis | null;
  draftText: string;
  draftTraceId: string;
  status: BatchItemStatus;
  errorMessage: string;
  generatingPlan: boolean;
  generatingDraft: boolean;
  applying: boolean;
  strategyLabel: string;
  progressLabel: string;
  segmentDiagnoses: string[];
  planSegmentRecovery: ChapterOptimizeSegmentRecovery | null;
}

const props = defineProps<{
  visible: boolean;
  projectId: string;
  chapters: ChapterItem[];
}>();

const emit = defineEmits<{
  close: [];
  applied: [];
}>();

const phase = ref<Phase>('instruction');
const instruction = ref('');
const items = ref<BatchOptimizeItem[]>([]);
const activeChapterNo = ref<number | null>(null);
const queueRunning = ref(false);
const cancelRequested = ref(false);
const batchApplying = ref(false);
const errorMessage = ref('');
const chapterOptimizeSegmentCharSize = ref(DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE);

const originalScrollRef = ref<HTMLDivElement | null>(null);
const draftTextareaRef = ref<HTMLTextAreaElement | null>(null);
const isScrolling = ref(false);
const syncScrollEnabled = ref(true);

const activeItem = computed(
  () => items.value.find((item) => item.chapterNo === activeChapterNo.value) ?? null
);

const isBusy = computed(
  () => queueRunning.value || batchApplying.value || activeItem.value?.applying === true
);

const showDraftWorkspace = computed(() => {
  const item = activeItem.value;
  if (!item) {
    return false;
  }
  return (
    item.generatingDraft ||
    Boolean(item.draftText) ||
    item.status === 'ready' ||
    item.status === 'applied' ||
    item.status === 'apply_failed'
  );
});

const showPlanWorkspace = computed(() => {
  const item = activeItem.value;
  if (!item || showDraftWorkspace.value) {
    return false;
  }
  return item.generatingPlan || Boolean(item.planText) || item.status === 'processing';
});

const activeStepIndex = computed(() => {
  if (showDraftWorkspace.value) {
    return 2;
  }
  if (showPlanWorkspace.value) {
    return 1;
  }
  return 0;
});

const activeDiffLines = computed(() => {
  const item = activeItem.value;
  if (!item || item.generatingDraft || !item.draftText) {
    return [];
  }
  return buildChapterDiffLines(item.originalContent, item.draftText);
});

const addedCount = computed(() => activeDiffLines.value.filter((r) => r.type === 'added').length);
const removedCount = computed(() => activeDiffLines.value.filter((r) => r.type === 'removed').length);
const modifiedCount = computed(() => activeDiffLines.value.filter((r) => r.type === 'modified').length);

const readyCount = computed(
  () => items.value.filter((item) => item.status === 'ready' || item.status === 'apply_failed').length
);

const progressPercent = computed(() => {
  if (items.value.length === 0) {
    return 0;
  }
  const done = items.value.filter(
    (item) =>
      item.status === 'ready' ||
      item.status === 'applied' ||
      item.status === 'apply_failed' ||
      item.status === 'error'
  ).length;
  return Math.round((done / items.value.length) * 100);
});

function resetState() {
  phase.value = 'instruction';
  instruction.value = '';
  items.value = [];
  activeChapterNo.value = null;
  queueRunning.value = false;
  cancelRequested.value = false;
  batchApplying.value = false;
  errorMessage.value = '';
}

function initItems() {
  items.value = [...props.chapters]
    .sort((a, b) => a.chapterNo - b.chapterNo)
    .map((chapter) => ({
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      originalContent: chapter.content,
      expectedChapterUpdatedAt: chapter.updatedAt,
      planText: '',
      planId: undefined,
      planBasis: null,
      draftText: '',
      draftTraceId: '',
      status: 'pending' as BatchItemStatus,
      errorMessage: '',
      generatingPlan: false,
      generatingDraft: false,
      applying: false,
      strategyLabel: resolveChapterOptimizeStrategyLabel(
        chapter.content.length,
        chapterOptimizeSegmentCharSize.value
      ),
      progressLabel: '',
      segmentDiagnoses: [],
      planSegmentRecovery: null,
    }));
  activeChapterNo.value = items.value[0]?.chapterNo ?? null;
}

function close() {
  if (isBusy.value) {
    return;
  }
  emit('close');
}

function chapterTabLabel(item: BatchOptimizeItem): string {
  const shortTitle = item.title.length > 8 ? `${item.title.slice(0, 8)}…` : item.title;
  let badge = '';
  if (item.status === 'processing' || item.generatingPlan || item.generatingDraft) {
    badge = ' …';
  } else if (item.status === 'ready' || item.status === 'apply_failed') {
    badge = ' ●';
  } else if (item.status === 'applied') {
    badge = ' ✓';
  } else if (item.status === 'error') {
    badge = ' !';
  }
  return `第${item.chapterNo}章 ${shortTitle}${badge}`;
}

function onOriginalScroll() {
  if (isScrolling.value || !syncScrollEnabled.value) {
    return;
  }
  syncScroll('original');
}

function onDraftScroll() {
  if (isScrolling.value || !syncScrollEnabled.value) {
    return;
  }
  syncScroll('draft');
}

function syncScroll(source: 'original' | 'draft') {
  const sourceEl = source === 'original' ? originalScrollRef.value : draftTextareaRef.value;
  const targetEl = source === 'original' ? draftTextareaRef.value : originalScrollRef.value;
  if (!sourceEl || !targetEl) {
    return;
  }

  const sourceScrollHeight = sourceEl.scrollHeight - sourceEl.clientHeight;
  if (sourceScrollHeight <= 0) {
    return;
  }

  const scrollRatio = sourceEl.scrollTop / sourceScrollHeight;
  const targetScrollHeight = targetEl.scrollHeight - targetEl.clientHeight;

  isScrolling.value = true;
  targetEl.scrollTop = scrollRatio * targetScrollHeight;
  setTimeout(() => {
    isScrolling.value = false;
  }, 50);
}

async function runPlanForChapter(
  item: BatchOptimizeItem,
  resume?: { existingSegmentDiagnoses: string[]; resumeFromSegmentIndex?: number }
): Promise<ChapterOptimizationPlanResult> {
  item.generatingPlan = true;
  item.progressLabel = resume
    ? `从第 ${resume.resumeFromSegmentIndex} 段重试…`
    : '准备生成方案…';
  if (!resume) {
    item.planSegmentRecovery = null;
  }
  return new Promise((resolve, reject) => {
    let planResult: ChapterOptimizationPlanResult | null = null;

    void apiClient
      .optimizeChapterPlanSSE(
        props.projectId,
        item.chapterNo,
        {
          instruction: instruction.value.trim(),
          existingSegmentDiagnoses: resume?.existingSegmentDiagnoses,
          resumeFromSegmentIndex: resume?.resumeFromSegmentIndex,
        },
        {
          onStart: (payload) => {
            if (!resume) {
              item.planText = '';
            }
            item.strategyLabel = payload.strategyLabel || item.strategyLabel;
            item.progressLabel = '生成优化方案…';
            planResult = {
              planText: resume ? item.planText : '',
              planId: payload.planId,
              traceId: payload.traceId,
              basis: payload.basis,
              optimizationMode: payload.optimizationMode,
              segmentTotal: payload.segmentTotal,
              strategyLabel: payload.strategyLabel,
              segmentDiagnoses: resume?.existingSegmentDiagnoses ?? item.segmentDiagnoses,
            };
            item.planBasis = payload.basis;
          },
          onStage: ({ stage, segmentIndex, segmentTotal, retryCount }) => {
            if (retryCount && retryCount > 0) {
              item.planText = '';
              if (planResult) {
                planResult = { ...planResult, planText: '' };
              }
            }
            item.progressLabel = formatChapterOptimizeStageLabel(
              stage,
              segmentIndex,
              segmentTotal,
              retryCount
            );
          },
          onContent: (text) => {
            item.planText += text;
            if (planResult) {
              planResult = { ...planResult, planText: planResult.planText + text };
            }
          },
          onEnd: (result) => {
            item.planText = result.planText;
            item.planId = result.planId;
            item.planBasis = result.basis;
            item.segmentDiagnoses = result.segmentDiagnoses ?? [];
            item.planSegmentRecovery = null;
            item.progressLabel = '';
            resolve(result);
          },
          onError: (message, recovery) => {
            item.progressLabel = '';
            if (recovery?.retryable) {
              item.planSegmentRecovery = recovery;
              item.segmentDiagnoses = recovery.segmentDiagnoses ?? item.segmentDiagnoses;
              item.status = 'error';
              item.errorMessage = message || '生成优化方案失败，可重试失败段';
              reject(new Error(item.errorMessage));
              return;
            }
            item.planSegmentRecovery = null;
            reject(new Error(message || '生成优化方案失败'));
          },
        }
      )
      .catch(reject)
      .finally(() => {
        item.generatingPlan = false;
      });
  });
}

async function retryPlanForChapter(item: BatchOptimizeItem) {
  const recovery = item.planSegmentRecovery;
  if (recovery?.segmentDiagnoses?.length) {
    const resumeFrom =
      recovery.failedSegmentIndex ??
      (recovery.segmentTotal && recovery.segmentDiagnoses.length >= recovery.segmentTotal
        ? recovery.segmentTotal + 1
        : undefined);
    return runPlanForChapter(item, {
      existingSegmentDiagnoses: recovery.segmentDiagnoses,
      ...(resumeFrom !== undefined ? { resumeFromSegmentIndex: resumeFrom } : {}),
    });
  }
  return runPlanForChapter(item);
}

async function runDraftForChapter(
  item: BatchOptimizeItem,
  plan: ChapterOptimizationPlanResult
): Promise<string> {
  item.generatingDraft = true;
  item.draftText = '';
  item.progressLabel = '准备生成正文…';
  return new Promise((resolve, reject) => {
    let draft = '';

    void apiClient
      .optimizeChapterDraftSSE(
        props.projectId,
        item.chapterNo,
        {
          instruction: instruction.value.trim(),
          planText: plan.planText,
          planId: plan.planId,
          segmentDiagnoses: plan.segmentDiagnoses ?? item.segmentDiagnoses,
        },
        {
          onStart: (_traceId, _chapterNo, meta) => {
            draft = '';
            item.draftText = '';
            item.strategyLabel = meta?.strategyLabel || item.strategyLabel;
            item.progressLabel = '生成优化正文…';
          },
          onStage: ({ stage, segmentIndex, segmentTotal }) => {
            item.progressLabel = formatChapterOptimizeStageLabel(stage, segmentIndex, segmentTotal);
          },
          onContent: (text) => {
            draft += text;
            item.draftText += text;
          },
          onEnd: () => {
            item.progressLabel = '';
            resolve(draft);
          },
          onError: (message) => {
            item.progressLabel = '';
            reject(new Error(message || '生成优化正文失败'));
          },
        }
      )
      .catch(reject)
      .finally(() => {
        item.generatingDraft = false;
      });
  });
}

async function processChapter(item: BatchOptimizeItem) {
  activeChapterNo.value = item.chapterNo;
  item.status = 'processing';
  item.errorMessage = '';

  try {
    const plan = await runPlanForChapter(item);
    if (cancelRequested.value) {
      item.status = 'error';
      item.errorMessage = '已取消（方案已生成，正文未完成）';
      return;
    }

    const draft = await runDraftForChapter(item, plan);
    item.draftText = draft.trim();
    if (cancelRequested.value) {
      if (item.draftText) {
        item.status = 'ready';
      } else {
        item.status = 'error';
        item.errorMessage = '已取消（正文未完成）';
      }
      return;
    }

    item.status = 'ready';
  } catch (error) {
    item.status = 'error';
    item.errorMessage = error instanceof Error ? error.message : '处理失败';
  }
}

async function runQueue() {
  queueRunning.value = true;
  cancelRequested.value = false;

  for (const item of items.value) {
    if (cancelRequested.value) {
      break;
    }
    if (item.status === 'applied') {
      continue;
    }
    await processChapter(item);
  }

  queueRunning.value = false;
  const ready = items.value.filter((item) => item.status === 'ready').length;
  if (ready > 0) {
    presentInfo(`批量优化完成：${ready}/${items.value.length} 章可应用`);
  } else if (!cancelRequested.value) {
    presentError('批量优化未产生可应用结果');
  }
}

async function handleStartProcessing() {
  if (!instruction.value.trim()) {
    errorMessage.value = presentError('请填写优化要求');
    return;
  }
  if (props.chapters.length < 2) {
    errorMessage.value = presentError('请至少选择 2 章进行批量优化');
    return;
  }

  initItems();
  phase.value = 'workspace';
  errorMessage.value = '';
  await runQueue();
}

function handleCancelQueue() {
  cancelRequested.value = true;
  presentInfo('已请求停止，当前章节处理完成后将保留已完成结果');
}

async function applyItem(item: BatchOptimizeItem): Promise<boolean> {
  if (!item.draftText.trim()) {
    item.status = 'apply_failed';
    item.errorMessage = '优化正文为空';
    return false;
  }

  item.applying = true;
  item.errorMessage = '';
  try {
    await apiClient.applyChapterOptimization(props.projectId, item.chapterNo, {
      draftText: item.draftText.trim(),
      expectedChapterUpdatedAt: item.expectedChapterUpdatedAt,
      planId: item.planId,
      preserveSummary: true,
    });
    item.status = 'applied';
    return true;
  } catch (error) {
    item.status = 'apply_failed';
    item.errorMessage =
      error instanceof Error ? error.message : presentErrorFromCaught(error, '应用失败');
    return false;
  } finally {
    item.applying = false;
  }
}

async function handleApplyCurrent() {
  const item = activeItem.value;
  if (!item) {
    return;
  }
  if (item.status !== 'ready' && item.status !== 'apply_failed') {
    errorMessage.value = presentError('当前章节暂无可应用的优化正文');
    return;
  }

  const ok = await applyItem(item);
  if (ok) {
    presentSuccess(`第${item.chapterNo}章已更新为优化后的正文`);
    emit('applied');
  }
}

async function handleApplyAll() {
  const targets = items.value.filter(
    (item) => item.status === 'ready' || item.status === 'apply_failed'
  );
  if (targets.length === 0) {
    errorMessage.value = presentError('没有可应用的章节');
    return;
  }

  batchApplying.value = true;
  errorMessage.value = '';
  let successCount = 0;

  for (const item of targets) {
    activeChapterNo.value = item.chapterNo;
    const ok = await applyItem(item);
    if (ok) {
      successCount += 1;
    }
  }

  batchApplying.value = false;

  if (successCount > 0) {
    presentSuccess(`已成功应用 ${successCount} 章优化正文`);
    emit('applied');
  }
}

async function loadOptimizeSegmentSettings() {
  try {
    const settings = await apiClient.getSettings(props.projectId);
    chapterOptimizeSegmentCharSize.value =
      settings.chapterOptimizeSegmentCharSize ?? DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE;
  } catch {
    chapterOptimizeSegmentCharSize.value = DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE;
  }
}

watch(
  () => props.visible,
  (open) => {
    if (open) {
      resetState();
      void loadOptimizeSegmentSettings();
    }
  }
);
</script>

<template>
  <a-modal
    :open="props.visible"
    :width="phase === 'workspace' && showDraftWorkspace ? '100%' : 920"
    :wrap-class-name="
      phase === 'workspace' && showDraftWorkspace ? 'optimize-modal-fullscreen' : undefined
    "
    title="批量章节优化"
    :footer="null"
    :mask-closable="!isBusy"
    :closable="!isBusy"
    destroy-on-close
    @cancel="close"
  >
    <p class="modal-subtitle">
      共享优化要求，按章号顺序生成；可通过顶部 Tab 切换查看各章方案与正文对比。
    </p>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>

    <section v-if="phase === 'instruction'" class="step-section">
      <p class="batch-meta">已选 {{ props.chapters.length }} 章</p>
      <ul class="chapter-preview-list">
        <li v-for="chapter in chapters" :key="chapter.chapterNo">
          第{{ chapter.chapterNo }}章 · {{ chapter.title }}
          <span class="strategy-tag">
            （{{
              resolveChapterOptimizeStrategyLabel(
                chapter.content.length,
                chapterOptimizeSegmentCharSize
              )
            }}）
          </span>
        </li>
      </ul>

      <label class="field-label" for="batch-optimize-instruction">共享优化要求</label>
      <textarea
        id="batch-optimize-instruction"
        v-model="instruction"
        class="field-textarea"
        placeholder="例如：统一第三人称视角、压缩冗余描写、加强对话节奏……"
      />

      <div class="step-actions">
        <button class="secondary-button" type="button" @click="close">取消</button>
        <button
          class="primary-button"
          type="button"
          :disabled="!instruction.trim()"
          @click="handleStartProcessing"
        >
          开始批量优化
        </button>
      </div>
    </section>

    <section v-else class="workspace-section">
      <div v-if="queueRunning" class="queue-progress">
        <span>批量生成中 {{ progressPercent }}%</span>
        <div class="progress-bar">
          <div class="progress-bar-fill" :style="{ width: `${progressPercent}%` }" />
        </div>
        <button class="secondary-button" type="button" @click="handleCancelQueue">
          停止后续章节
        </button>
      </div>

      <a-tabs
        v-model:active-key="activeChapterNo"
        type="card"
        class="chapter-tabs"
        :animated="false"
      >
        <a-tab-pane
          v-for="item in items"
          :key="item.chapterNo"
          :tab="chapterTabLabel(item)"
        />
      </a-tabs>

      <template v-if="activeItem">
        <ol class="stepper" :data-step="activeStepIndex">
          <li class="done">
            <span class="stepper-no">1</span>
            <span>输入要求</span>
          </li>
          <li :class="{ active: activeStepIndex === 1, done: activeStepIndex > 1 }">
            <span class="stepper-no">2</span>
            <span>确认方案</span>
          </li>
          <li :class="{ active: activeStepIndex === 2 }">
            <span class="stepper-no">3</span>
            <span>确认正文</span>
          </li>
        </ol>

        <p v-if="activeItem.errorMessage" class="message message-error">
          {{ activeItem.errorMessage }}
        </p>
        <p v-if="activeItem.strategyLabel" class="meta-line">
          处理策略：{{ activeItem.strategyLabel }}
        </p>
        <p v-if="activeItem.progressLabel" class="meta-line progress-line">
          {{ activeItem.progressLabel }}
        </p>
        <p v-if="activeItem.planSegmentRecovery?.retryable" class="message message-info">
          第 {{ activeItem.planSegmentRecovery.failedSegmentIndex }}/{{
            activeItem.planSegmentRecovery.segmentTotal
          }}
          段失败，已完成 {{ activeItem.planSegmentRecovery.segmentDiagnoses?.length ?? 0 }}
          段诊断。
          <button
            class="link-button"
            type="button"
            :disabled="activeItem.generatingPlan || queueRunning"
            @click="retryPlanForChapter(activeItem)"
          >
            {{ activeItem.generatingPlan ? '重试中...' : '重试失败段' }}
          </button>
        </p>

        <section v-if="activeItem.status === 'pending'" class="step-section">
          <p class="waiting-text">等待批量队列处理本章…</p>
        </section>

        <section v-else-if="showPlanWorkspace && !showDraftWorkspace" class="step-section">
          <h4 class="section-title">优化方案 · 第{{ activeItem.chapterNo }}章</h4>
          <label class="field-label" :for="`plan-${activeItem.chapterNo}`">方案内容</label>
          <textarea
            :id="`plan-${activeItem.chapterNo}`"
            v-model="activeItem.planText"
            class="field-textarea plan-text-editor"
            :readonly="activeItem.generatingPlan"
            placeholder="正在生成方案..."
          />
          <p v-if="activeItem.planBasis" class="meta-line">
            基于：大纲 {{ activeItem.planBasis.outlineUsed ? '已注入' : '未注入' }} · 章节摘要
            {{ activeItem.planBasis.chapterSummaryCount }} 条
          </p>
        </section>

        <section v-else-if="showDraftWorkspace" class="step-section draft-section">
          <h4 class="section-title">
            优化正文 · 第{{ activeItem.chapterNo }}章「{{ activeItem.title }}」
          </h4>
          <div
            v-if="activeDiffLines.length > 0 && !activeItem.generatingDraft"
            class="diff-summary"
          >
            <span class="diff-badge diff-added">+{{ addedCount }} 行新增</span>
            <span class="diff-badge diff-removed">-{{ removedCount }} 行删除</span>
            <span class="diff-badge diff-modified">~{{ modifiedCount }} 行改动</span>
          </div>
          <div class="sync-scroll-toggle">
            <label class="sync-scroll-label">
              <input v-model="syncScrollEnabled" type="checkbox" class="sync-scroll-checkbox" />
              <span class="sync-scroll-text">同步滚动</span>
            </label>
          </div>
          <div class="draft-compare-grid">
            <div class="compare-pane">
              <label class="field-label">原文（快照，只读）</label>
              <div ref="originalScrollRef" class="scroll-pane" @scroll="onOriginalScroll">
                <div
                  v-for="(row, idx) in activeDiffLines"
                  :key="'orig-' + idx"
                  class="diff-line"
                  :class="{
                    'line-removed': row.type === 'removed',
                    'line-modified-original':
                      row.type === 'modified' && row.originalSegments.some((s) => s.removed),
                  }"
                >
                  <span
                    v-for="(seg, si) in row.originalSegments"
                    :key="si"
                    :class="{ 'diff-removed-text': seg.removed }"
                    >{{ seg.text }}</span
                  >
                </div>
                <p
                  v-if="activeItem.generatingDraft && activeDiffLines.length === 0"
                  class="generating-hint"
                >
                  正在生成正文...
                </p>
              </div>
            </div>
            <div class="compare-pane">
              <label class="field-label" :for="`draft-${activeItem.chapterNo}`">
                优化正文（可直接编辑）
              </label>
              <textarea
                :id="`draft-${activeItem.chapterNo}`"
                ref="draftTextareaRef"
                v-model="activeItem.draftText"
                class="scroll-pane draft-textarea"
                :readonly="activeItem.generatingDraft"
                :placeholder="
                  activeItem.generatingDraft ? '正在生成正文...' : '可编辑后再应用覆盖'
                "
                @scroll="onDraftScroll"
              />
            </div>
          </div>
          <p v-if="activeItem.draftTraceId" class="meta-line">trace: {{ activeItem.draftTraceId }}</p>
        </section>
      </template>

      <div class="step-actions workspace-actions">
        <button class="secondary-button" type="button" :disabled="isBusy" @click="close">
          关闭
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="
            isBusy ||
            !activeItem ||
            (activeItem.status !== 'ready' && activeItem.status !== 'apply_failed')
          "
          @click="handleApplyCurrent"
        >
          {{ activeItem?.applying ? '应用中...' : '应用当前章' }}
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="isBusy || readyCount === 0"
          @click="handleApplyAll"
        >
          {{ batchApplying ? '应用中...' : `全部应用 (${readyCount})` }}
        </button>
      </div>
    </section>
  </a-modal>
</template>

<style scoped>
.modal-subtitle {
  margin: 0 0 1rem;
  color: rgba(0, 0, 0, 0.45);
  font-size: 0.85rem;
}

:global(.optimize-modal-fullscreen .ant-modal) {
  top: 0;
  max-width: 100vw;
  padding-bottom: 0;
  margin: 0;
}

:global(.optimize-modal-fullscreen .ant-modal-content) {
  min-height: 100vh;
  border-radius: 0;
}

.step-section {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.workspace-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
}

.batch-meta {
  margin: 0;
  font-size: 0.9rem;
  color: #6b7280;
}

.chapter-preview-list {
  margin: 0;
  padding-left: 1.25rem;
  max-height: 120px;
  overflow-y: auto;
  font-size: 0.9rem;
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
  min-height: 200px;
  max-height: 320px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.plan-text-editor:read-only {
  background: #f9fafb;
  cursor: wait;
}

.step-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.workspace-actions {
  margin-top: 0.25rem;
  padding-top: 0.75rem;
  border-top: 1px solid #f0f0f0;
}

.queue-progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.85rem;
}

.progress-bar {
  flex: 1;
  min-width: 120px;
  height: 8px;
  background: #e8e8e8;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: #1677ff;
  transition: width 0.2s ease;
}

.chapter-tabs {
  margin-bottom: 0.25rem;
}

.chapter-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 0.5rem;
}

.stepper {
  display: flex;
  gap: 1.5rem;
  list-style: none;
  margin: 0;
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

.section-title {
  margin: 0;
  font-size: 0.95rem;
  color: #111827;
}

.meta-line {
  margin: 0;
  font-size: 0.78rem;
  color: #9ca3af;
}

.waiting-text {
  margin: 0;
  color: #6b7280;
  font-size: 0.9rem;
}

.draft-section {
  flex: 1;
  min-height: 0;
}

.diff-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.diff-badge {
  font-size: 0.75rem;
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
  background: #fffbeb;
  color: #b45309;
}

.sync-scroll-toggle {
  display: flex;
  align-items: center;
}

.sync-scroll-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: #6b7280;
  cursor: pointer;
}

.draft-compare-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  flex: 1;
  min-height: 280px;
}

.compare-pane {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 0;
}

.scroll-pane {
  flex: 1;
  min-height: 240px;
  max-height: min(52vh, 560px);
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.55rem 0.65rem;
  font-size: 0.88rem;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  background: #fafafa;
}

.draft-textarea {
  font-family: inherit;
  resize: vertical;
  background: #fff;
}

.diff-line {
  min-height: 1.65em;
}

.line-removed,
.line-modified-original {
  background: #fef2f2;
}

.diff-removed-text {
  background: #fecaca;
  text-decoration: line-through;
}

.generating-hint {
  margin: 0;
  color: #6b7280;
}

.message {
  margin: 0;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  font-size: 0.85rem;
}

.message-error {
  background: #fef2f2;
  color: #991b1b;
}

@media (max-width: 720px) {
  .draft-compare-grid {
    grid-template-columns: 1fr;
  }
}
</style>
