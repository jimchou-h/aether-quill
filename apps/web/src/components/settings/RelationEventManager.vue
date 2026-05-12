<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { apiClient, type PersonaItem, type RelationEventItem } from '../../services/api';

const props = defineProps<{
  projectId: string;
  personas: PersonaItem[];
}>();

const loading = ref(false);
const saving = ref(false);
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
      message.value = '关系事件已更新';
    } else {
      await apiClient.createRelationEvent(props.projectId, payload);
      message.value = '关系事件已创建';
    }

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
      resetForm();
    }
    message.value = '关系事件已删除';
    await loadEvents();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除关系事件失败';
  }
}

onMounted(() => {
  resetForm();
  void loadEvents();
});
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">关系事件库</h3>
    <p class="panel-subtitle">手动维护主角与其他角色之间已发生的事实，写作时可按需勾选注入。</p>

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
      <button class="secondary-button" :disabled="loading" @click="loadEvents">
        {{ loading ? '加载中...' : '筛选' }}
      </button>
    </div>

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
        <textarea v-model="form.summary" class="field-textarea" rows="3" required />
      </label>

      <label class="field-label">
        证据短句（可选）
        <textarea v-model="form.evidenceSnippet" class="field-textarea" rows="2" />
      </label>

      <div class="actions-row">
        <button class="primary-button" type="submit" :disabled="saving">
          {{ saving ? '保存中...' : editingEventId ? '更新事件' : '新增事件' }}
        </button>
        <button v-if="editingEventId" class="secondary-button" type="button" @click="resetForm">
          取消编辑
        </button>
      </div>
    </form>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>
    <p v-if="loading" class="message">正在加载事件...</p>

    <div v-else-if="events.length === 0" class="empty-state">暂无关系事件。</div>

    <div v-else class="event-list">
      <article v-for="event in events" :key="event.id" class="event-card">
        <header class="event-header">
          <h4 class="event-title">{{ event.protagonist }} ↔ {{ event.counterparty }}</h4>
        </header>
        <p class="event-summary">{{ event.summary }}</p>
        <p v-if="event.chapterNo" class="event-meta">第{{ event.chapterNo }}章</p>
        <p v-if="event.evidenceSnippet" class="event-evidence">证据：{{ event.evidenceSnippet }}</p>
        <div class="actions-row">
          <button class="secondary-button" type="button" @click="startEdit(event)">编辑</button>
          <button class="secondary-button danger" type="button" @click="handleDelete(event)">
            删除
          </button>
        </div>
      </article>
    </div>
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
  margin-bottom: 0.25rem;
}

.panel-subtitle {
  color: #6b7280;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}

.filter-row,
.form-grid,
.actions-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.filter-row {
  margin-bottom: 0.75rem;
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
  margin-bottom: 0.75rem;
  font-weight: 600;
}

.field-input,
.field-textarea {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  font-size: 0.95rem;
  font-family: inherit;
}

.field-textarea {
  resize: vertical;
}

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.48rem 0.85rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.primary-button {
  background: #1d4ed8;
  color: #fff;
  border: none;
}

.secondary-button {
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
}

.secondary-button.danger {
  color: #b42318;
}

.message {
  margin-top: 0.75rem;
}

.message-ok {
  color: #027a48;
}

.message-error {
  color: #b42318;
}

.empty-state {
  color: #6b7280;
  padding: 1rem 0;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.event-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.75rem;
  background: #fafafa;
}

.event-header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.event-title {
  margin: 0;
  font-size: 0.95rem;
}

.event-summary,
.event-meta,
.event-evidence {
  margin: 0.2rem 0;
  font-size: 0.9rem;
}

.event-evidence {
  color: #6b7280;
}
</style>
