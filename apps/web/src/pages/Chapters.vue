<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  apiClient,
  type ChapterItem,
  type ChapterSummarySource,
  type SummaryJob,
} from '../services/api';
import ChapterImportForm from '../components/chapters/ChapterImportForm.vue';
import ChapterList from '../components/chapters/ChapterList.vue';
import {
  presentError,
  presentErrorFromCaught,
  presentInfo,
  presentSuccess,
} from '../utils/pageFeedback';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const chapters = ref<ChapterItem[]>([]);
const loading = ref(false);
const submitting = ref(false);
const savingChapterNo = ref<number | null>(null);
const batchSummarizing = ref(false);
const summarizingChapterNo = ref<number | null>(null);
const latestSummaryJob = ref<SummaryJob | null>(null);
const message = ref('');
const errorMessage = ref('');

const importFormRef = ref<InstanceType<typeof ChapterImportForm> | null>(null);
const chapterListRef = ref<InstanceType<typeof ChapterList> | null>(null);

function sortByChapterNo(items: ChapterItem[]) {
  return [...items].sort((a, b) => a.chapterNo - b.chapterNo);
}

async function loadWorkspace() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    chapters.value = sortByChapterNo(workspace.knowledge.chapters);
    latestSummaryJob.value = workspace.latestSummaryJob;
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载章节失败');
  } finally {
    loading.value = false;
  }
}

async function handleImportChapter(payload: { chapterNo: number; title: string; content: string }) {
  submitting.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.upsertChapter(projectId.value, payload);
    message.value = presentSuccess(`第${payload.chapterNo}章已保存`);
    importFormRef.value?.resetForm();
    await loadWorkspace();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '保存章节失败');
  } finally {
    submitting.value = false;
  }
}

async function handleSaveChapter(payload: { chapterNo: number; title: string; content: string }) {
  savingChapterNo.value = payload.chapterNo;
  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.upsertChapter(projectId.value, payload);
    message.value = presentSuccess(`第${payload.chapterNo}章已更新`);
    chapterListRef.value?.clearEditing();
    await loadWorkspace();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '更新章节失败');
  } finally {
    savingChapterNo.value = null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pollSummaryJob(jobId: string) {
  for (let i = 0; i < 20; i += 1) {
    const job = await apiClient.getSummaryJob(projectId.value, jobId);
    latestSummaryJob.value = job;
    if (job.status === 'completed' || job.status === 'failed') {
      return job;
    }
    await sleep(1000);
  }
  return latestSummaryJob.value;
}

function summarySourceText(source?: ChapterSummarySource) {
  if (source === 'llm') {
    return '语义摘要';
  }
  if (source === 'fallback') {
    return '规则摘要';
  }
  return '未标注';
}

function jobStatusText(job: SummaryJob | null) {
  if (!job) {
    return '暂无摘要任务';
  }
  if (job.status === 'processing') {
    return `处理中 ${job.processedChapters}/${job.totalChapters}`;
  }
  if (job.status === 'completed') {
    const latest = job.summaries[job.summaries.length - 1];
    const sourceText = latest ? summarySourceText(latest.summarySource) : '已完成';
    return `已完成 ${job.processedChapters}/${job.totalChapters}（${sourceText}）`;
  }
  return `失败：${job.errorMessage || '未知错误'}`;
}

async function handleSummarizeChapter(chapterNo: number) {
  summarizingChapterNo.value = chapterNo;
  errorMessage.value = '';
  message.value = '';
  try {
    const created = await apiClient.createChapterSummaryJob(projectId.value, chapterNo);
    latestSummaryJob.value = created;
    message.value = presentInfo(`第${chapterNo}章摘要任务已提交，正在处理...`);

    const finalJob =
      created.status === 'completed' || created.status === 'failed'
        ? created
        : await pollSummaryJob(created.id);

    await loadWorkspace();

    if (!finalJob) {
      message.value = presentInfo(`第${chapterNo}章摘要任务已提交，请稍后刷新查看结果`);
      return;
    }

    if (finalJob.status === 'completed') {
      const latest = finalJob.summaries.find((item) => item.chapterNo === chapterNo);
      message.value = presentSuccess(
        `第${chapterNo}章摘要已更新（${summarySourceText(latest?.summarySource)}）`
      );
    } else if (finalJob.status === 'failed') {
      errorMessage.value = presentError(finalJob.errorMessage || `第${chapterNo}章摘要生成失败`);
    }
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '触发章节摘要失败');
  } finally {
    summarizingChapterNo.value = null;
  }
}

async function handleGenerateSummaries() {
  batchSummarizing.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const created = await apiClient.createBatchSummaryJob(projectId.value);
    latestSummaryJob.value = created;
    message.value = presentInfo('批量摘要任务已提交，正在处理...');

    const finalJob =
      created.status === 'completed' || created.status === 'failed'
        ? created
        : await pollSummaryJob(created.id);

    await loadWorkspace();

    if (!finalJob) {
      message.value = presentInfo('批量摘要任务已提交，请稍后刷新查看结果');
      return;
    }

    if (finalJob.status === 'completed') {
      message.value = presentSuccess(
        `批量摘要完成（${finalJob.processedChapters}/${finalJob.totalChapters}）`
      );
    } else if (finalJob.status === 'failed') {
      errorMessage.value = presentError(finalJob.errorMessage || '批量摘要生成失败');
    }
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '触发批量摘要失败');
  } finally {
    batchSummarizing.value = false;
  }
}

onMounted(() => {
  void loadWorkspace();
});
</script>

<template>
  <div class="chapters-page">
    <h2 class="page-title">章节模块</h2>
    <p class="page-subtitle">查看小说正文与摘要，补录历史章节，并按章或批量生成语义摘要。</p>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>

    <section class="panel summary-panel">
      <div class="summary-row">
        <div class="summary-meta">
          <span class="meta-label">当前摘要任务</span>
          <span class="meta-value">{{ jobStatusText(latestSummaryJob) }}</span>
        </div>
        <button
          class="primary-button"
          :disabled="batchSummarizing"
          @click="handleGenerateSummaries"
        >
          {{ batchSummarizing ? '生成中...' : '批量生成摘要' }}
        </button>
      </div>
    </section>

    <ChapterImportForm ref="importFormRef" :submitting="submitting" @submit="handleImportChapter" />

    <ChapterList
      ref="chapterListRef"
      :chapters="chapters"
      :loading="loading"
      :summarizing-chapter-no="summarizingChapterNo"
      :saving-chapter-no="savingChapterNo"
      @summarize="handleSummarizeChapter"
      @save="handleSaveChapter"
    />
  </div>
</template>

<style scoped>
.chapters-page {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.page-title {
  margin: 0;
  font-size: 1.25rem;
}

.page-subtitle {
  margin: -0.2rem 0 0;
  color: #6b7280;
  font-size: 0.9rem;
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

.message-ok {
  background: #ecfdf3;
  color: #027a48;
}

.panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.85rem 1rem;
  background: #fff;
}

.summary-panel {
  margin-top: 0.2rem;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.7rem;
}

.summary-meta {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.meta-label {
  font-size: 0.75rem;
  color: #6b7280;
}

.meta-value {
  font-size: 0.9rem;
  color: #111827;
}

.primary-button {
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  white-space: nowrap;
}

.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
