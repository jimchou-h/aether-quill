<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
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
const renumbering = ref(false);
const showHint = ref(true);
const showMoreMenu = ref(false);
const moreMenuRef = ref<HTMLElement | null>(null);

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
  showMoreMenu.value = false;
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

const summaryJobDotClass = computed(() => {
  const job = latestSummaryJob.value;
  if (!job) return 'dot-idle';
  if (job.status === 'processing') return 'dot-processing';
  if (job.status === 'completed') return 'dot-completed';
  if (job.status === 'failed') return 'dot-failed';
  return 'dot-idle';
});

function toggleMoreMenu() {
  showMoreMenu.value = !showMoreMenu.value;
}

function handleOpenImportNovel() {
  showMoreMenu.value = false;
  openImportNovelModal();
}

function handleClickOutside(event: MouseEvent) {
  if (
    showMoreMenu.value &&
    moreMenuRef.value &&
    !moreMenuRef.value.contains(event.target as Node)
  ) {
    const menuEl = document.querySelector('.dropdown-menu');
    if (menuEl && !menuEl.contains(event.target as Node)) {
      showMoreMenu.value = false;
    }
  }
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
    await apiClient.insertChapter(projectId.value, payload);
    message.value = presentSuccess(`第${payload.chapterNo}章已插入`);
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

async function handleDeleteChapter(chapterNo: number) {
  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.deleteChapter(projectId.value, chapterNo);
    message.value = presentSuccess(`第${chapterNo}章已删除`);
    await loadWorkspace();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '删除章节失败');
  }
}

async function handleRenumberChapters() {
  renumbering.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const result = await apiClient.renumberChapters(projectId.value);
    message.value = presentSuccess(`章节已重新编号，共调整 ${result.renumberedCount} 个章节`);
    await loadWorkspace();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '章节重新编号失败');
  } finally {
    renumbering.value = false;
  }
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
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div class="chapters-page">
    <div class="page-header">
      <div class="page-heading">
        <div class="page-title-row">
          <h2 class="page-title">章节模块</h2>
          <span class="chapter-count-badge">{{ chapters.length }} 章</span>
        </div>
        <p class="page-subtitle">
          查看小说正文与摘要，补录历史章节，并按章生成语义摘要或关系事件。
        </p>
      </div>
      <div class="header-actions">
        <div class="summary-status-inline">
          <span class="summary-status-dot" :class="summaryJobDotClass"></span>
          <span class="summary-status-text">{{ jobStatusText(latestSummaryJob) }}</span>
        </div>
        <button
          class="secondary-button"
          :disabled="batchSummarizing"
          @click="handleGenerateSummaries"
        >
          {{ batchSummarizing ? '生成中...' : '批量摘要' }}
        </button>
        <div class="dropdown-container">
          <button
            ref="moreMenuRef"
            class="secondary-button icon-button"
            type="button"
            aria-label="更多操作"
            @click="toggleMoreMenu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="3" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="8" cy="13" r="1.5" />
            </svg>
          </button>
          <div v-if="showMoreMenu" class="dropdown-menu dropdown-menu-right">
            <button
              class="dropdown-item"
              type="button"
              :disabled="renumbering || chapters.length < 2"
              @click="handleRenumberChapters"
            >
              {{ renumbering ? '编号中...' : '重新编号' }}
            </button>
            <button
              class="dropdown-item"
              type="button"
              :disabled="exportingChapters || chapters.length === 0"
              @click="handleExportChapters"
            >
              {{ exportingChapters ? '导出中...' : '导出全部章节' }}
            </button>
            <button
              class="dropdown-item"
              type="button"
              :disabled="showImportNovelModal"
              @click="handleOpenImportNovel"
            >
              导入小说
            </button>
          </div>
        </div>
        <button class="primary-button" type="button" @click="openImportModal">新增章节</button>
      </div>
    </div>

    <div v-if="showHint" class="warning-banner">
      <span class="warning-banner-text">
        生成章节草稿时依赖「结构化信息」做知识库标题匹配；若未解析，将无法注入知识库文档。
      </span>
      <button class="warning-banner-close" aria-label="关闭提示" @click="showHint = false">
        &times;
      </button>
    </div>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>

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
      @delete="handleDeleteChapter"
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
  gap: 0.75rem;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.page-heading {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.page-title-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.page-title {
  margin: 0;
  font-size: 1.25rem;
}

.chapter-count-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  color: #4b5563;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
}

.page-subtitle {
  margin: 0;
  color: #6b7280;
  font-size: 0.85rem;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.summary-status-inline {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  font-size: 0.78rem;
  color: #6b7280;
  white-space: nowrap;
}

.summary-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.summary-status-dot.dot-idle {
  background: #9ca3af;
}

.summary-status-dot.dot-processing {
  background: #f59e0b;
  animation: pulse 1.5s ease-in-out infinite;
}

.summary-status-dot.dot-completed {
  background: #10b981;
}

.summary-status-dot.dot-failed {
  background: #ef4444;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.summary-status-text {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.warning-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.65rem;
  border-radius: 6px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  font-size: 0.82rem;
  line-height: 1.5;
  color: #92400e;
}

.warning-banner-text {
  flex: 1;
}

.warning-banner-close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: #92400e;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0 0.2rem;
  line-height: 1;
  opacity: 0.6;
}

.warning-banner-close:hover {
  opacity: 1;
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

.header-actions .primary-button,
.header-actions .secondary-button {
  border-radius: 6px;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  font-size: 0.85rem;
}

.primary-button {
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  font-size: 0.85rem;
}

.secondary-button {
  background: #fff;
  color: #111827;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  font-size: 0.85rem;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.45rem 0.6rem;
}

.dropdown-container {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 160px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 0.35rem;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.dropdown-item {
  display: block;
  width: 100%;
  padding: 0.5rem 0.7rem;
  border: none;
  background: transparent;
  color: #111827;
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  white-space: nowrap;
}

.dropdown-item:hover:not(:disabled) {
  background: #f3f4f6;
}

.dropdown-item:disabled {
  opacity: 0.4;
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
