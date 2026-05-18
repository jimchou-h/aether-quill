<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PreviewRetrievalItem, PreviewRetrievalResult } from '../../services/api';

const props = defineProps<{
  visible: boolean;
  loading: boolean;
  result: PreviewRetrievalResult | null;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [selectedIds: string[]];
}>();

const selectedIds = ref<Set<string>>(new Set());

const poolLabels: Record<PreviewRetrievalItem['pool'], string> = {
  persona_card: '角色卡（整文）',
  other_docs: '其他文档（段落裁剪）',
  recent_chapters: '近期章节摘要',
  memory_chapters: '语义记忆章节',
};

const groupedItems = computed(() => {
  const groups = new Map<PreviewRetrievalItem['pool'], PreviewRetrievalItem[]>();
  for (const item of props.result?.items ?? []) {
    const list = groups.get(item.pool) ?? [];
    list.push(item);
    groups.set(item.pool, list);
  }
  return groups;
});

watch(
  () => props.result,
  (result) => {
    selectedIds.value = new Set((result?.items ?? []).filter((i) => i.selected).map((i) => i.id));
  },
  { immediate: true }
);

function toggleItem(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedIds.value = next;
}

function handleConfirm() {
  emit('confirm', [...selectedIds.value]);
}
</script>

<template>
  <div v-if="visible" class="overlay" role="dialog" aria-modal="true" aria-labelledby="retrieval-preview-title">
    <div class="dialog" @click.stop>
      <header class="dialog-header">
        <h3 id="retrieval-preview-title">检索预览</h3>
        <p class="dialog-subtitle">确认将注入生成上下文的条目，可取消勾选不需要的内容。</p>
      </header>

      <p v-if="loading" class="message">正在执行检索预览...</p>
      <p v-else-if="errorMessage" class="message message-error">{{ errorMessage }}</p>

      <template v-else-if="result">
        <p class="token-report">
          Token 预算 {{ result.tokenUsed }} / {{ result.tokenBudget }}
        </p>

        <div v-for="[pool, items] in groupedItems" :key="pool" class="pool-group">
          <h4 class="pool-title">{{ poolLabels[pool] }}</h4>
          <label v-for="item in items" :key="item.id" class="preview-item">
            <input
              type="checkbox"
              :checked="selectedIds.has(item.id)"
              @change="toggleItem(item.id)"
            />
            <span class="preview-body">
              <strong>{{ item.title }}</strong>
              <span v-if="item.score != null" class="score">分数 {{ item.score.toFixed(3) }}</span>
              <p class="preview-text">{{ item.preview }}</p>
            </span>
          </label>
        </div>
      </template>

      <footer class="dialog-footer">
        <button type="button" class="ghost-button" @click="emit('close')">取消</button>
        <button
          type="button"
          class="primary-button"
          :disabled="loading || !!errorMessage"
          @click="handleConfirm"
        >
          确认并生成
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.dialog {
  width: min(720px, 100%);
  max-height: 85vh;
  overflow: auto;
  background: #fff;
  border-radius: 12px;
  padding: 1.25rem;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2);
}

.dialog-header {
  margin-bottom: 1rem;
}

.dialog-subtitle {
  color: #6b7280;
  font-size: 0.9rem;
  margin-top: 0.25rem;
}

.token-report {
  font-size: 0.85rem;
  color: #374151;
  margin-bottom: 0.75rem;
}

.pool-group {
  margin-bottom: 1rem;
}

.pool-title {
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
  color: #111827;
}

.preview-item {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin-bottom: 0.5rem;
  cursor: pointer;
}

.preview-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.score {
  font-size: 0.75rem;
  color: #6b7280;
}

.preview-text {
  font-size: 0.85rem;
  color: #4b5563;
  white-space: pre-wrap;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

.message {
  margin: 0.5rem 0;
}

.message-error {
  color: #b42318;
}

.primary-button,
.ghost-button {
  padding: 0.45rem 0.9rem;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
}

.primary-button {
  border: none;
  background: #2563eb;
  color: #fff;
}

.primary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ghost-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
}
</style>
