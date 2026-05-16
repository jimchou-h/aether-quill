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
import ChapterImportDialog from '../components/chapters/ChapterImportDialog.vue';
import ChapterList from '../components/chapters/ChapterList.vue';
import ChapterOptimizeDialog from '../components/chapters/ChapterOptimizeDialog.vue';
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
const generatingRelationChapterNo = ref<number | null>(null);
const optimizingChapterNo = ref<number | null>(null);
const latestSummaryJob = ref<SummaryJob | null>(null);
const message = ref('');
const errorMessage = ref('');
const selectedChapterNo = ref<number | null>(null);
const parsingStructuredChapterNo = ref<number | null>(null);
const showImportModal = ref(false);
const showImportNovelModal = ref(false);
const showOptimizeModal = ref(false);
const optimizingChapter = ref<ChapterItem | null>(null);
const exportingChapters = ref(false);

const importFormRef = ref<InstanceType<typeof ChapterImportForm> | null>(null);
const chapterListRef = ref<InstanceType<typeof ChapterList> | null>(null);

function syncSelectedChapter() {
  if (chapters.value.length === 0) {
    selectedChapterNo.value = null;
    return;
  }

  const currentExists = chapters.value.some(
    (chapter) => chapter.chapterNo === selectedChapterNo.value
  );
  if (!currentExists) {
    selectedChapterNo.value = chapters.value[0]?.chapterNo ?? null;
  }
}

function openImportModal() {
  showImportModal.value = true;
}

function closeImportModal() {
  showImportModal.value = false;
}

function openImportNovelModal() {
  showImportNovelModal.value = true;
}

function closeImportNovelModal() {
  showImportNovelModal.value = false;
}

async function handleImportNovelDone() {
  showImportNovelModal.value = false;
  await loadWorkspace();
}

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
    syncSelectedChapter();
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
    selectedChapterNo.value = payload.chapterNo;
    closeImportModal();
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

async function handleParseStructuredChapter(chapterNo: number) {
  parsingStructuredChapterNo.value = chapterNo;
  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.parseChapterStructuredInfo(projectId.value, chapterNo, { mode: 'chapter' });
    message.value = presentSuccess(`第${chapterNo}章结构化信息已解析`);
    await loadWorkspace();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '解析结构化信息失败');
  } finally {
    parsingStructuredChapterNo.value = null;
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

async function handleGenerateChapterRelationEvents(chapterNo: number) {
  generatingRelationChapterNo.value = chapterNo;
  errorMessage.value = '';
  message.value = '';
  try {
    message.value = presentInfo(`第${chapterNo}章关系事件生成中...`);
    const result = await apiClient.generateChapterRelationEvents(projectId.value, chapterNo);

    if (result.createdCount > 0) {
      message.value = presentSuccess(
        `第${chapterNo}章已新增 ${result.createdCount} 条关系事件` +
          (result.skippedCount > 0 ? `，跳过 ${result.skippedCount} 条重复` : '')
      );
      return;
    }

    if (result.skippedCount > 0) {
      message.value = presentInfo(
        `第${chapterNo}章未新增关系事件，跳过 ${result.skippedCount} 条重复`
      );
      return;
    }

    message.value = presentInfo(`第${chapterNo}章未识别到可写入的关系事件`);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '生成关系事件失败');
  } finally {
    generatingRelationChapterNo.value = null;
  }
}

function handleOpenOptimizeDialog(chapter: ChapterItem) {
  optimizingChapter.value = chapter;
  optimizingChapterNo.value = chapter.chapterNo;
  showOptimizeModal.value = true;
}

function handleCloseOptimizeDialog() {
  showOptimizeModal.value = false;
  optimizingChapter.value = null;
  optimizingChapterNo.value = null;
}

async function handleOptimizeApplied(updated: ChapterItem) {
  message.value = presentSuccess(`第${updated.chapterNo}章已更新为优化后的正文`);
  await loadWorkspace();
  selectedChapterNo.value = updated.chapterNo;
}

async function handleExportChapters() {
  exportingChapters.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const blob = await apiClient.exportProjectChaptersTxt(projectId.value);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `chapters-${projectId.value}-${date}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    message.value = presentSuccess('全部章节已导出为 txt 文件');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '导出章节失败');
  } finally {
    exportingChapters.value = false;
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
    <div class="page-header">
      <div>
        <h2 class="page-title">章节模块</h2>
        <p class="page-subtitle">
          查看小说正文与摘要，补录历史章节，并按章生成语义摘要或关系事件。
        </p>
        <p class="page-hint page-hint-warn">
          生成章节草稿时依赖「结构化信息」做知识库标题匹配；若未解析，将无法注入知识库文档。请在本页或写作工作台使用「解析结构化信息」。
        </p>
      </div>
      <div class="header-actions">
        <button
          class="secondary-button"
          type="button"
          :disabled="exportingChapters || chapters.length === 0"
          @click="handleExportChapters"
        >
          {{ exportingChapters ? '导出中...' : '导出全部章节' }}
        </button>
        <button class="secondary-button" type="button" @click="openImportNovelModal">
          导入小说
        </button>
        <button class="primary-button" type="button" @click="openImportModal">新增章节</button>
      </div>
    </div>

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

    <ChapterList
      ref="chapterListRef"
      :chapters="chapters"
      :loading="loading"
      :selected-chapter-no="selectedChapterNo"
      :summarizing-chapter-no="summarizingChapterNo"
      :generating-relation-chapter-no="generatingRelationChapterNo"
      :optimizing-chapter-no="optimizingChapterNo"
      :saving-chapter-no="savingChapterNo"
      :parsing-structured-chapter-no="parsingStructuredChapterNo"
      @select="selectedChapterNo = $event"
      @summarize="handleSummarizeChapter"
      @generate-relation-events="handleGenerateChapterRelationEvents"
      @optimize="handleOpenOptimizeDialog"
      @save="handleSaveChapter"
      @parse-structured="handleParseStructuredChapter"
    />

    <ChapterImportDialog
      v-if="showImportNovelModal"
      :project-id="projectId"
      @imported="handleImportNovelDone"
      @close="closeImportNovelModal"
    />

    <ChapterOptimizeDialog
      :visible="showOptimizeModal"
      :project-id="projectId"
      :chapter="optimizingChapter"
      @close="handleCloseOptimizeDialog"
      @applied="handleOptimizeApplied"
    />

    <div
      v-if="showImportModal"
      class="modal-overlay"
      role="presentation"
      @click.self="closeImportModal"
    >
      <section
        class="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
      >
        <header class="modal-header">
          <div>
            <h3 id="import-modal-title" class="modal-title">新增章节</h3>
            <p class="modal-subtitle">补录历史章节后，可在左侧列表中查看正文与摘要。</p>
          </div>
          <button type="button" class="modal-close" aria-label="关闭弹窗" @click="closeImportModal">
            ×
          </button>
        </header>

        <ChapterImportForm
          ref="importFormRef"
          embedded
          :submitting="submitting"
          @submit="handleImportChapter"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.chapters-page {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
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

.page-hint {
  margin: 0.5rem 0 0;
  font-size: 0.82rem;
  line-height: 1.5;
  max-width: 52rem;
}

.page-hint-warn {
  color: #92400e;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  background: #fffbeb;
  border: 1px solid #fde68a;
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

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  white-space: nowrap;
  font-size: 0.85rem;
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
  width: min(720px, 100%);
  max-height: calc(100vh - 3rem);
  overflow: auto;
  border-radius: 12px;
  background: #fff;
  padding: 1.25rem;
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

.modal-close:hover {
  color: #111827;
}
</style>
