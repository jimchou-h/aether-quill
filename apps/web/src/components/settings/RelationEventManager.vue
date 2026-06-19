<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { apiClient, type PersonaItem, type RelationEventItem } from '../../services/api';
import AppModal from '../common/AppModal.vue';
import { presentSuccess } from '../../utils/pageFeedback';

const props = defineProps<{
  projectId: string;
  personas: PersonaItem[];
}>();

const loading = ref(false);
const saving = ref(false);
const showFormModal = ref(false);
const errorMessage = ref('');
const message = ref('');
const events = ref<RelationEventItem[]>([]);
const keyword = ref('');
const counterparty = ref('');
const chapterNo = ref<number | null>(null);
const editingEventId = ref<string | null>(null);

const protagonistName = computed(
  () =>
    props.personas.find((item) => item.status === 'published')?.name ||
    props.personas[0]?.name ||
    '主角'
);

const form = ref({
  protagonist: protagonistName.value,
  counterparty: '',
  actorsText: '',
  summary: '',
  evidenceSnippet: '',
  chapterNo: null as number | null,
});

const modalTitle = computed(() => (editingEventId.value ? '编辑关系事件' : '新增关系事件'));
const modalSubtitle = computed(() =>
  editingEventId.value
    ? '更新后，写作工作台中的关系事件勾选列表会同步刷新。'
    : '手动维护主角与其他角色之间已发生的事实，写作时可按需勾选注入。'
);

function parseLines(text: string) {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resetForm() {
  editingEventId.value = null;
  form.value = {
    protagonist: protagonistName.value,
    counterparty: '',
    actorsText: '',
    summary: '',
    evidenceSnippet: '',
    chapterNo: null,
  };
}

function openCreateModal() {
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

async function loadEvents() {
  loading.value = true;
  errorMessage.value = '';
  try {
    events.value = await apiClient.getRelationEvents(props.projectId, {
      keyword: keyword.value.trim() || undefined,
      counterparty: counterparty.value.trim() || undefined,
      chapterNo: chapterNo.value && chapterNo.value > 0 ? chapterNo.value : undefined,
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载关系事件失败';
  } finally {
    loading.value = false;
  }
}

function startEdit(event: RelationEventItem) {
  editingEventId.value = event.id;
  form.value = {
    protagonist: event.protagonist,
    counterparty: event.counterparty,
    actorsText: event.actors.join('\n'),
    summary: event.summary,
    evidenceSnippet: event.evidenceSnippet || '',
    chapterNo: event.chapterNo,
  };
  showFormModal.value = true;
}

async function handleSubmit() {
  saving.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const actors = parseLines(form.value.actorsText);
    const payload = {
      protagonist: form.value.protagonist.trim() || protagonistName.value,
      counterparty: form.value.counterparty.trim(),
      actors: actors.length > 0 ? actors : undefined,
      summary: form.value.summary.trim(),
      evidenceSnippet: form.value.evidenceSnippet.trim() || undefined,
      chapterNo: form.value.chapterNo,
    };

    if (editingEventId.value) {
      await apiClient.updateRelationEvent(props.projectId, editingEventId.value, payload);
      message.value = presentSuccess('关系事件已更新');
    } else {
      await apiClient.createRelationEvent(props.projectId, payload);
      message.value = presentSuccess('关系事件已创建');
    }

    showFormModal.value = false;
    resetForm();
    await loadEvents();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存关系事件失败';
  } finally {
    saving.value = false;
  }
}

async function handleDelete(event: RelationEventItem) {
  if (!confirm(`确定删除「${event.summary}」？`)) return;

  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.deleteRelationEvent(props.projectId, event.id);
    if (editingEventId.value === event.id) {
      closeFormModal();
    }
    message.value = presentSuccess('关系事件已删除');
    await loadEvents();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除关系事件失败';
  }
}

function formatChapterNo(value: number | null) {
  return value ? `第${value}章` : '—';
}

onMounted(() => {
  resetForm();
  void loadEvents();
});
</script>

<template>
  <section class="panel">
    <div class="page-toolbar">
      <div>
        <h3 class="panel-title">关系事件库</h3>
        <p class="panel-subtitle">手动维护主角与其他角色之间已发生的事实，写作时可按需勾选注入。</p>
      </div>
      <button class="primary-button" type="button" @click="openCreateModal">新增关系事件</button>
    </div>

    <div class="filter-row">
      <input v-model="keyword" class="field-input" placeholder="搜索摘要/角色" />
      <input v-model="counterparty" class="field-input" placeholder="关联角色" />
      <input
        v-model.number="chapterNo"
        class="field-input"
        type="number"
        min="1"
        placeholder="章节号"
      />
      <button class="secondary-button" type="button" :disabled="loading" @click="loadEvents">
        {{ loading ? '加载中...' : '筛选' }}
      </button>
    </div>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>

    <div class="table-toolbar">
      <span class="table-count">共 {{ events.length }} 条</span>
    </div>

    <p v-if="loading" class="message">正在加载事件...</p>
    <p v-else-if="events.length === 0" class="empty-state">暂无关系事件，请点击右上角新增。</p>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">主角</th>
            <th scope="col">关联角色</th>
            <th scope="col">章节</th>
            <th scope="col">事件摘要</th>
            <th scope="col">涉及角色</th>
            <th scope="col">证据短句</th>
            <th scope="col" class="actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in events" :key="event.id">
            <td class="name-cell">{{ event.protagonist }}</td>
            <td class="name-cell">{{ event.counterparty }}</td>
            <td>{{ formatChapterNo(event.chapterNo) }}</td>
            <td class="summary-cell" :title="event.summary">{{ event.summary }}</td>
            <td class="actors-cell">{{ event.actors.join('、') || '—' }}</td>
            <td class="evidence-cell" :title="event.evidenceSnippet || ''">
              {{ event.evidenceSnippet || '—' }}
            </td>
            <td class="actions-col">
              <div class="row-actions">
                <button class="table-button" type="button" @click="startEdit(event)">编辑</button>
                <button class="table-button danger" type="button" @click="handleDelete(event)">
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
      title-id="relation-event-form-title"
      width="min(760px, 100%)"
      @close="closeFormModal"
    >
      <form class="event-form" @submit.prevent="handleSubmit">
        <div class="form-grid">
          <label class="field-label">
            主角
            <input v-model="form.protagonist" class="field-input" />
          </label>
          <label class="field-label">
            关联角色
            <input v-model="form.counterparty" class="field-input" required />
          </label>
          <label class="field-label">
            章节号
            <input v-model.number="form.chapterNo" class="field-input" type="number" min="1" />
          </label>
        </div>

        <label class="field-label">
          涉及角色（可选，每行一个）
          <textarea
            v-model="form.actorsText"
            class="field-textarea"
            placeholder="留空时默认主角与关联角色"
            rows="3"
          />
        </label>

        <label class="field-label">
          事件摘要
          <textarea v-model="form.summary" class="field-textarea" rows="4" required />
        </label>

        <label class="field-label">
          证据短句（可选）
          <textarea v-model="form.evidenceSnippet" class="field-textarea" rows="3" />
        </label>
      </form>

      <template #footer>
        <button class="secondary-button" type="button" :disabled="saving" @click="closeFormModal">
          取消
        </button>
        <button class="primary-button" type="button" :disabled="saving" @click="handleSubmit">
          {{ saving ? '保存中...' : editingEventId ? '更新事件' : '创建事件' }}
        </button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1rem 1.1rem;
  background: #fff;
}

.page-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.panel-title {
  margin: 0 0 0.25rem;
  font-size: 1rem;
}

.panel-subtitle {
  margin: 0;
  color: #6b7280;
  font-size: 0.9rem;
}

.filter-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.85rem;
}

.table-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.5rem;
}

.table-count {
  color: #6b7280;
  font-size: 0.85rem;
}

.table-wrap {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.data-table th,
.data-table td {
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: top;
}

.data-table th {
  color: #6b7280;
  font-size: 0.8rem;
  font-weight: 600;
  background: #f9fafb;
}

.data-table tbody tr:hover {
  background: #f8fafc;
}

.name-cell {
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
}

.summary-cell,
.evidence-cell {
  max-width: 18rem;
  color: #4b5563;
  line-height: 1.55;
}

.actors-cell {
  max-width: 12rem;
  color: #4b5563;
}

.actions-col {
  width: 9.5rem;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-weight: 600;
  font-size: 0.9rem;
}

.field-input,
.field-textarea {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  font-size: 0.95rem;
  font-family: inherit;
}

.field-textarea {
  resize: vertical;
  line-height: 1.55;
}

.event-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.primary-button,
.secondary-button,
.table-button {
  border-radius: 8px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  font-size: 0.88rem;
  white-space: nowrap;
}

.primary-button {
  background: var(--aq-primary);
  color: #fff;
  border: none;
}

.secondary-button,
.table-button {
  background: #fff;
  color: #374151;
  border: 1px solid #d1d5db;
}

.table-button.danger {
  color: #b42318;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.message {
  margin: 0 0 0.75rem;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  font-size: 0.88rem;
}

.message-ok {
  background: #ecfdf3;
  color: #027a48;
}

.message-error {
  background: #fef2f2;
  color: #991b1b;
}

.empty-state {
  margin: 0;
  padding: 1.5rem 0;
  text-align: center;
  color: #6b7280;
}

@media (max-width: 960px) {
  .filter-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .page-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .filter-row {
    grid-template-columns: 1fr;
  }
}
</style>
