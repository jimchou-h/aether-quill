<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { renderMarkdownToSafeHtml } from '../../utils/renderMarkdown';

const props = withDefaults(
  defineProps<{
    source: string;
    throttleMs?: number;
  }>(),
  {
    throttleMs: 200,
  }
);

const renderedHtml = ref('');
let throttleTimer: ReturnType<typeof setTimeout> | null = null;

function flushRender() {
  renderedHtml.value = renderMarkdownToSafeHtml(props.source);
}

watch(
  () => props.source,
  () => {
    if (props.throttleMs <= 0) {
      flushRender();
      return;
    }
    if (throttleTimer) {
      clearTimeout(throttleTimer);
    }
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      flushRender();
    }, props.throttleMs);
  },
  { immediate: true }
);

const isEmpty = computed(() => !props.source.trim());
</script>

<template>
  <div v-if="isEmpty" class="markdown-content markdown-content--empty">
    <slot name="empty">暂无内容</slot>
  </div>
  <!-- eslint-disable-next-line vue/no-v-html -- sanitized via renderMarkdownToSafeHtml -->
  <div v-else class="markdown-content" v-html="renderedHtml" />
</template>

<style scoped>
.markdown-content {
  line-height: 1.7;
  color: #1f2937;
  word-break: break-word;
}

.markdown-content--empty {
  color: #9ca3af;
  font-size: 0.9rem;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 0.75rem 0 0.5rem;
  font-weight: 600;
  line-height: 1.35;
}

.markdown-content :deep(h1) {
  font-size: 1.25rem;
}

.markdown-content :deep(h2) {
  font-size: 1.12rem;
}

.markdown-content :deep(h3) {
  font-size: 1.02rem;
}

.markdown-content :deep(p) {
  margin: 0.45rem 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0.45rem 0 0.45rem 1.25rem;
  padding: 0;
}

.markdown-content :deep(li) {
  margin: 0.2rem 0;
}

.markdown-content :deep(code) {
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  background: #f3f4f6;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
}

.markdown-content :deep(strong) {
  font-weight: 600;
}

.markdown-content :deep(blockquote) {
  margin: 0.5rem 0;
  padding: 0.1rem 0.7rem;
  border-left: 3px solid #d1d5db;
  color: #4b5563;
}

.markdown-content :deep(pre) {
  margin: 0.5rem 0;
  padding: 0.55rem 0.7rem;
  border-radius: 6px;
  background: #f3f4f6;
  overflow-x: auto;
}

.markdown-content :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 0.86em;
  white-space: pre;
}

.markdown-content :deep(hr) {
  margin: 0.75rem 0;
  border: none;
  border-top: 1px solid #e5e7eb;
}

.markdown-content :deep(table) {
  margin: 0.5rem 0;
  border-collapse: collapse;
  width: 100%;
  font-size: 0.92em;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 0.25rem 0.5rem;
  border: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: top;
}

.markdown-content :deep(th) {
  background: #f9fafb;
  font-weight: 600;
}
</style>
