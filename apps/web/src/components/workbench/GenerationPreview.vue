<script setup lang="ts">
import type { CitationItem, ConsistencyNote, UsedRelationEventItem } from '../../services/api';

/**
 * 生成预览组件属性定义
 */
defineProps<{
  /** 草稿文本 */
  draftText: string;
  /** 引用证据列表 */
  citations: CitationItem[];
  /** 一致性提示列表 */
  consistencyNotes: ConsistencyNote[];
  /** 本次使用的关系事件 */
  usedRelationEvents: UsedRelationEventItem[];
  /** 是否正在生成 */
  isStreaming: boolean;
  /** 是否生成完成 */
  isDone: boolean;
}>();

/**
 * 组件事件定义
 */
const emit = defineEmits<{
  /** 接受草稿 */
  accept: [];
  /** 重新生成 */
  regenerate: [];
}>();
</script>

<template>
  <section class="generation-preview">
    <div class="panel-heading">
      <h3 class="panel-title">生成结果</h3>
      <p class="panel-description">草稿、引用证据与关系事件会集中展示在这里。</p>
    </div>

    <div v-if="isStreaming" class="streaming-indicator">
      <span class="streaming-dot"></span>
      <span>正在生成...</span>
    </div>

    <div v-if="draftText" class="draft-section">
      <pre class="draft-output">{{ draftText }}</pre>
    </div>

    <div v-if="!draftText && !isStreaming" class="empty-state">
      <p class="empty-title">等待生成</p>
      <p class="empty-copy">输入生成参数后点击「生成章节草稿」，结果将实时显示在此处。</p>
    </div>

    <div v-if="isDone" class="actions">
      <button class="primary-button" @click="emit('accept')">接受草稿</button>
      <button class="secondary-button" @click="emit('regenerate')">重新生成</button>
    </div>

    <div v-if="usedRelationEvents.length > 0" class="citations-section">
      <h4 class="sub-title">本次使用的关系事件</h4>
      <ul class="citation-list">
        <li v-for="event in usedRelationEvents" :key="event.id" class="citation-item">
          <span class="citation-badge">relation-event</span>
          <span class="citation-snippet">
            {{ event.protagonist }} ↔ {{ event.counterparty }} · {{ event.summary }}
          </span>
        </li>
      </ul>
    </div>

    <div v-if="citations.length > 0" class="citations-section">
      <h4 class="sub-title">引用证据</h4>
      <ul class="citation-list">
        <li
          v-for="(citation, index) in citations"
          :key="`${citation.sourceType}-${citation.sourceId}-${index}`"
          class="citation-item"
        >
          <span class="citation-badge">{{ citation.sourceType }}</span>
          <span class="citation-snippet">{{ citation.snippet }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.generation-preview {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 1.35rem;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
}

.panel-heading {
  margin-bottom: 1rem;
}

.panel-title {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
}

.panel-description {
  margin: 0;
  color: #6b7280;
  font-size: 0.9rem;
  line-height: 1.5;
}

.sub-title {
  margin: 0 0 0.5rem;
  font-size: 0.92rem;
  color: #374151;
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
  padding: 0.75rem 0.9rem;
  border-radius: 12px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.92rem;
}

.streaming-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1d4ed8;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 320px;
  padding: 2rem 1.5rem;
  border-radius: 14px;
  border: 1px dashed #d1d5db;
  background: #f8fafc;
  text-align: center;
}

.empty-title {
  margin: 0;
  color: #374151;
  font-size: 1rem;
  font-weight: 600;
}

.empty-copy {
  margin: 0;
  max-width: 24rem;
  color: #6b7280;
  font-size: 0.92rem;
  line-height: 1.6;
}

.draft-section {
  margin-bottom: 1rem;
}

.draft-output {
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 1.1rem 1.15rem;
  background: #f8fafc;
  white-space: pre-wrap;
  line-height: 1.8;
  font-size: 0.98rem;
  font-family: inherit;
  min-height: 360px;
  max-height: min(72vh, 760px);
  overflow-y: auto;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.primary-button {
  border: none;
  background: #1d4ed8;
  color: #fff;
  border-radius: 10px;
  padding: 0.65rem 1rem;
  cursor: pointer;
  font-size: 0.92rem;
}

.primary-button:hover {
  background: #2563eb;
}

.secondary-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  border-radius: 10px;
  padding: 0.65rem 1rem;
  cursor: pointer;
  font-size: 0.92rem;
}

.secondary-button:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.citations-section {
  border-top: 1px solid #e5e7eb;
  padding-top: 1rem;
  margin-top: 0.25rem;
}

.citation-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.citation-item {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  font-size: 0.88rem;
  color: #4b5563;
  line-height: 1.55;
}

.citation-badge {
  flex-shrink: 0;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.75rem;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  font-weight: 500;
}

.citation-snippet {
  word-break: break-word;
}
</style>
