<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { apiClient, type ProjectSettings } from '../../services/api';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';

const props = defineProps<{
  projectId: string;
}>();

const summaryCount = ref(3);
const memoryCount = ref(3);
const priorTailChars = ref(800);
const excerptMaxChars = ref(400);
const temperature = ref(0.7);
const updatePersonaOnSave = ref(true);
const generateRelationEventsOnSave = ref(true);
const saved = ref<{
  summaryCount: number;
  memoryCount: number;
  priorTailChars: number;
  excerptMaxChars: number;
  temperature: number;
  updatePersonaOnSave: boolean;
  generateRelationEventsOnSave: boolean;
} | null>(null);

const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const message = ref('');

const isDirty = computed(() => {
  if (!saved.value) {
    return false;
  }
  return (
    summaryCount.value !== saved.value.summaryCount ||
    memoryCount.value !== saved.value.memoryCount ||
    priorTailChars.value !== saved.value.priorTailChars ||
    excerptMaxChars.value !== saved.value.excerptMaxChars ||
    temperature.value !== saved.value.temperature ||
    updatePersonaOnSave.value !== saved.value.updatePersonaOnSave ||
    generateRelationEventsOnSave.value !== saved.value.generateRelationEventsOnSave
  );
});

function applyFromSettings(s: ProjectSettings) {
  summaryCount.value = s.chapterSummaryPromptCount;
  memoryCount.value =
    (s as { chapterSummaryMemoryCount?: number }).chapterSummaryMemoryCount ?? 3;
  priorTailChars.value = (s as { priorChapterTailChars?: number }).priorChapterTailChars ?? 800;
  excerptMaxChars.value = (s as { contextExcerptMaxChars?: number }).contextExcerptMaxChars ?? 400;
  temperature.value = s.generationTemperature;
  updatePersonaOnSave.value = s.updatePersonaOnSave ?? true;
  generateRelationEventsOnSave.value = s.generateRelationEventsOnSave ?? true;
  saved.value = {
    summaryCount: s.chapterSummaryPromptCount,
    memoryCount:
      (s as { chapterSummaryMemoryCount?: number }).chapterSummaryMemoryCount ?? 3,
    priorTailChars: (s as { priorChapterTailChars?: number }).priorChapterTailChars ?? 800,
    excerptMaxChars: (s as { contextExcerptMaxChars?: number }).contextExcerptMaxChars ?? 400,
    temperature: s.generationTemperature,
    updatePersonaOnSave: s.updatePersonaOnSave ?? true,
    generateRelationEventsOnSave: s.generateRelationEventsOnSave ?? true,
  };
}

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const s = await apiClient.getSettings(props.projectId);
    applyFromSettings(s);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载生成偏好失败');
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const s = await apiClient.updateSettings(props.projectId, {
      chapterSummaryPromptCount: summaryCount.value,
      chapterSummaryMemoryCount: memoryCount.value,
      priorChapterTailChars: priorTailChars.value,
      contextExcerptMaxChars: excerptMaxChars.value,
      generationTemperature: temperature.value,
      updatePersonaOnSave: updatePersonaOnSave.value,
      generateRelationEventsOnSave: generateRelationEventsOnSave.value,
    });
    applyFromSettings(s);
    message.value = presentSuccess('生成偏好已保存');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '保存生成偏好失败');
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.projectId,
  () => {
    void load();
  }
);

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">生成偏好</h3>
    <p class="field-hint">
      「摘要数」决定叙事上下文中注入多少条<strong>当前章节之前</strong>的章节摘要（按章号从新到旧）；设为
      0 则不注入摘要段。「温度」作用于章节流式生成等主链路（也可在单次请求中覆盖）。
    </p>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>
    <p v-if="loading" class="message">正在加载生成偏好...</p>

    <template v-if="!loading">
      <div class="row">
        <label class="field-label" for="aq-summary-count">Prompt 携带章节摘要数</label>
        <input
          id="aq-summary-count"
          v-model.number="summaryCount"
          class="field-input"
          type="number"
          min="0"
          max="10"
          step="1"
        />
      </div>
      <p class="field-hint inline-hint">
        范围 0~10；默认 3。选取「章号 &lt; 当前写作章节」的章节；无摘要时使用正文摘录降级（近期连续性池）。
      </p>

      <div class="row">
        <label class="field-label" for="aq-memory-count">语义记忆章节数</label>
        <input
          id="aq-memory-count"
          v-model.number="memoryCount"
          class="field-input"
          type="number"
          min="0"
          max="10"
          step="1"
        />
      </div>
      <p class="field-hint inline-hint">范围 0~10；默认 3。对历史章节摘要做向量检索的相关条数。</p>

      <div class="row">
        <label class="field-label" for="aq-prior-tail">前章衔接字数</label>
        <input
          id="aq-prior-tail"
          v-model.number="priorTailChars"
          class="field-input"
          type="number"
          min="0"
          max="2000"
          step="50"
        />
      </div>
      <p class="field-hint inline-hint">
        写第 N 章时注入第 N-1 章正文末尾字符数；范围 0~2000，默认 800。0 表示关闭（不推荐）。
      </p>

      <div class="row">
        <label class="field-label" for="aq-excerpt-max">无摘要摘录字数</label>
        <input
          id="aq-excerpt-max"
          v-model.number="excerptMaxChars"
          class="field-input"
          type="number"
          min="200"
          max="800"
          step="50"
        />
      </div>
      <p class="field-hint inline-hint">
        前序章节无摘要时，从正文尾部截取的 excerpt 长度；范围 200~800，默认 400。
      </p>

      <div class="row">
        <label class="field-label" for="aq-temperature">生成温度（temperature）</label>
        <input
          id="aq-temperature"
          v-model.number="temperature"
          class="field-input"
          type="number"
          min="0"
          max="2"
          step="0.05"
        />
      </div>
      <p class="field-hint inline-hint">范围 0~2；默认 0.7。数值越高，模型输出越发散。</p>

      <div class="toggle-row">
        <label class="toggle-label">
          <input v-model="updatePersonaOnSave" type="checkbox" class="toggle-checkbox" />
          <span class="toggle-text">保存章节时自动更新人物出场状态</span>
        </label>
      </div>

      <div class="toggle-row">
        <label class="toggle-label">
          <input v-model="generateRelationEventsOnSave" type="checkbox" class="toggle-checkbox" />
          <span class="toggle-text">保存章节时自动生成关系事件</span>
        </label>
      </div>

      <div class="meta-bar">
        <span v-if="isDirty" class="dirty-badge">未保存</span>
      </div>

      <div class="action-bar">
        <button
          class="primary-button"
          type="button"
          :disabled="saving || !isDirty"
          @click="handleSave"
        >
          {{ saving ? '保存中...' : '保存生成偏好' }}
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

.inline-hint {
  margin-top: -0.35rem;
  margin-bottom: 0.75rem;
}

.message {
  margin-bottom: 0.75rem;
}

.message-ok {
  color: #027a48;
}

.message-error {
  color: #b42318;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.35rem;
}

.field-label {
  min-width: 11rem;
  font-size: 0.9rem;
  color: #374151;
}

.field-input {
  width: 8rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.95rem;
}

.meta-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0;
}

.dirty-badge {
  font-size: 0.75rem;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
}

.action-bar {
  display: flex;
  gap: 0.5rem;
}

.toggle-row {
  display: flex;
  align-items: center;
  margin-bottom: 0.35rem;
}

.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
  user-select: none;
}

.toggle-checkbox {
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: #111827;
}

.toggle-text {
  font-size: 0.9rem;
  color: #374151;
}

.primary-button {
  padding: 0.45rem 0.9rem;
  border-radius: 6px;
  border: none;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  font-size: 0.9rem;
}

.primary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
