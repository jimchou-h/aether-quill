<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { apiClient, type WritingStyleSampleSceneType } from '../../services/api';
import AppModal from '../common/AppModal.vue';
import {
  WRITING_STYLE_SAMPLE_MAX_CHARS,
  WRITING_STYLE_SAMPLE_MIN_CHARS,
  WRITING_STYLE_SCENE_TYPE_OPTIONS,
  validateWritingStyleSampleText,
} from '../../constants/writingStyleSamples';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';

const props = defineProps<{
  open: boolean;
  projectId: string;
  chapterNo?: number;
  initialText?: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const saving = ref(false);
const errorMessage = ref('');
const text = ref('');
const sceneType = ref<WritingStyleSampleSceneType>('dialogue');
const label = ref('');

const charCount = computed(() => text.value.trim().length);
const textValidation = computed(() => validateWritingStyleSampleText(text.value));

watch(
  () => [props.open, props.initialText] as const,
  ([open, initialText]) => {
    if (!open) {
      return;
    }
    errorMessage.value = '';
    text.value = typeof initialText === 'string' ? initialText.trim() : '';
    sceneType.value = 'dialogue';
    label.value = '';
  },
  { immediate: true }
);

function closeModal() {
  if (saving.value) {
    return;
  }
  emit('close');
}

async function handleSubmit() {
  const validation = textValidation.value;
  if (validation) {
    errorMessage.value = validation;
    return;
  }
  saving.value = true;
  errorMessage.value = '';
  try {
    await apiClient.createWritingStyleSample(props.projectId, {
      text: text.value.trim(),
      sceneType: sceneType.value,
      ...(props.chapterNo && props.chapterNo > 0 ? { sourceChapterNo: props.chapterNo } : {}),
      ...(label.value.trim() ? { label: label.value.trim() } : {}),
    });
    presentSuccess('已保存文风样本');
    emit('saved');
    emit('close');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '保存文风样本失败');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal
    :open="open"
    title="标为文风样本"
    subtitle="保存满意段落作语感参照；写作任务将自动注入 1~2 条匹配样本，不复用情节与意象。"
    title-id="style-sample-capture-title"
    width="min(720px, 100%)"
    @close="closeModal"
  >
    <form class="sample-form" @submit.prevent="handleSubmit">
      <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>

      <label class="field-label">
        场景类型
        <select v-model="sceneType" class="field-input">
          <option
            v-for="option in WRITING_STYLE_SCENE_TYPE_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="field-label">
        备注（可选）
        <input v-model="label" class="field-input" maxlength="80" placeholder="如：对白节奏参考" />
      </label>

      <label class="field-label">
        样本文本
        <span class="field-hint">
          {{ charCount }} / {{ WRITING_STYLE_SAMPLE_MAX_CHARS }} 字（至少
          {{ WRITING_STYLE_SAMPLE_MIN_CHARS }} 字）
        </span>
        <textarea
          v-model="text"
          class="field-textarea"
          rows="10"
          :maxlength="WRITING_STYLE_SAMPLE_MAX_CHARS"
          placeholder="粘贴或保留当前选中的正文段落"
        />
      </label>
      <p v-if="chapterNo && chapterNo > 0" class="field-hint">来源章节：第 {{ chapterNo }} 章</p>
    </form>

    <template #footer>
      <button class="secondary-button" type="button" :disabled="saving" @click="closeModal">
        取消
      </button>
      <button
        class="primary-button"
        type="button"
        :disabled="saving || Boolean(textValidation)"
        @click="handleSubmit"
      >
        {{ saving ? '保存中...' : '保存样本' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.sample-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.9rem;
  color: #374151;
}

.field-hint {
  font-size: 0.8rem;
  color: #6b7280;
}

.field-input,
.field-textarea {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  font: inherit;
}

.field-textarea {
  resize: vertical;
  min-height: 180px;
  line-height: 1.6;
}

.message-error {
  margin: 0;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  background: #fef2f2;
  color: #b91c1c;
}
</style>
