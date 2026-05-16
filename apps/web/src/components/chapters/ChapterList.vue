<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import type { ChapterItem, ChapterStructuredInfo } from '../../services/api';

const props = defineProps<{
  chapters: ChapterItem[];
  loading: boolean;
  selectedChapterNo: number | null;
  summarizingChapterNo: number | null;
  generatingRelationChapterNo: number | null;
  optimizingChapterNo: number | null;
  savingChapterNo: number | null;
  parsingStructuredChapterNo: number | null;
}>();

const emit = defineEmits<{
  select: [chapterNo: number];
  summarize: [chapterNo: number];
  generateRelationEvents: [chapterNo: number];
  optimize: [chapter: ChapterItem];
  save: [payload: { chapterNo: number; title: string; content: string }];
  parseStructured: [chapterNo: number];
}>();

const editingChapterNo = ref<number | null>(null);
const editTitle = ref('');
const editContent = ref('');
const localError = ref('');
const searchQuery = ref('');
const jumpToChapterNo = ref('');
const chapterTabsRef = ref<HTMLElement | null>(null);

const selectedChapter = computed(
  () => props.chapters.find((chapter) => chapter.chapterNo === props.selectedChapterNo) ?? null
);

const filteredChapters = computed(() => {
  if (!searchQuery.value.trim()) {
    return props.chapters;
  }
  const query = searchQuery.value.toLowerCase();
  return props.chapters.filter(
    (chapter) =>
      chapter.title.toLowerCase().includes(query) || chapter.chapterNo.toString().includes(query)
  );
});

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

function hasStructuredPanel(info: ChapterStructuredInfo | undefined) {
  if (!info) {
    return false;
  }
  return Boolean(
    info.matchingText?.trim() ||
    (info.keywords && info.keywords.length > 0) ||
    info.narrativeSummary?.trim()
  );
}

function structuredParseSourceLabel(source?: ChapterStructuredInfo['parseSource']) {
  if (source === 'workbench') {
    return '写作工作台';
  }
  if (source === 'chapter') {
    return '章节正文';
  }
  return '';
}

function isEditing(chapterNo: number) {
  return editingChapterNo.value === chapterNo;
}

function isBusy(chapterNo: number) {
  return (
    props.summarizingChapterNo === chapterNo ||
    props.generatingRelationChapterNo === chapterNo ||
    props.optimizingChapterNo === chapterNo ||
    props.savingChapterNo === chapterNo ||
    props.parsingStructuredChapterNo === chapterNo ||
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

function handleJumpToChapter() {
  const chapterNo = parseInt(jumpToChapterNo.value, 10);
  if (isNaN(chapterNo)) {
    localError.value = '请输入有效的章节号';
    return;
  }
  const maxChapterNo = props.chapters.length;
  const validChapterNo = Math.max(1, Math.min(chapterNo, maxChapterNo));
  jumpToChapterNo.value = '';
  localError.value = '';
  emit('select', validChapterNo);
}

function scrollToSelectedChapter() {
  nextTick(() => {
    if (chapterTabsRef.value && props.selectedChapterNo !== null) {
      const activeTab = chapterTabsRef.value.querySelector('.chapter-tab.active');
      if (activeTab) {
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });
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
    if (nextChapterNo !== null) {
      scrollToSelectedChapter();
    }
  }
);

watch(
  () => props.chapters,
  () => {
    if (props.selectedChapterNo !== null) {
      scrollToSelectedChapter();
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

      <template v-else>
        <div class="sidebar-controls">
          <div class="search-box">
            <input
              v-model="searchQuery"
              type="text"
              class="search-input"
              placeholder="搜索章节标题..."
            />
            <span v-if="searchQuery" class="search-clear" @click="searchQuery = ''">×</span>
          </div>
          <div class="jump-box">
            <input
              v-model="jumpToChapterNo"
              type="number"
              class="jump-input"
              placeholder="章节号"
              min="1"
              :max="props.chapters.length"
              @keydown.enter="handleJumpToChapter"
            />
            <button class="jump-button" @click="handleJumpToChapter">跳转</button>
          </div>
        </div>

        <p v-if="filteredChapters.length === 0" class="message">
          未找到匹配的章节（共 {{ props.chapters.length }} 章）
        </p>
        <p v-else-if="searchQuery" class="message search-result">
          找到 {{ filteredChapters.length }} 个匹配章节
        </p>

        <div ref="chapterTabsRef" class="chapter-tabs" role="tablist" aria-label="章节列表">
          <button
            v-for="chapter in filteredChapters"
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
      </template>
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
              <button
                class="secondary-button"
                :disabled="isBusy(selectedChapter.chapterNo)"
                @click="emit('optimize', selectedChapter)"
              >
                {{
                  props.optimizingChapterNo === selectedChapter.chapterNo ? '优化中...' : '优化章节'
                }}
              </button>
              <button
                class="secondary-button"
                :disabled="isBusy(selectedChapter.chapterNo)"
                @click="emit('parseStructured', selectedChapter.chapterNo)"
              >
                {{
                  props.parsingStructuredChapterNo === selectedChapter.chapterNo
                    ? '解析中...'
                    : '解析结构化信息'
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

        <section
          v-if="hasStructuredPanel(selectedChapter.structuredInfo)"
          class="chapter-section structured-section"
        >
          <h5 class="section-title">结构化匹配（知识库）</h5>
          <p class="structured-hint text-muted">
            以下用于与知识库「文档标题」匹配与检索，不等同于上方章节摘要。
          </p>

          <div class="structured-block">
            <h6 class="structured-subtitle">匹配文本</h6>
            <p
              v-if="selectedChapter.structuredInfo?.matchingText?.trim()"
              class="summary-text structured-matching"
            >
              {{ selectedChapter.structuredInfo.matchingText }}
            </p>
            <p v-else class="summary-text text-muted">
              暂无匹配文本，可点击上方「解析结构化信息」重新生成。
            </p>
          </div>

          <div v-if="selectedChapter.structuredInfo?.keywords?.length" class="structured-block">
            <h6 class="structured-subtitle">关键词</h6>
            <ul class="keyword-list" aria-label="结构化关键词">
              <li
                v-for="(kw, kwIndex) in selectedChapter.structuredInfo.keywords"
                :key="`${kwIndex}-${kw}`"
                class="keyword-tag"
              >
                {{ kw }}
              </li>
            </ul>
          </div>

          <p
            v-if="
              selectedChapter.structuredInfo?.parsedAt ||
              structuredParseSourceLabel(selectedChapter.structuredInfo?.parseSource)
            "
            class="structured-meta text-muted"
          >
            <template v-if="selectedChapter.structuredInfo?.parsedAt">
              解析于 {{ formatTime(selectedChapter.structuredInfo.parsedAt) }}
            </template>
            <template
              v-if="structuredParseSourceLabel(selectedChapter.structuredInfo?.parseSource)"
            >
              {{ selectedChapter.structuredInfo?.parsedAt ? ' · ' : '' }}来源：{{
                structuredParseSourceLabel(selectedChapter.structuredInfo?.parseSource)
              }}
            </template>
          </p>

          <details
            v-if="selectedChapter.structuredInfo?.narrativeSummary?.trim()"
            class="structured-details"
          >
            <summary>核对用概要（可能与章节摘要表述相近，可展开查看）</summary>
            <p class="summary-text text-muted structured-narrative">
              {{ selectedChapter.structuredInfo.narrativeSummary }}
            </p>
          </details>
        </section>

        <section class="chapter-section">
          <h5 class="section-title">正文</h5>
          <p
            v-if="!selectedChapter.structuredInfo?.matchingText?.trim()"
            class="message message-warn"
          >
            未生成结构化信息，无法匹配知识库。可点击上方「解析结构化信息」基于正文生成。
          </p>
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
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 200px);
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

.message-warn {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  background: #fffbeb;
  color: #92400e;
  border: 1px solid #fde68a;
}

.text-muted {
  color: #6b7280;
}

.structured-section {
  background: #f8fafc;
  border-radius: 8px;
  padding: 0.75rem 0.85rem;
  border: 1px solid #e2e8f0;
}

.structured-hint {
  margin: 0 0 0.65rem;
  font-size: 0.78rem;
  line-height: 1.5;
}

.structured-block {
  margin-top: 0.65rem;
}

.structured-block:first-of-type {
  margin-top: 0;
}

.structured-subtitle {
  margin: 0 0 0.35rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  text-transform: none;
  letter-spacing: 0;
}

.structured-matching {
  margin: 0;
  padding: 0.5rem 0.55rem;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #e2e8f0;
  font-size: 0.85rem;
}

.keyword-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.keyword-tag {
  display: inline-block;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  font-size: 0.75rem;
  color: #334155;
  background: #fff;
  border: 1px solid #cbd5e1;
}

.structured-meta {
  margin: 0.55rem 0 0;
  font-size: 0.72rem;
}

.structured-details {
  margin-top: 0.65rem;
  padding: 0.45rem 0.5rem;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #e2e8f0;
  font-size: 0.8rem;
}

.structured-details summary {
  cursor: pointer;
  color: #475569;
  user-select: none;
}

.structured-details summary:hover {
  color: #1e293b;
}

.structured-narrative {
  margin: 0.45rem 0 0;
  font-size: 0.82rem;
}

.sidebar-controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.8rem;
}

.search-box {
  position: relative;
}

.search-input {
  width: 100%;
  padding: 0.45rem 1.75rem 0.45rem 0.6rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.85rem;
  box-sizing: border-box;
}

.search-clear {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  cursor: pointer;
  color: #6b7280;
  font-size: 1rem;
  line-height: 1;
}

.search-clear:hover {
  color: #1f2937;
}

.jump-box {
  display: flex;
  gap: 0.4rem;
}

.jump-input {
  flex: 1;
  padding: 0.45rem 0.6rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.85rem;
  width: 60px;
}

.jump-button {
  padding: 0.45rem 0.8rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #1f2937;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}

.jump-button:hover {
  background: #f3f4f6;
}

.search-result {
  margin-bottom: 0.5rem;
  font-size: 0.78rem;
  color: #4b5563;
}

.chapter-tabs {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  overflow-y: auto;
  flex: 1;
  padding-right: 2px;
}

.chapter-tabs::-webkit-scrollbar {
  width: 6px;
}

.chapter-tabs::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.chapter-tabs::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.chapter-tabs::-webkit-scrollbar-thumb:hover {
  background: #a1a1a1;
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
