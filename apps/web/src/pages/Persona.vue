<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import {
  apiClient,
  type DocumentItem,
  type PersonaIdentityRelationItem,
  type PersonaItem,
  type RelationEventItem,
} from '../services/api';
import AppModal from '../components/common/AppModal.vue';
import PersonaCardView from '../components/personas/PersonaCardView.vue';
import PersonaRelationGraph from '../components/personas/PersonaRelationGraph.vue';
import { presentError, presentErrorFromCaught, presentSuccess } from '../utils/pageFeedback';
import {
  buildLinkedPersonaCardMap,
  linkedPersonaCardTitle,
  normalizeDocumentList,
} from '../utils/personaCardLink';
import {
  collectPersonaStatusChapterOptions,
  resolvePersonaStatusForView,
} from '../utils/personaChapterStatus';
import { formatPersonaStateDisplay } from '../utils/personaStateDisplay';

type PersonaViewMode = 'table' | 'cards' | 'graph';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const personas = ref<PersonaItem[]>([]);
const loading = shallowRef(false);
const savingPersona = shallowRef(false);
const exportingBundle = shallowRef(false);
const showPersonaModal = shallowRef(false);
const editingPersonaId = shallowRef<string | null>(null);
const message = shallowRef('');
const errorMessage = shallowRef('');
const projectName = shallowRef('project');
const viewMode = ref<PersonaViewMode>('table');
const selectedPersonaId = ref<string | null>(null);
/** null = 最新；数字 = 截至第 N 章（只读） */
const statusAsOfChapterNo = ref<number | null>(null);
const relationEvents = ref<RelationEventItem[]>([]);
const identityRelations = ref<PersonaIdentityRelationItem[]>([]);
const documents = ref<DocumentItem[]>([]);

const personaName = shallowRef('');
const personaProfile = shallowRef('');
const personaState = shallowRef('');

const linkedPersonaCardByPersonaId = computed(() =>
  buildLinkedPersonaCardMap(documents.value)
);

const statusChapterOptions = computed(() => collectPersonaStatusChapterOptions(personas.value));

const statusViewMode = computed(() =>
  statusAsOfChapterNo.value === null
    ? ('latest' as const)
    : { asOfChapterNo: statusAsOfChapterNo.value }
);

function personaStatusText(persona: PersonaItem): string {
  return resolvePersonaStatusForView(persona, statusViewMode.value).text;
}

const publishedPersona = computed(
  () => personas.value.find((item) => item.status === 'published') || null
);

function linkedCardTitle(personaId: string): string {
  return linkedPersonaCardTitle(linkedPersonaCardByPersonaId.value, personaId);
}

const personaModalTitle = computed(() =>
  editingPersonaId.value ? '编辑人物设定' : '新增人物设定'
);

const personaModalSubtitle = computed(() =>
  editingPersonaId.value
    ? '更新后列表会立即刷新，发布状态保持不变。'
    : '创建草稿后可在列表中发布并设为当前生效版本。'
);

const personaModalSubmitLabel = computed(() => {
  if (savingPersona.value) {
    return editingPersonaId.value ? '保存中...' : '创建中...';
  }
  return editingPersonaId.value ? '保存修改' : '创建草稿';
});

function formatPersonaStatus(status: PersonaItem['status']) {
  return status === 'published' ? '已发布' : '草稿';
}

function resetPersonaForm() {
  personaName.value = '';
  personaProfile.value = '';
  personaState.value = '';
  editingPersonaId.value = null;
}

function openCreateModal() {
  errorMessage.value = '';
  resetPersonaForm();
  showPersonaModal.value = true;
}

function startEdit(persona: PersonaItem) {
  errorMessage.value = '';
  editingPersonaId.value = persona.id;
  personaName.value = persona.name;
  personaProfile.value = persona.profile;
  const displayState = formatPersonaStateDisplay(persona.state);
  personaState.value = displayState === '待更新' ? '' : displayState;
  showPersonaModal.value = true;
}

function closePersonaModal() {
  if (savingPersona.value) {
    return;
  }
  showPersonaModal.value = false;
  resetPersonaForm();
}

async function loadData() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [workspace, events, docsResponse] = await Promise.all([
      apiClient.getWorkspace(projectId.value),
      apiClient.getRelationEvents(projectId.value),
      apiClient.documents.list(projectId.value),
    ]);
    const docsPayload = normalizeDocumentList(docsResponse);
    personas.value = workspace.personas.map((persona) => ({
      ...persona,
      relationEventIds: persona.relationEventIds ?? [],
      appearedChapterNos: persona.appearedChapterNos ?? [],
      lastAppearedChapterNo: persona.lastAppearedChapterNo ?? null,
    }));
    relationEvents.value = events;
    identityRelations.value = workspace.identityRelations ?? [];
    documents.value = docsPayload.map((doc) => ({
      ...(doc as DocumentItem),
      content: (doc as DocumentItem).content ?? '',
      version: (doc as DocumentItem).version ?? 1,
      createdAt: (doc as DocumentItem).createdAt ?? '',
      updatedAt: (doc as DocumentItem).updatedAt ?? '',
    }));
    projectName.value = workspace.project.name || 'project';
    if (!selectedPersonaId.value && personas.value.length > 0) {
      selectedPersonaId.value = personas.value[0]?.id ?? null;
    }
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载人物设定失败');
  } finally {
    loading.value = false;
  }
}

function setViewMode(mode: PersonaViewMode) {
  viewMode.value = mode;
}

function handleSelectPersona(personaId: string) {
  selectedPersonaId.value = personaId;
  if (viewMode.value === 'graph') {
    viewMode.value = 'cards';
  }
}

function saveTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function handleExportBundle() {
  exportingBundle.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const bundle = await apiClient.getProjectExport(projectId.value);
    const safeName = projectName.value.replace(/[\\/:*?"<>|]/g, '_');
    saveTextFile(
      `${safeName}-summary-settings.json`,
      JSON.stringify(bundle, null, 2),
      'application/json;charset=utf-8'
    );
    message.value = presentSuccess('总结与设定已下载到本地');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '导出失败');
  } finally {
    exportingBundle.value = false;
  }
}

async function handleSubmitPersona() {
  if (!personaName.value.trim() || !personaProfile.value.trim()) {
    errorMessage.value = presentError('人物名称与人物设定不能为空');
    return;
  }

  savingPersona.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const payload = {
      name: personaName.value.trim(),
      profile: personaProfile.value.trim(),
      state: personaState.value.trim() || undefined,
    };

    if (editingPersonaId.value) {
      const persona = await apiClient.updatePersona(
        projectId.value,
        editingPersonaId.value,
        payload
      );
      personas.value = personas.value.map((item) => (item.id === persona.id ? persona : item));
      message.value = presentSuccess('人物设定已更新');
    } else {
      const persona = await apiClient.createPersona(projectId.value, payload);
      personas.value = [...personas.value, persona];
      message.value = presentSuccess('人物设定草稿已创建');
    }

    showPersonaModal.value = false;
    resetPersonaForm();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(
      error,
      editingPersonaId.value ? '更新人物设定失败' : '创建人物设定失败'
    );
  } finally {
    savingPersona.value = false;
  }
}

async function handleDeletePersona(persona: PersonaItem) {
  if (!confirm(`确定删除「${persona.name}」？此操作不可撤销。`)) {
    return;
  }

  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.deletePersona(projectId.value, persona.id);
    if (editingPersonaId.value === persona.id) {
      closePersonaModal();
    }
    personas.value = personas.value.filter((item) => item.id !== persona.id);
    message.value = presentSuccess('人物设定已删除');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '删除人物设定失败');
  }
}

async function handlePublishPersona(personaId: string) {
  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.publishPersona(projectId.value, personaId);
    await loadData();
    message.value = presentSuccess('人物设定已发布并设为生效版本');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '发布人物设定失败');
  }
}

onMounted(() => {
  void loadData();
});
</script>

<template>
  <div class="persona-page">
    <header class="page-header">
      <div>
        <h2 class="page-title">人物设定</h2>
        <p class="page-subtitle">维护人物画像、语气风格与状态版本，确保每个项目独立生效。</p>
      </div>
      <button class="primary-button" type="button" :disabled="loading" @click="openCreateModal">
        新增人物设定
      </button>
    </header>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>
    <p v-if="loading" class="message">正在加载人物设定...</p>

    <template v-if="!loading">
      <section class="panel summary-panel">
        <div class="summary-row">
          <div class="summary-meta">
            <span class="meta-label">当前发布版本</span>
            <span class="meta-value">{{ publishedPersona ? publishedPersona.name : '暂无' }}</span>
          </div>
          <button class="secondary-button" :disabled="exportingBundle" @click="handleExportBundle">
            {{ exportingBundle ? '导出中...' : '下载总结与设定(JSON)' }}
          </button>
        </div>
      </section>

      <section class="panel table-panel">
        <div class="table-toolbar">
          <h3 class="panel-title">人物清单</h3>
          <span class="table-count">共 {{ personas.length }} 条</span>
          <div class="view-switch">
            <button
              type="button"
              class="view-switch-button"
              :class="{ active: viewMode === 'table' }"
              @click="setViewMode('table')"
            >
              表格
            </button>
            <button
              type="button"
              class="view-switch-button"
              :class="{ active: viewMode === 'cards' }"
              @click="setViewMode('cards')"
            >
              卡片
            </button>
            <button
              type="button"
              class="view-switch-button"
              :class="{ active: viewMode === 'graph' }"
              @click="setViewMode('graph')"
            >
              关系图
            </button>
          </div>
          <label class="status-as-of">
            人物状态查看
            <select
              class="status-as-of-select"
              :value="statusAsOfChapterNo === null ? '' : String(statusAsOfChapterNo)"
              @change="
                statusAsOfChapterNo =
                  ($event.target as HTMLSelectElement).value === ''
                    ? null
                    : Number(($event.target as HTMLSelectElement).value)
              "
            >
              <option value="">最新</option>
              <option
                v-for="chapterNo in statusChapterOptions"
                :key="chapterNo"
                :value="String(chapterNo)"
              >
                截至第{{ chapterNo }}章
              </option>
            </select>
          </label>
        </div>
        <p v-if="statusAsOfChapterNo !== null" class="field-hint status-as-of-hint">
          当前为只读快照视图；编辑人物状态仍写入「最新」。
        </p>

        <p v-if="personas.length === 0" class="empty-state">暂无人物设定，请点击右上角新增。</p>

        <PersonaCardView
          v-else-if="viewMode === 'cards'"
          :project-id="projectId"
          :personas="personas"
          :relation-events="relationEvents"
          :documents="documents"
          :selected-persona-id="selectedPersonaId"
          :status-as-of-chapter-no="statusAsOfChapterNo"
          @select-persona="handleSelectPersona"
        />

        <PersonaRelationGraph
          v-else-if="viewMode === 'graph'"
          :personas="personas"
          :relation-events="relationEvents"
          :identity-relations="identityRelations"
          :selected-persona-id="selectedPersonaId"
          @select-persona="handleSelectPersona"
        />

        <div v-else class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">人物名称</th>
                <th scope="col">状态</th>
                <th scope="col">简介</th>
                <th scope="col">关联角色卡</th>
                <th scope="col">人物状态</th>
                <th scope="col" class="actions-col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="persona in personas" :key="persona.id">
                <td class="name-cell">{{ persona.name }}</td>
                <td>
                  <span
                    class="status-badge"
                    :class="persona.status === 'published' ? 'status-published' : 'status-draft'"
                  >
                    {{ formatPersonaStatus(persona.status) }}
                  </span>
                </td>
                <td class="profile-cell" :title="persona.profile">{{ persona.profile }}</td>
                <td>
                  <span
                    :class="
                      linkedPersonaCardByPersonaId.has(persona.id)
                        ? 'link-ok'
                        : 'link-missing'
                    "
                  >
                    {{ linkedCardTitle(persona.id) }}
                  </span>
                </td>
                <td>{{ personaStatusText(persona) }}</td>
                <td class="actions-col">
                  <div class="row-actions">
                    <button class="table-button" type="button" @click="startEdit(persona)">
                      编辑
                    </button>
                    <button
                      class="table-button"
                      type="button"
                      :disabled="persona.status === 'published'"
                      @click="handlePublishPersona(persona.id)"
                    >
                      {{ persona.status === 'published' ? '已发布' : '发布并生效' }}
                    </button>
                    <button
                      class="table-button danger"
                      type="button"
                      @click="handleDeletePersona(persona)"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <AppModal
      :open="showPersonaModal"
      :title="personaModalTitle"
      :subtitle="personaModalSubtitle"
      title-id="persona-form-title"
      @close="closePersonaModal"
    >
      <label class="field-label">
        人物名称
        <input v-model="personaName" class="field-input" type="text" placeholder="例如：沈镜川" />
      </label>
      <label class="field-label">
        人物简介（短画像 / 口吻提示；完整静态设定请在知识库角色卡维护）
        <textarea
          v-model="personaProfile"
          class="field-textarea"
          placeholder="例如：前刑警，谨慎克制；短句、冷静；不主动暴露底牌"
          rows="4"
        />
      </label>
      <p v-if="editingPersonaId" class="field-hint">
        关联静态卡：{{ linkedCardTitle(editingPersonaId) }}
        <template v-if="!linkedPersonaCardByPersonaId.has(editingPersonaId)">
          · 建议在知识库创建角色卡并选择本人物
        </template>
      </p>
      <label class="field-label">
        人物状态（可选）
        <input
          v-model="personaState"
          class="field-input"
          type="text"
          placeholder="例如：清醒，尚未饮酒"
        />
      </label>

      <template #footer>
        <button
          class="secondary-button"
          type="button"
          :disabled="savingPersona"
          @click="closePersonaModal"
        >
          取消
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="savingPersona"
          @click="handleSubmitPersona"
        >
          {{ personaModalSubmitLabel }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.persona-page {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  max-width: 1080px;
  margin: 0 auto;
  padding: 0.25rem 0 1.5rem;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.page-title {
  margin: 0;
  font-size: 1.25rem;
}

.page-subtitle {
  margin: 0.35rem 0 0;
  color: #6b7280;
  font-size: 0.9rem;
}

.panel {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1rem 1.1rem;
  background: #fff;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.summary-meta {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.meta-label {
  font-size: 0.75rem;
  color: #6b7280;
}

.meta-value {
  font-size: 0.95rem;
  color: #111827;
}

.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
  flex-wrap: wrap;
}

.view-switch {
  display: inline-flex;
  gap: 0.35rem;
}

.view-switch-button {
  border: 1px solid var(--aq-border-strong);
  background: var(--aq-surface);
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background var(--aq-transition-fast), border-color var(--aq-transition-fast);
}

.view-switch-button.active {
  border-color: var(--aq-primary);
  background: color-mix(in srgb, var(--aq-primary) 12%, var(--aq-surface));
}

.status-as-of {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--aq-text-muted, #6b7280);
  margin-left: auto;
}

.status-as-of-select {
  border: 1px solid var(--aq-border-strong);
  border-radius: 0.4rem;
  padding: 0.25rem 0.5rem;
  background: var(--aq-surface);
  font-size: 0.85rem;
}

.status-as-of-hint {
  margin: -0.35rem 0 0.75rem;
}

.panel-title {
  margin: 0;
  font-size: 1rem;
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

.profile-cell {
  max-width: 28rem;
  color: #4b5563;
  line-height: 1.55;
  white-space: pre-wrap;
}

.link-ok {
  color: #027a48;
}

.link-missing {
  color: #b54708;
}

.field-hint {
  margin: 0.35rem 0 0.75rem;
  font-size: 0.8rem;
  color: #6b7280;
  line-height: 1.45;
}

.actions-col {
  width: 15rem;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.table-button.danger {
  color: #b42318;
  border-color: #fecdca;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
}

.status-published {
  background: #ecfdf3;
  color: #027a48;
}

.status-draft {
  background: #fffaeb;
  color: #b54708;
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
  min-height: 120px;
  line-height: 1.55;
}

.primary-button,
.secondary-button,
.table-button {
  border-radius: 8px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  font-size: 0.88rem;
}

.primary-button {
  background: var(--aq-primary);
  color: var(--aq-text-inverse);
  border: none;
  white-space: nowrap;
}

.secondary-button,
.table-button {
  background: #fff;
  color: #374151;
  border: 1px solid #d1d5db;
}

.primary-button:disabled,
.secondary-button:disabled,
.table-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.message {
  margin: 0;
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

@media (max-width: 768px) {
  .page-header,
  .summary-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
