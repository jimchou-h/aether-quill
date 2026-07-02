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
</style>
