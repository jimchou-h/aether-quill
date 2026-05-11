<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  submitting: boolean;
}>();

const emit = defineEmits<{
  submit: [
    payload: {
      chapterNo: number;
      title: string;
      content: string;
    },
  ];
}>();

const chapterNo = ref(1);
const title = ref('');
const content = ref('');
const localError = ref('');

function handleSubmit() {
  const normalizedTitle = title.value.trim();
  const normalizedContent = content.value.trim();
  const normalizedChapterNo = Number(chapterNo.value);

  if (!Number.isFinite(normalizedChapterNo) || normalizedChapterNo <= 0) {
    localError.value = '章节号必须为正整数';
    return;
  }
  if (!normalizedTitle) {
    localError.value = '请填写章节标题';
    return;
  }
  if (!normalizedContent) {
    localError.value = '请填写章节正文';
    return;
  }

  localError.value = '';
  emit('submit', {
    chapterNo: normalizedChapterNo,
    title: normalizedTitle,
    content: normalizedContent,
  });
}

function resetForm() {
  chapterNo.value = 1;
  title.value = '';
  content.value = '';
  localError.value = '';
}

defineExpose({
  resetForm,
});
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">加入之前写的章节</h3>
    <p class="panel-subtitle">可将历史章节补录到当前项目，保存后会自动生成摘要。</p>

    <p v-if="localError" class="message message-error">{{ localError }}</p>

    <form class="form" @submit.prevent="handleSubmit">
      <div class="field-row">
        <div class="field-group field-group-small">
          <label class="field-label">章节号</label>
          <input v-model.number="chapterNo" class="field-input" type="number" min="1" />
        </div>
        <div class="field-group field-group-large">
          <label class="field-label">章节标题</label>
          <input
            v-model="title"
            class="field-input"
            type="text"
            placeholder="例如：第1章 雾港夜巡"
          />
        </div>
      </div>

      <div class="field-group">
        <label class="field-label">章节正文</label>
        <textarea v-model="content" class="field-textarea" placeholder="粘贴此前写好的正文内容" />
      </div>

      <button class="primary-button" type="submit" :disabled="props.submitting">
        {{ props.submitting ? '保存中...' : '保存章节' }}
      </button>
    </form>
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
  margin: 0 0 0.4rem;
  font-size: 1rem;
}

.panel-subtitle {
  margin: 0 0 1rem;
  color: #6b7280;
  font-size: 0.85rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.field-row {
  display: flex;
  gap: 0.8rem;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-group-small {
  flex: 0 0 120px;
}

.field-group-large {
  flex: 1;
}

.field-label {
  font-size: 0.8rem;
  color: #6b7280;
}

.field-input,
.field-textarea {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  font: inherit;
}

.field-textarea {
  min-height: 170px;
  resize: vertical;
}

.primary-button {
  align-self: flex-start;
  background: #111827;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
}

.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.message {
  margin: 0 0 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  font-size: 0.85rem;
}

.message-error {
  background: #fef2f2;
  color: #991b1b;
}
</style>
