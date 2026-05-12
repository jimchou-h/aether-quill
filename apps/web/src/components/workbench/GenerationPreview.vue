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
    <h3 class="panel-title">生成结果</h3>

    <div v-if="isStreaming" class="streaming-indicator">
      <span class="streaming-dot"></span>
      <span>正在生成...</span>
    </div>

    <div v-if="draftText" class="draft-section">
      <pre class="draft-output">{{ draftText }}</pre>
    </div>

    <div v-if="!draftText && !isStreaming" class="empty-state">
      <p>输入生成参数后点击「生成章节草稿」，结果将实时显示在此处。</p>
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
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fff;
}

.panel-title {
  margin-bottom: 0.7rem;
  font-size: 1rem;
}

.sub-title {
  margin-top: 0.85rem;
  margin-bottom: 0.35rem;
  font-size: 0.9rem;
  color: #374151;
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  color: #1d4ed8;
  font-size: 0.9rem;
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
  color: #9ca3af;
  font-size: 0.9rem;
  text-align: center;
  padding: 2rem 0;
}

.draft-section {
  margin-bottom: 0.75rem;
}

.draft-output {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.8rem;
  background: #f8fafc;
  white-space: pre-wrap;
  line-height: 1.7;
  font-size: 0.9rem;
  font-family: inherit;
  max-height: 60vh;
  overflow-y: auto;
}

.actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.primary-button {
  border: none;
  background: #1d4ed8;
  color: #fff;
  border-radius: 6px;
  padding: 0.52rem 0.9rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.primary-button:hover {
  background: #2563eb;
}

.secondary-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  border-radius: 6px;
  padding: 0.52rem 0.9rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.secondary-button:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.citations-section {
  border-top: 1px solid #f3f4f6;
  padding-top: 0.75rem;
}

.citation-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.citation-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #6b7280;
  line-height: 1.4;
}

.citation-badge {
  flex-shrink: 0;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.75rem;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-weight: 500;
}

.citation-snippet {
  word-break: break-all;
}
</style>
