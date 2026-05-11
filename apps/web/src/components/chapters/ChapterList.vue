<script setup lang="ts">
import { ref } from 'vue';
import type { ChapterItem } from '../../services/api';

const props = defineProps<{
  chapters: ChapterItem[];
  loading: boolean;
  summarizingChapterNo: number | null;
  savingChapterNo: number | null;
}>();

const emit = defineEmits<{
  summarize: [chapterNo: number];
  save: [payload: { chapterNo: number; title: string; content: string }];
}>();

const editingChapterNo = ref<number | null>(null);
const editTitle = ref('');
const editContent = ref('');
const localError = ref('');

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

function summarySourceText(source?: ChapterItem['summarySource']) {
  if (source === 'llm') {
    return '语义摘要';
  }
  if (source === 'fallback') {
    return '规则摘要';
  }
  return '未标注';
}

function isEditing(chapterNo: number) {
  return editingChapterNo.value === chapterNo;
}

function isBusy(chapterNo: number) {
  return (
    props.summarizingChapterNo === chapterNo ||
    props.savingChapterNo === chapterNo ||
    (editingChapterNo.value !== null && editingChapterNo.value !== chapterNo)
  );
}

function startEdit(chapter: ChapterItem) {
  editingChapterNo.value = chapter.chapterNo;
  editTitle.value = chapter.title;
  editContent.value = chapter.content;
  localError.value = '';
}

function cancelEdit() {
  editingChapterNo.value = null;
  editTitle.value = '';
  editContent.value = '';
  localError.value = '';
}

function handleSave(chapterNo: number) {
  const title = editTitle.value.trim();
  const content = editContent.value.trim();

  if (!title) {
    localError.value = '请填写章节标题';
    return;
  }
  if (!content) {
    localError.value = '请填写章节正文';
    return;
  }

  localError.value = '';
  emit('save', { chapterNo, title, content });
}

function clearEditing() {
  cancelEdit();
}

defineExpose({ clearEditing });
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">章节列表</h3>

    <p v-if="localError" class="message message-error">{{ localError }}</p>
    <p v-if="props.loading" class="message">正在加载章节...</p>
    <p v-else-if="props.chapters.length === 0" class="message">暂无章节，请先新增或导入章节。</p>

    <div v-else class="chapter-list">
      <article v-for="chapter in props.chapters" :key="chapter.chapterNo" class="chapter-card">
        <header class="chapter-header">
          <div v-if="isEditing(chapter.chapterNo)" class="chapter-edit-heading">
            <label class="field-label">章节标题</label>
            <input
              v-model="editTitle"
              class="field-input"
              type="text"
              :disabled="props.savingChapterNo === chapter.chapterNo"
            />
          </div>
          <div v-else class="chapter-heading">
            <h4 class="chapter-title">第{{ chapter.chapterNo }}章 · {{ chapter.title }}</h4>
            <span class="summary-source">{{ summarySourceText(chapter.summarySource) }}</span>
          </div>
          <div class="chapter-actions">
            <span class="chapter-date">更新于 {{ formatTime(chapter.updatedAt) }}</span>
            <template v-if="isEditing(chapter.chapterNo)">
              <button
                class="primary-button"
                :disabled="props.savingChapterNo === chapter.chapterNo"
                @click="handleSave(chapter.chapterNo)"
              >
                {{ props.savingChapterNo === chapter.chapterNo ? '保存中...' : '保存' }}
              </button>
              <button
                class="secondary-button"
                :disabled="props.savingChapterNo === chapter.chapterNo"
                @click="cancelEdit"
              >
                取消
              </button>
            </template>
            <template v-else>
              <button
                class="secondary-button"
                :disabled="isBusy(chapter.chapterNo)"
                @click="startEdit(chapter)"
              >
                编辑
              </button>
              <button
                class="secondary-button"
                :disabled="isBusy(chapter.chapterNo)"
                @click="emit('summarize', chapter.chapterNo)"
              >
                {{ props.summarizingChapterNo === chapter.chapterNo ? '生成中...' : '生成摘要' }}
              </button>
            </template>
          </div>
        </header>

        <div class="chapter-section">
          <h5 class="section-title">摘要</h5>
          <p class="summary-text">{{ chapter.summary || '暂无摘要' }}</p>
          <p v-if="chapter.summaryUpdatedAt" class="summary-meta">
            摘要更新于 {{ formatTime(chapter.summaryUpdatedAt) }}
          </p>
        </div>

        <div class="chapter-section">
          <h5 class="section-title">正文</h5>
          <textarea
            v-if="isEditing(chapter.chapterNo)"
            v-model="editContent"
            class="field-textarea"
            :disabled="props.savingChapterNo === chapter.chapterNo"
          />
          <pre v-else class="content-text">{{ chapter.content || '暂无正文' }}</pre>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  background: #fff;
}

.panel-title {
  margin: 0 0 0.8rem;
  font-size: 1rem;
}

.message {
  margin: 0 0 0.8rem;
  color: #6b7280;
  font-size: 0.85rem;
}

.message-error {
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  background: #fef2f2;
  color: #991b1b;
}

.chapter-list {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.chapter-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.8rem;
  background: #fafafa;
}

.chapter-header {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.55rem;
}

.chapter-heading,
.chapter-edit-heading {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 0;
}

.chapter-title {
  margin: 0;
  font-size: 0.95rem;
  color: #111827;
}

.summary-source {
  font-size: 0.75rem;
  color: #6b7280;
}

.chapter-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
}

.chapter-date {
  font-size: 0.78rem;
  color: #6b7280;
  white-space: nowrap;
}

.field-label {
  font-size: 0.8rem;
  color: #6b7280;
}

.field-input,
.field-textarea {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  font-size: 0.9rem;
  font-family: inherit;
}

.field-textarea {
  min-height: 220px;
  resize: vertical;
}

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.35rem 0.7rem;
  cursor: pointer;
  font-size: 0.8rem;
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

.chapter-section {
  margin-top: 0.45rem;
}

.section-title {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  color: #4b5563;
}

.summary-text {
  margin: 0;
  color: #374151;
  line-height: 1.5;
  white-space: pre-wrap;
}

.summary-meta {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: #6b7280;
}

.content-text {
  margin: 0;
  padding: 0.6rem;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #e5e7eb;
  white-space: pre-wrap;
  color: #1f2937;
  max-height: 260px;
  overflow: auto;
}
</style>
