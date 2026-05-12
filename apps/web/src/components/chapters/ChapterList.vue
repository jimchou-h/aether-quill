<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ChapterItem } from '../../services/api';

const props = defineProps<{
  chapters: ChapterItem[];
  loading: boolean;
  selectedChapterNo: number | null;
  summarizingChapterNo: number | null;
  generatingRelationChapterNo: number | null;
  savingChapterNo: number | null;
}>();

const emit = defineEmits<{
  select: [chapterNo: number];
  summarize: [chapterNo: number];
  generateRelationEvents: [chapterNo: number];
  save: [payload: { chapterNo: number; title: string; content: string }];
}>();

const editingChapterNo = ref<number | null>(null);
const editTitle = ref('');
const editContent = ref('');
const localError = ref('');

const selectedChapter = computed(
  () => props.chapters.find((chapter) => chapter.chapterNo === props.selectedChapterNo) ?? null
);

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
    props.generatingRelationChapterNo === chapterNo ||
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

watch(
  () => props.selectedChapterNo,
  (nextChapterNo, previousChapterNo) => {
    if (nextChapterNo !== previousChapterNo && editingChapterNo.value !== null) {
      cancelEdit();
    }
  }
);

defineExpose({ clearEditing });
</script>

<template>
  <section class="panel chapter-layout">
    <aside class="chapter-sidebar">
      <h3 class="panel-title">章节列表</h3>

      <p v-if="props.loading" class="message">正在加载章节...</p>
      <p v-else-if="props.chapters.length === 0" class="message">暂无章节，请先新增章节。</p>

      <div v-else class="chapter-tabs" role="tablist" aria-label="章节列表">
        <button
          v-for="chapter in props.chapters"
          :key="chapter.chapterNo"
          type="button"
          class="chapter-tab"
          :class="{ active: chapter.chapterNo === props.selectedChapterNo }"
          role="tab"
          :aria-selected="chapter.chapterNo === props.selectedChapterNo"
          @click="emit('select', chapter.chapterNo)"
        >
          <span class="chapter-tab-no">第{{ chapter.chapterNo }}章</span>
          <span class="chapter-tab-title">{{ chapter.title }}</span>
        </button>
      </div>
    </aside>

    <div class="chapter-detail">
      <p v-if="localError" class="message message-error">{{ localError }}</p>

      <p v-if="!props.loading && props.chapters.length === 0" class="message detail-empty">
        新增章节后，可在此查看正文与摘要。
      </p>

      <template v-else-if="selectedChapter">
        <header class="detail-toolbar">
          <div class="detail-heading">
            <div v-if="isEditing(selectedChapter.chapterNo)" class="detail-edit-heading">
              <label class="field-label" for="chapter-title-input">章节标题</label>
              <input
                id="chapter-title-input"
                v-model="editTitle"
                class="field-input"
                type="text"
                :disabled="props.savingChapterNo === selectedChapter.chapterNo"
              />
            </div>
            <div v-else class="detail-title-group">
              <h4 class="detail-title">
                第{{ selectedChapter.chapterNo }}章 · {{ selectedChapter.title }}
              </h4>
              <p class="detail-meta">
                <span>{{ summarySourceText(selectedChapter.summarySource) }}</span>
                <span>更新于 {{ formatTime(selectedChapter.updatedAt) }}</span>
              </p>
            </div>
          </div>

          <div class="detail-actions">
            <template v-if="isEditing(selectedChapter.chapterNo)">
              <button
                class="primary-button"
                :disabled="props.savingChapterNo === selectedChapter.chapterNo"
                @click="handleSave(selectedChapter.chapterNo)"
              >
                {{ props.savingChapterNo === selectedChapter.chapterNo ? '保存中...' : '保存' }}
              </button>
              <button
                class="secondary-button"
                :disabled="props.savingChapterNo === selectedChapter.chapterNo"
                @click="cancelEdit"
              >
                取消
              </button>
            </template>
            <template v-else>
              <button
                class="secondary-button"
                :disabled="isBusy(selectedChapter.chapterNo)"
                @click="startEdit(selectedChapter)"
              >
                编辑
              </button>
              <button
                class="secondary-button"
                :disabled="isBusy(selectedChapter.chapterNo)"
                @click="emit('summarize', selectedChapter.chapterNo)"
              >
                {{
                  props.summarizingChapterNo === selectedChapter.chapterNo
                    ? '生成中...'
                    : '生成摘要'
                }}
              </button>
              <button
                class="secondary-button"
                :disabled="isBusy(selectedChapter.chapterNo)"
                @click="emit('generateRelationEvents', selectedChapter.chapterNo)"
              >
                {{
                  props.generatingRelationChapterNo === selectedChapter.chapterNo
                    ? '生成中...'
                    : '生成关系事件'
                }}
              </button>
            </template>
          </div>
        </header>

        <section class="chapter-section">
          <h5 class="section-title">摘要</h5>
          <p class="summary-text">{{ selectedChapter.summary || '暂无摘要' }}</p>
          <p v-if="selectedChapter.summaryUpdatedAt" class="summary-meta">
            摘要更新于 {{ formatTime(selectedChapter.summaryUpdatedAt) }}
          </p>
        </section>

        <section class="chapter-section">
          <h5 class="section-title">正文</h5>
          <textarea
            v-if="isEditing(selectedChapter.chapterNo)"
            v-model="editContent"
            class="field-textarea"
            :disabled="props.savingChapterNo === selectedChapter.chapterNo"
          />
          <pre v-else class="content-text">{{ selectedChapter.content || '暂无正文' }}</pre>
        </section>
      </template>
    </div>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}

.chapter-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  min-height: 560px;
  overflow: hidden;
}

.chapter-sidebar {
  border-right: 1px solid #e5e7eb;
  padding: 1rem;
  background: #f9fafb;
}

.panel-title {
  margin: 0 0 0.8rem;
  font-size: 1rem;
}

.message {
  margin: 0;
  color: #6b7280;
  font-size: 0.85rem;
}

.message-error {
  margin-bottom: 0.8rem;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  background: #fef2f2;
  color: #991b1b;
}

.chapter-tabs {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.chapter-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  width: 100%;
  padding: 0.65rem 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.chapter-tab:hover {
  border-color: #cbd5e1;
}

.chapter-tab.active {
  border-color: #111827;
  background: #fff;
  box-shadow: inset 3px 0 0 #111827;
}

.chapter-tab-no {
  font-size: 0.78rem;
  color: #6b7280;
}

.chapter-tab-title {
  font-size: 0.9rem;
  color: #111827;
  line-height: 1.4;
}

.chapter-detail {
  padding: 1rem 1.1rem;
  min-width: 0;
}

.detail-empty {
  margin-top: 0.5rem;
}

.detail-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.9rem;
  border-bottom: 1px solid #e5e7eb;
}

.detail-heading {
  flex: 1;
  min-width: 0;
}

.detail-title-group,
.detail-edit-heading {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.detail-title {
  margin: 0;
  font-size: 1.05rem;
  color: #111827;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0;
  font-size: 0.78rem;
  color: #6b7280;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.45rem;
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
  min-height: 360px;
  resize: vertical;
}

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.45rem 0.8rem;
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

.chapter-section + .chapter-section {
  margin-top: 1rem;
}

.section-title {
  margin: 0 0 0.45rem;
  font-size: 0.82rem;
  color: #4b5563;
}

.summary-text {
  margin: 0;
  color: #374151;
  line-height: 1.6;
  white-space: pre-wrap;
}

.summary-meta {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: #6b7280;
}

.content-text {
  margin: 0;
  padding: 0.75rem;
  border-radius: 8px;
  background: #fafafa;
  border: 1px solid #e5e7eb;
  white-space: pre-wrap;
  color: #1f2937;
  min-height: 360px;
  max-height: 520px;
  overflow: auto;
}

@media (max-width: 900px) {
  .chapter-layout {
    grid-template-columns: 1fr;
  }

  .chapter-sidebar {
    border-right: none;
    border-bottom: 1px solid #e5e7eb;
  }
}
</style>
