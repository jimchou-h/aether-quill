<script setup lang="ts">
import type { ChapterItem } from '../../services/api';

const props = defineProps<{
  chapters: ChapterItem[];
  loading: boolean;
  summarizingChapterNo: number | null;
}>();

const emit = defineEmits<{
  summarize: [chapterNo: number];
}>();

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
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">章节列表</h3>

    <p v-if="props.loading" class="message">正在加载章节...</p>
    <p v-else-if="props.chapters.length === 0" class="message">暂无章节，请先新增或导入章节。</p>

    <div v-else class="chapter-list">
      <article v-for="chapter in props.chapters" :key="chapter.chapterNo" class="chapter-card">
        <header class="chapter-header">
          <div class="chapter-heading">
            <h4 class="chapter-title">第{{ chapter.chapterNo }}章 · {{ chapter.title }}</h4>
            <span class="summary-source">{{ summarySourceText(chapter.summarySource) }}</span>
          </div>
          <div class="chapter-actions">
            <span class="chapter-date">更新于 {{ formatTime(chapter.updatedAt) }}</span>
            <button
              class="secondary-button"
              :disabled="props.summarizingChapterNo === chapter.chapterNo"
              @click="emit('summarize', chapter.chapterNo)"
            >
              {{ props.summarizingChapterNo === chapter.chapterNo ? '生成中...' : '生成摘要' }}
            </button>
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
          <pre class="content-text">{{ chapter.content || '暂无正文' }}</pre>
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
  margin: 0;
  color: #6b7280;
  font-size: 0.85rem;
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

.chapter-heading {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
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

.secondary-button {
  background: #fff;
  color: #111827;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.35rem 0.7rem;
  cursor: pointer;
  font-size: 0.8rem;
  white-space: nowrap;
}

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
