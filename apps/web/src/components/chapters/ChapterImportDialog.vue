<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  apiClient,
  type ChapterImportPersonaBootstrap,
  type ChapterItem,
} from '../../services/api';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';
import { readTextFile } from '../../utils/read-text-file';

const props = defineProps<{
  projectId: string;
}>();

const emit = defineEmits<{
  imported: [chapters: ChapterItem[]];
  close: [];
}>();

enum ImportStep {
  Upload,
  Preview,
  Done,
}

const step = ref(ImportStep.Upload);
const rawContent = ref('');
const localError = ref('');
const previewData = ref<{
  totalChars: number;
  detectedCount: number;
  chapters: Array<{
    chapterNo: number;
    title: string;
    contentLength: number;
    contentPreview: string;
  }>;
} | null>(null);
const importing = ref(false);
const readingFile = ref(false);
const importedChapters = ref<ChapterItem[]>([]);
const importBootstrap = ref<ChapterImportPersonaBootstrap | null>(null);
const importFileName = ref('');
const autoExtractRelationEvents = ref(true);
const fileInputRef = ref<HTMLInputElement | null>(null);

const selectedChapterCount = computed(() => previewData.value?.chapters.length ?? 0);
const isBusy = computed(() => importing.value || readingFile.value);

function isAllowedFileType(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.txt') || name.endsWith('.md');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  if (!isAllowedFileType(file)) {
    localError.value = '仅支持 .txt 或 .md 文件';
    return;
  }

  localError.value = '';
  importFileName.value = `${file.name}（${formatBytes(file.size)}）`;
  readingFile.value = true;

  try {
    rawContent.value = await readTextFile(file);
  } catch {
    localError.value = '文件读取失败，请确认文件为 UTF-8 或 GBK 编码';
    readingFile.value = false;
    return;
  }

  await doPreview();
  readingFile.value = false;
}

async function doPreview() {
  if (!rawContent.value.trim()) {
    localError.value = '内容不能为空';
    return;
  }

  localError.value = '';

  try {
    const result = await apiClient.importChapterPreview(props.projectId, rawContent.value);
    previewData.value = result;

    if (result.detectedCount === 0) {
      localError.value = '未能从内容中识别到有效章节，请检查文本格式';
      return;
    }

    step.value = ImportStep.Preview;
  } catch (error) {
    localError.value = presentErrorFromCaught(error, '解析导入内容失败');
  }
}

function removePreviewChapter(chapterNo: number) {
  if (!previewData.value) return;
  previewData.value = {
    ...previewData.value,
    chapters: previewData.value.chapters.filter((chapter) => chapter.chapterNo !== chapterNo),
  };
  if (previewData.value.chapters.length === 0) {
    localError.value = '请至少保留一个章节，或返回重新选择文件';
  } else {
    localError.value = '';
  }
}

async function handleConfirmImport() {
  if (!previewData.value || previewData.value.chapters.length === 0) {
    localError.value = '请至少保留一个章节后再导入';
    return;
  }

  importing.value = true;
  localError.value = '';

  try {
    const chapterNos = previewData.value.chapters.map((chapter) => chapter.chapterNo);
    const fullChapters = await apiClient.importChapterConfirm(
      props.projectId,
      rawContent.value,
      { chapterNos, autoExtractRelationEvents: autoExtractRelationEvents.value }
    );
    importedChapters.value = fullChapters.chapters;
    importBootstrap.value = fullChapters.personaBootstrap;
    step.value = ImportStep.Done;
    const bootstrap = fullChapters.personaBootstrap;
    if (autoExtractRelationEvents.value) {
      presentSuccess(
        `成功导入 ${fullChapters.importedCount} 个章节；自动创建 ${bootstrap.createdPersonaCount} 个角色草稿、${bootstrap.createdRelationEventCount} 条关系事件`
      );
    } else {
      presentSuccess(
        `成功导入 ${fullChapters.importedCount} 个章节；已跳过关系事件自动抽取，可稍后在章节页手动抽取`
      );
    }
  } catch (error) {
    localError.value = presentErrorFromCaught(error, '导入章节失败');
  } finally {
    importing.value = false;
  }
}

function handleDone() {
  emit('imported', importedChapters.value);
  emit('close');
}

function handleClose() {
  emit('close');
}

function formatFileSize(chars: number): string {
  if (chars < 1000) return `${chars} 字符`;
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)}K 字符`;
  return `${(chars / 1_000_000).toFixed(2)}M 字符`;
}

function resetToUpload() {
  step.value = ImportStep.Upload;
  rawContent.value = '';
  previewData.value = null;
  importedChapters.value = [];
  importBootstrap.value = null;
  localError.value = '';
  importFileName.value = '';
  autoExtractRelationEvents.value = true;
  readingFile.value = false;
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
}
</script>

<template>
  <a-modal
    :open="true"
    :width="720"
    :mask-closable="!isBusy"
    :closable="!isBusy"
    destroy-on-close
    @cancel="handleClose"
  >
    <template #title>
      <div>
        <div>导入小说生成章节</div>
        <p class="modal-subtitle">支持 .txt / .md 文件（UTF-8 / GBK），按章节标题自动切分，单文件最大约 5MB</p>
      </div>
    </template>

    <a-alert v-if="localError" type="error" :message="localError" show-icon class="import-alert" />

      <!-- Step 1: Upload -->
      <template v-if="step === ImportStep.Upload">
        <a-spin :spinning="readingFile" tip="正在读取并解析文件...">
          <div class="upload-area">
            <label class="upload-label" :class="{ disabled: readingFile }">
              <span class="upload-icon">&#128196;</span>
              <span class="upload-text">点击选择 .txt / .md 小说文件</span>
              <span class="upload-hint">选择后自动识别章节，无需粘贴大段文本</span>
              <input
                ref="fileInputRef"
                type="file"
                accept=".txt,.md"
                class="upload-input"
                :disabled="readingFile"
                @change="handleFileSelected"
              />
            </label>
          </div>
        </a-spin>

        <div class="form-actions">
          <button class="secondary-button" type="button" :disabled="readingFile" @click="handleClose">
            取消
          </button>
        </div>
      </template>

      <!-- Step 2: Preview -->
      <template v-if="step === ImportStep.Preview && previewData">
        <div class="preview-summary">
          <span class="preview-stat">
            原文：<strong>{{ formatFileSize(previewData.totalChars) }}</strong>
          </span>
          <span class="preview-stat">
            将导入 <strong>{{ selectedChapterCount }}</strong> / 识别
            {{ previewData.detectedCount }} 个章节
          </span>
          <span v-if="importFileName" class="preview-stat"> 文件：{{ importFileName }} </span>
        </div>

        <p class="preview-hint">不需要的章节可点击右侧删除，确认后仅导入剩余章节。</p>

        <div class="import-options">
          <a-checkbox v-model:checked="autoExtractRelationEvents" :disabled="importing">
            导入后自动抽取关系事件
          </a-checkbox>
          <p class="import-options-hint">
            勾选后将为每个导入章节调用 AI 抽取人物关系事件，并尝试创建角色草稿；章节较多时耗时较长。取消勾选则仅导入章节正文，可稍后在章节列表手动抽取。
          </p>
        </div>

        <div class="preview-list">
          <div
            v-for="chapter in previewData.chapters"
            :key="chapter.chapterNo"
            class="preview-item"
          >
            <div class="preview-item-header">
              <span class="preview-chapter-no">第{{ chapter.chapterNo }}章</span>
              <span class="preview-chapter-title">{{ chapter.title }}</span>
              <span class="preview-chars">{{ formatFileSize(chapter.contentLength) }}</span>
              <button
                type="button"
                class="preview-remove-button"
                title="移除此章节"
                :disabled="importing"
                @click="removePreviewChapter(chapter.chapterNo)"
              >
                删除
              </button>
            </div>
            <p class="preview-snippet">{{ chapter.contentPreview || '（空）' }}</p>
          </div>
        </div>

        <div class="form-actions">
          <button class="secondary-button" type="button" @click="resetToUpload">重新选择</button>
          <button
            class="primary-button"
            type="button"
            :disabled="importing || selectedChapterCount === 0"
            @click="handleConfirmImport"
          >
            {{ importing ? '导入中...' : `确认导入 ${selectedChapterCount} 个章节` }}
          </button>
        </div>
      </template>

      <!-- Step 3: Done -->
      <template v-if="step === ImportStep.Done">
        <div class="done-summary">
          <span class="done-icon">&#9989;</span>
          <p class="done-text">
            已成功导入 <strong>{{ importedChapters.length }}</strong> 个章节
          </p>
        </div>

        <div v-if="importBootstrap" class="bootstrap-report">
          <template v-if="autoExtractRelationEvents">
            <p>
              自动创建角色草稿：<strong>{{ importBootstrap.createdPersonaCount }}</strong> 个
            </p>
            <p>
              自动抽取关系事件：<strong>{{ importBootstrap.createdRelationEventCount }}</strong> 条
            </p>
            <p v-if="importBootstrap.createdPersonas.length > 0">
              新增角色：{{ importBootstrap.createdPersonas.map((item) => item.name).join('、') }}
            </p>
            <p v-if="importBootstrap.suspectedNameConflicts.length > 0" class="message message-warn">
              疑似同名冲突：{{
                importBootstrap.suspectedNameConflicts.join('、')
              }}（请前往人物设定页确认）
            </p>
          </template>
          <p v-else class="import-skipped-hint">
            已跳过关系事件自动抽取。如需补充人物关系，请前往章节列表对单章执行「抽取关系事件」。
          </p>
        </div>

        <div class="form-actions">
          <button class="primary-button" type="button" @click="handleDone">完成</button>
        </div>
      </template>
  </a-modal>
</template>

<style scoped>
.modal-subtitle {
  margin: 0.35rem 0 0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 0.85rem;
  font-weight: normal;
}

.import-alert {
  margin-bottom: 1rem;
}

.message {
  margin: 0 0 0.75rem;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  font-size: 0.85rem;
}

.message-error {
  background: #fef2f2;
  color: #991b1b;
}

.upload-area {
  margin-bottom: 1rem;
}

.upload-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  border: 2px dashed #d1d5db;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.upload-label:hover:not(.disabled) {
  border-color: #111827;
}

.upload-label.disabled {
  opacity: 0.7;
  cursor: wait;
}

.upload-icon {
  font-size: 2rem;
}

.upload-text {
  color: #374151;
  font-size: 0.9rem;
}

.upload-hint {
  color: #9ca3af;
  font-size: 0.78rem;
}

.upload-input {
  display: none;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

.primary-button {
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  font-size: 0.85rem;
}

.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secondary-button {
  background: transparent;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  font-size: 0.85rem;
}

.secondary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.preview-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: #f9fafb;
  border-radius: 8px;
  font-size: 0.85rem;
  color: #374151;
}

.preview-stat strong {
  color: #111827;
}

.preview-hint {
  margin: 0 0 0.75rem;
  font-size: 0.8rem;
  color: #6b7280;
}

.import-options {
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.import-options-hint {
  margin: 0.5rem 0 0 1.5rem;
  font-size: 0.78rem;
  color: #6b7280;
  line-height: 1.5;
}

.bootstrap-report {
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: #f9fafb;
  border-radius: 8px;
  font-size: 0.85rem;
  color: #374151;
}

.bootstrap-report p {
  margin: 0 0 0.35rem;
}

.import-skipped-hint {
  margin: 0;
  color: #6b7280;
}

.message-warn {
  background: #fffbeb;
  color: #92400e;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 360px;
  overflow-y: auto;
}

.preview-item {
  padding: 0.65rem 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}

.preview-item-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
}

.preview-chapter-no {
  font-size: 0.78rem;
  font-weight: 600;
  color: #6b7280;
  white-space: nowrap;
}

.preview-chapter-title {
  flex: 1;
  font-size: 0.9rem;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-chars {
  font-size: 0.78rem;
  color: #9ca3af;
  white-space: nowrap;
}

.preview-remove-button {
  flex-shrink: 0;
  border: 1px solid #fecaca;
  background: #fff;
  color: #b91c1c;
  border-radius: 6px;
  padding: 0.2rem 0.55rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.preview-remove-button:hover:not(:disabled) {
  background: #fef2f2;
}

.preview-remove-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.preview-snippet {
  margin: 0;
  font-size: 0.8rem;
  color: #6b7280;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.done-summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 1rem;
  text-align: center;
}

.done-icon {
  font-size: 2.5rem;
}

.done-text {
  margin: 0;
  font-size: 1rem;
  color: #111827;
}
</style>
