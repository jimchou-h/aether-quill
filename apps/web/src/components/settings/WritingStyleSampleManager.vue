<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  apiClient,
  type WritingStyleSample,
  type WritingStyleSampleSceneType,
} from '../../services/api';
import AppModal from '../common/AppModal.vue';
import {
  WRITING_STYLE_SAMPLE_MAX_CHARS,
  WRITING_STYLE_SAMPLE_MIN_CHARS,
  WRITING_STYLE_SAMPLES_MAX_PER_PROJECT,
  WRITING_STYLE_SCENE_TYPE_OPTIONS,
  summarizeWritingStyleSampleText,
  validateWritingStyleSampleText,
  writingStyleSceneTypeLabel,
} from '../../constants/writingStyleSamples';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';

const props = defineProps<{
  projectId: string;
}>();

const loading = ref(false);
const saving = ref(false);
const showFormModal = ref(false);
const errorMessage = ref('');
const message = ref('');
const samples = ref<WritingStyleSample[]>([]);
const editingSampleId = ref<string | null>(null);

const form = ref({
  text: '',
  sceneType: 'dialogue' as WritingStyleSampleSceneType,
  sourceChapterNo: null as number | null,
  label: '',
});

const modalTitle = computed(() => (editingSampleId.value ? '编辑文风样本' : '新增文风样本'));
const modalSubtitle = computed(() =>
  editingSampleId.value
    ? '更新后，后续写作类任务将按场景类型重新匹配注入。'
    : '每条样本建议 200~500 字；写作任务最多自动注入 2 条匹配样本。'
);
const charCount = computed(() => form.value.text.trim().length);
const textValidation = computed(() => validateWritingStyleSampleText(form.value.text));
const atCapacity = computed(() => samples.value.length >= WRITING_STYLE_SAMPLES_MAX_PER_PROJECT);

function resetForm() {
  editingSampleId.value = null;
  form.value = {
    text: '',
    sceneType: 'dialogue',
    sourceChapterNo: null,
    label: '',
  };
}

function openCreateModal() {
  if (atCapacity.value) {
    errorMessage.value = `文风样本库已满（最多 ${WRITING_STYLE_SAMPLES_MAX_PER_PROJECT} 条）`;
    return;
  }
  errorMessage.value = '';
  resetForm();
  showFormModal.value = true;
}

function closeFormModal() {
  if (saving.value) {
    return;
  }
  showFormModal.value = false;
  resetForm();
}

async function loadSamples() {
  loading.value = true;
  errorMessage.value = '';
  try {
    samples.value = await apiClient.listWritingStyleSamples(props.projectId);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载文风样本失败');
  } finally {
    loading.value = false;
  }
}

function startEdit(sample: WritingStyleSample) {
  editingSampleId.value = sample.id;
  form.value = {
    text: sample.text,
    sceneType: sample.sceneType,
    sourceChapterNo: sample.sourceChapterNo ?? null,
    label: sample.label ?? '',
  };
  showFormModal.value = true;
}

async function handleSubmit() {
  const validation = textValidation.value;
  if (validation) {
    errorMessage.value = validation;
    return;
  }
  saving.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const payload = {
      text: form.value.text.trim(),
      sceneType: form.value.sceneType,
      sourceChapterNo:
        form.value.sourceChapterNo && form.value.sourceChapterNo > 0
          ? form.value.sourceChapterNo
          : null,
      ...(form.value.label.trim() ? { label: form.value.label.trim() } : {}),
    };
    if (editingSampleId.value) {
      await apiClient.updateWritingStyleSample(props.projectId, editingSampleId.value, payload);
      presentSuccess('文风样本已更新');
    } else {
      await apiClient.createWritingStyleSample(props.projectId, payload);
      presentSuccess('文风样本已创建');
    }
    closeFormModal();
    await loadSamples();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '保存文风样本失败');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(sample: WritingStyleSample) {
  if (!window.confirm('确定删除这条文风样本吗？')) {
    return;
  }
  saving.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.deleteWritingStyleSample(props.projectId, sample.id);
    presentSuccess('文风样本已删除');
    await loadSamples();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '删除文风样本失败');
  } finally {
    saving.value = false;
  }
}

function formatChapterNo(chapterNo?: number) {
  return chapterNo && chapterNo > 0 ? `第 ${chapterNo} 章` : '—';
}

onMounted(() => {
  void loadSamples();
});
</script>

<template>
  <section class="panel">
    <div class="page-toolbar">
      <div>
        <h3 class="panel-title">文风样本库</h3>
        <p class="panel-subtitle">
          标记满意段落作 few-shot 参照；续写、优化与创作精修改写时会按场景自动注入最多 2 条。
        </p>
      </div>
      <button class="primary-button" type="button" :disabled="atCapacity" @click="openCreateModal">
        新增样本
      </button>
    </div>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>

    <div class="table-toolbar">
      <span class="table-count">
        已用 {{ samples.length }} / {{ WRITING_STYLE_SAMPLES_MAX_PER_PROJECT }} 条
      </span>
    </div>

    <p v-if="loading" class="message">正在加载文风样本...</p>
    <p v-else-if="samples.length === 0" class="empty-state">
      暂无文风样本。可在章节正文划词「标为文风样本」，或在此手动粘贴添加。
    </p>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">场景</th>
            <th scope="col">备注</th>
            <th scope="col">来源章节</th>
            <th scope="col">文本摘要</th>
            <th scope="col" class="actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="sample in samples" :key="sample.id">
            <td>{{ writingStyleSceneTypeLabel(sample.sceneType) }}</td>
            <td>{{ sample.label || '—' }}</td>
            <td>{{ formatChapterNo(sample.sourceChapterNo) }}</td>
            <td class="summary-cell" :title="sample.text">
              {{ summarizeWritingStyleSampleText(sample.text) }}
            </td>
            <td class="actions-col">
              <div class="row-actions">
                <button class="table-button" type="button" @click="startEdit(sample)">编辑</button>
                <button class="table-button danger" type="button" @click="handleDelete(sample)">
                  删除
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AppModal
      :open="showFormModal"
      :title="modalTitle"
      :subtitle="modalSubtitle"
      title-id="writing-style-sample-form-title"
      width="min(760px, 100%)"
      @close="closeFormModal"
    >
      <form class="sample-form" @submit.prevent="handleSubmit">
        <div class="form-grid">
          <label class="field-label">
            场景类型
            <select v-model="form.sceneType" class="field-input">
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
            来源章节（可选）
            <input
              v-model.number="form.sourceChapterNo"
              class="field-input"
              type="number"
              min="1"
              placeholder="如 3"
            />
          </label>
        </div>

        <label class="field-label">
          备注（可选）
          <input v-model="form.label" class="field-input" maxlength="80" />
        </label>

        <label class="field-label">
          样本文本
          <span class="field-hint">
            {{ charCount }} / {{ WRITING_STYLE_SAMPLE_MAX_CHARS }} 字（至少
            {{ WRITING_STYLE_SAMPLE_MIN_CHARS }} 字）
          </span>
          <textarea
            v-model="form.text"
            class="field-textarea"
            rows="10"
            :maxlength="WRITING_STYLE_SAMPLE_MAX_CHARS"
          />
        </label>
      </form>

      <template #footer>
        <button class="secondary-button" type="button" :disabled="saving" @click="closeFormModal">
          取消
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="saving || Boolean(textValidation)"
          @click="handleSubmit"
        >
          {{ saving ? '保存中...' : editingSampleId ? '更新样本' : '创建样本' }}
        </button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  padding: 1rem 1.1rem 1.2rem;
  margin-bottom: 1rem;
}

.page-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.panel-title {
  margin: 0;
  font-size: 1rem;
}

.panel-subtitle {
  margin: 0.35rem 0 0;
  color: #6b7280;
  font-size: 0.85rem;
}

.table-toolbar {
  margin: 0.5rem 0 0.75rem;
}

.table-count {
  font-size: 0.85rem;
  color: #6b7280;
}

.message {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: #6b7280;
}

.message-error {
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  background: #fef2f2;
  color: #b91c1c;
}

.message-ok {
  color: #047857;
}

.empty-state {
  margin: 0.75rem 0 0;
  color: #6b7280;
  font-size: 0.9rem;
}

.table-wrap {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.data-table th,
.data-table td {
  border-bottom: 1px solid #e5e7eb;
  padding: 0.55rem 0.45rem;
  text-align: left;
  vertical-align: top;
}

.summary-cell {
  max-width: 360px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actions-col {
  width: 120px;
}

.row-actions {
  display: flex;
  gap: 0.35rem;
}

.table-button {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  padding: 0.2rem 0.45rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.table-button.danger {
  color: #b91c1c;
  border-color: #fecaca;
}

.sample-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
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

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.45rem 0.85rem;
  font-size: 0.88rem;
  cursor: pointer;
}

.primary-button {
  border: 1px solid #2563eb;
  background: #2563eb;
  color: #fff;
}

.secondary-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
}

@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
