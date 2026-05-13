<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { apiClient } from '../../services/api';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';

const props = defineProps<{
  projectId: string;
}>();

const outlineSummary = ref('');
const savedSummary = ref('');
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const message = ref('');

const isDirty = computed(() => outlineSummary.value !== savedSummary.value);

async function loadOutline() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const knowledge = await apiClient.getKnowledge(props.projectId);
    outlineSummary.value = knowledge.outlineSummary;
    savedSummary.value = knowledge.outlineSummary;
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载大纲摘要失败');
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const knowledge = await apiClient.updateOutline(props.projectId, {
      outlineSummary: outlineSummary.value,
    });
    outlineSummary.value = knowledge.outlineSummary;
    savedSummary.value = knowledge.outlineSummary;
    message.value = presentSuccess('大纲摘要已保存');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '保存大纲摘要失败');
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.projectId,
  () => {
    void loadOutline();
  }
);

onMounted(() => {
  void loadOutline();
});
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">大纲摘要（outlineSummary）</h3>
    <p class="field-hint">维护项目级故事走向与关键设定，写作与检索链路会引用该摘要。</p>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>
    <p v-if="loading" class="message">正在加载大纲摘要...</p>

    <template v-if="!loading">
      <div class="meta-bar">
        <span class="char-count">已输入 {{ outlineSummary.length }} 字</span>
        <span v-if="isDirty" class="dirty-badge">未保存</span>
      </div>

      <textarea
        v-model="outlineSummary"
        class="field-textarea"
        placeholder="例如：主线围绕旧港口失踪案展开，主角需在导师与旧同事之间重建信任。"
        rows="8"
      />

      <div class="action-bar">
        <button
          class="primary-button"
          type="button"
          :disabled="saving || !isDirty"
          @click="handleSave"
        >
          {{ saving ? '保存中...' : '保存大纲摘要' }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fff;
}

.panel-title {
  margin-bottom: 0.35rem;
  font-size: 1rem;
}

.field-hint {
  color: #9ca3af;
  font-size: 0.8rem;
  margin-bottom: 0.75rem;
}

.meta-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.char-count {
  font-size: 0.8rem;
  color: #9ca3af;
}

.dirty-badge {
  font-size: 0.75rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: #fffaeb;
  color: #b54708;
  font-weight: 600;
}

.field-textarea {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.6rem;
  font-size: 0.9rem;
  font-family: inherit;
  resize: vertical;
  min-height: 180px;
  margin-bottom: 0.75rem;
  line-height: 1.6;
}

.field-textarea:focus {
  outline: none;
  border-color: #1d4ed8;
  box-shadow: 0 0 0 2px rgba(29, 78, 216, 0.1);
}

.action-bar {
  display: flex;
  gap: 0.5rem;
}

.primary-button {
  border-radius: 6px;
  padding: 0.45rem 0.8rem;
  font-size: 0.85rem;
  cursor: pointer;
  border: none;
  background: #1d4ed8;
  color: #fff;
}

.primary-button:hover {
  background: #2563eb;
}

.primary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.message {
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
}

.message-ok {
  color: #027a48;
}

.message-error {
  color: #b42318;
}
</style>
