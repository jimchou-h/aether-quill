<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  modelValue: string;
  briefEditedByUser?: boolean;
  busy?: boolean;
  synthesizing?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  save: [];
  resynthesize: [];
}>();

const collapsed = ref(false);

watch(
  () => props.modelValue,
  (value) => {
    if (!props.briefEditedByUser && value.trim()) {
      collapsed.value = false;
    }
  }
);

function onInput(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  emit('update:modelValue', target.value);
}
</script>

<template>
  <section class="brief-panel">
    <div class="brief-head">
      <button class="brief-toggle" type="button" @click="collapsed = !collapsed">
        <span class="brief-title">编辑意向书</span>
        <span class="brief-meta">
          {{ briefEditedByUser ? '已手动编辑' : modelValue.trim() ? 'AI 合成' : '尚未合成' }}
        </span>
        <span class="brief-chevron">{{ collapsed ? '▸' : '▾' }}</span>
      </button>
      <div v-if="!collapsed" class="brief-actions">
        <button
          class="secondary-button"
          type="button"
          :disabled="busy || synthesizing"
          @click="emit('resynthesize')"
        >
          {{ synthesizing ? '合成中…' : '重新合成' }}
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="busy || synthesizing || !modelValue.trim()"
          @click="emit('save')"
        >
          保存意向书
        </button>
      </div>
    </div>
    <p v-if="!collapsed" class="brief-hint">
      改写模型将优先阅读此连贯意向书，而非条目清单。可编辑后保存，或重新合成。
    </p>
    <textarea
      v-show="!collapsed"
      class="brief-textarea"
      :value="modelValue"
      :disabled="busy || synthesizing"
      rows="6"
      placeholder="确认大纲后将自动合成编辑意向书；也可在此粘贴或编辑。"
      @input="onInput"
    />
  </section>
</template>

<style scoped>
.brief-panel {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
}

.brief-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
}

.brief-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
}

.brief-title {
  font-size: 0.95rem;
  font-weight: 600;
}

.brief-meta {
  font-size: 0.78rem;
  color: #6b7280;
}

.brief-chevron {
  font-size: 0.75rem;
  color: #9ca3af;
}

.brief-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.brief-hint {
  margin: 0.5rem 0 0.35rem;
  font-size: 0.8rem;
  color: #6b7280;
  line-height: 1.45;
}

.brief-textarea {
  width: 100%;
  box-sizing: border-box;
  margin-top: 0.35rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.88rem;
  line-height: 1.55;
  resize: vertical;
  font-family: inherit;
}

.brief-textarea:disabled {
  background: #f3f4f6;
  color: #6b7280;
}

.secondary-button,
.primary-button {
  font-size: 0.82rem;
  padding: 0.35rem 0.75rem;
}
</style>
