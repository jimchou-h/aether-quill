<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  apiClient,
  isTerminalChapterPipelineRunEnd,
  type ChapterItem,
  type ChapterPipelineSessionView,
} from '../../services/api';
import {
  presentErrorFromCaught,
  presentInfo,
  presentSuccess,
} from '../../utils/pageFeedback';

type BatchStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_outline'
  | 'ready'
  | 'applied'
  | 'error';

interface BatchPipelineItem {
  chapterNo: number;
  title: string;
  expectedChapterUpdatedAt: string;
  sessionId: string;
  status: BatchStatus;
  errorMessage: string;
  session: ChapterPipelineSessionView | null;
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

const items = ref<BatchPipelineItem[]>([]);
const queueRunning = ref(false);
const cancelRequested = ref(false);
const batchApplying = ref(false);

const isBusy = computed(() => queueRunning.value || batchApplying.value);

const progressPercent = computed(() => {
  if (items.value.length === 0) {
    return 0;
  }
  const done = items.value.filter((i) =>
    ['ready', 'applied', 'error', 'awaiting_outline'].includes(i.status)
  ).length;
  return Math.round((done / items.value.length) * 100);
});

const readyCount = computed(
  () => items.value.filter((i) => i.status === 'ready').length
);

const awaitingOutlineCount = computed(
  () => items.value.filter((i) => i.status === 'awaiting_outline').length
);

function statusLabel(status: BatchStatus) {
  const labels: Record<BatchStatus, string> = {
    pending: '待处理',
    processing: '处理中',
    awaiting_outline: '待确认大纲',
    ready: '可应用',
    applied: '已应用',
    error: '失败',
  };
  return labels[status];
}

function resetState() {
  items.value = props.chapters.map((chapter) => ({
    chapterNo: chapter.chapterNo,
    title: chapter.title,
    expectedChapterUpdatedAt: chapter.updatedAt,
    sessionId: '',
    status: 'pending' as BatchStatus,
    errorMessage: '',
    session: null,
  }));
  queueRunning.value = false;
  cancelRequested.value = false;
  batchApplying.value = false;
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
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

async function processItem(item: BatchPipelineItem) {
  item.status = 'processing';
  try {
    const start = await apiClient.startChapterPipeline(props.projectId, item.chapterNo);
    item.sessionId = start.sessionId;

    await new Promise<void>((resolve, reject) => {
      apiClient
        .runChapterPipelineModuleSSE(
          props.projectId,
          item.chapterNo,
          item.sessionId,
          'run-all',
          undefined,
          {
            onEnd: async (event) => {
              item.session = await apiClient.getChapterPipelineSession(
                props.projectId,
                item.chapterNo,
                item.sessionId
              );
              if (!isTerminalChapterPipelineRunEnd('run-all', event)) {
                return;
              }
              item.status = event.gateRequired ? 'awaiting_outline' : 'ready';
              resolve();
            },
            onError: (message) => {
              item.errorMessage = message;
              item.status = 'error';
              reject(new Error(message));
            },
          }
        )
        .catch(reject);
    });
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
    if (item.status !== 'pending') {
      continue;
    }
    await processItem(item);
  }
  queueRunning.value = false;
  if (awaitingOutlineCount.value > 0) {
    presentInfo(`${awaitingOutlineCount.value} 章待确认感官大纲，请逐章打开分步精修弹窗处理`);
  }
}

async function applyReady() {
  batchApplying.value = true;
  let applied = 0;
  for (const item of items.value) {
    if (item.status !== 'ready' || !item.sessionId) {
      continue;
    }
    try {
      await apiClient.applyChapterPipeline(
        props.projectId,
        item.chapterNo,
        item.sessionId,
        {
          expectedChapterUpdatedAt: item.expectedChapterUpdatedAt,
          preserveSummary: true,
        }
      );
      item.status = 'applied';
      applied += 1;
    } catch (error) {
      item.status = 'error';
      item.errorMessage = error instanceof Error ? error.message : '应用失败';
      presentErrorFromCaught(error, `第 ${item.chapterNo} 章应用失败`);
    }
  }
  batchApplying.value = false;
  if (applied > 0) {
    presentSuccess(`已应用 ${applied} 章`);
    emit('applied');
  }
}
</script>

<template>
  <a-modal
    :open="props.visible"
    :width="720"
    title="批量分步精修"
    :footer="null"
    :mask-closable="!isBusy"
    :closable="!isBusy"
    destroy-on-close
    @cancel="close"
  >
    <p class="modal-subtitle">串行处理 {{ chapters.length }} 章（run-all）；需确认大纲的章节请单独打开分步精修弹窗。</p>

    <div v-if="queueRunning" class="queue-progress">
      <span>批量处理中 {{ progressPercent }}%</span>
      <div class="progress-bar">
        <div class="progress-bar-fill" :style="{ width: `${progressPercent}%` }" />
      </div>
    </div>

    <ul class="batch-list">
      <li v-for="item in items" :key="item.chapterNo" class="batch-item">
        <div class="batch-item-main">
          <span class="batch-chapter">第 {{ item.chapterNo }} 章</span>
          <span class="batch-title">{{ item.title }}</span>
        </div>
        <span class="status-badge" :class="item.status">{{ statusLabel(item.status) }}</span>
        <p v-if="item.errorMessage" class="batch-error">{{ item.errorMessage }}</p>
      </li>
    </ul>

    <div class="step-actions">
      <button class="secondary-button" type="button" :disabled="isBusy" @click="close">关闭</button>
      <button
        class="secondary-button"
        type="button"
        :disabled="!queueRunning"
        @click="cancelRequested = true"
      >
        停止后续章节
      </button>
      <button class="primary-button" type="button" :disabled="isBusy" @click="runQueue">
        {{ queueRunning ? '处理中…' : '开始批量精修' }}
      </button>
      <button
        class="primary-button"
        type="button"
        :disabled="batchApplying || readyCount === 0"
        @click="applyReady"
      >
        {{ batchApplying ? '应用中…' : `应用已就绪（${readyCount}）` }}
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

.queue-progress {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: #374151;
}

.progress-bar {
  height: 6px;
  background: #e5e7eb;
  border-radius: 999px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: #111827;
  transition: width 0.25s ease;
}

.batch-list {
  margin: 0 0 1rem;
  padding: 0;
  list-style: none;
  max-height: 360px;
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.batch-item {
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid #f3f4f6;
  display: grid;
  gap: 0.35rem;
}

.batch-item:last-child {
  border-bottom: none;
}

.batch-item-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.5rem;
}

.batch-chapter {
  font-size: 0.85rem;
  font-weight: 600;
  color: #111827;
}

.batch-title {
  font-size: 0.85rem;
  color: #4b5563;
}

.status-badge {
  justify-self: start;
  font-size: 0.72rem;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  background: #f3f4f6;
  color: #4b5563;
}

.status-badge.ready {
  background: #dcfce7;
  color: #166534;
}

.status-badge.error {
  background: #fee2e2;
  color: #991b1b;
}

.status-badge.awaiting_outline {
  background: #fef9c3;
  color: #854d0e;
}

.status-badge.processing {
  background: #dbeafe;
  color: #1e40af;
}

.status-badge.applied {
  background: #ecfdf5;
  color: #047857;
}

.batch-error {
  margin: 0;
  font-size: 0.78rem;
  color: #b91c1c;
}

.step-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
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
