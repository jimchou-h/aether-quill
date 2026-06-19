<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PreviewRetrievalItem, PreviewRetrievalResult } from '../../services/api';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    loading: boolean;
    result: PreviewRetrievalResult | null;
    errorMessage?: string;
    /** 嵌套在其他 Modal 之上时需更高层级（默认 1200，高于 antd Modal 默认 1000） */
    zIndex?: number;
  }>(),
  {
    zIndex: 1200,
  }
);

const emit = defineEmits<{
  close: [];
  confirm: [selectedIds: string[]];
}>();

const selectedIds = ref<Set<string>>(new Set());

const poolLabels: Record<PreviewRetrievalItem['pool'], string> = {
  prior_chapter_tail: '前章衔接（章末正文）',
  persona_snapshots: '人物当前快照（着装 + 状态）',
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

function setItemSelected(id: string, selected: boolean) {
  const next = new Set(selectedIds.value);
  if (selected) {
    next.add(id);
  } else {
    next.delete(id);
  }
  selectedIds.value = next;
}

function handleConfirm() {
  emit('confirm', [...selectedIds.value]);
}
</script>

<template>
  <a-modal
    :open="visible"
    :z-index="zIndex"
    title="检索预览"
    :width="800"
    ok-text="确认并生成"
    cancel-text="取消"
    :confirm-loading="loading"
    :ok-button-props="{ disabled: loading || !!errorMessage }"
    @ok="handleConfirm"
    @cancel="emit('close')"
  >
    <p class="dialog-subtitle">
      已勾选条目将注入生成上下文。标题匹配但超出 Token 预算的条目会默认不勾选。
    </p>

    <a-spin v-if="loading" tip="正在执行检索预览..." />
    <a-alert v-else-if="errorMessage" type="error" :message="errorMessage" show-icon />

    <template v-else-if="result">
      <p class="token-report">Token 预算 {{ result.tokenUsed }} / {{ result.tokenBudget }}</p>

      <div v-for="[pool, items] in groupedItems" :key="pool" class="pool-group">
        <h4 class="pool-title">{{ poolLabels[pool] }}</h4>
        <a-checkbox
          v-for="item in items"
          :key="item.id"
          :checked="selectedIds.has(item.id)"
          class="preview-item"
          @update:checked="(checked: boolean) => setItemSelected(item.id, checked)"
        >
          <span class="preview-body">
            <strong>{{ item.title }}</strong>
            <span v-if="typeof item.meta?.canonicalCharacter === 'string'" class="canonical-name">
              主名 {{ item.meta.canonicalCharacter }}
            </span>
            <span v-if="item.score != null" class="score">分数 {{ item.score.toFixed(3) }}</span>
            <span v-if="item.meta?.excludedByTokenBudget" class="budget-hint">
              已匹配，超出 Token 预算未注入
            </span>
            <p class="preview-text">{{ item.preview }}</p>
          </span>
        </a-checkbox>
      </div>
    </template>
  </a-modal>
</template>

<style scoped>
.dialog-subtitle {
  color: #6b7280;
  font-size: 0.9rem;
  margin: 0 0 1rem;
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
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin-bottom: 0.5rem;
}

.preview-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.canonical-name {
  font-size: 0.75rem;
  color: var(--aq-primary);
}

.score {
  font-size: 0.75rem;
  color: #6b7280;
}

.budget-hint {
  font-size: 0.75rem;
  color: #b45309;
}

.preview-text {
  font-size: 0.85rem;
  color: #4b5563;
  white-space: pre-wrap;
}

</style>
