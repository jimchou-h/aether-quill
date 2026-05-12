<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient, type PersonaItem } from '../services/api';
import AppModal from '../components/common/AppModal.vue';
import { presentError, presentErrorFromCaught, presentSuccess } from '../utils/pageFeedback';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const personas = ref<PersonaItem[]>([]);
const loading = shallowRef(false);
const creatingPersona = shallowRef(false);
const exportingBundle = shallowRef(false);
const showCreateModal = shallowRef(false);
const message = shallowRef('');
const errorMessage = shallowRef('');
const projectName = shallowRef('project');

const personaName = shallowRef('');
const personaProfile = shallowRef('');
const personaState = shallowRef('');

const publishedPersona = computed(
  () => personas.value.find((item) => item.status === 'published') || null
);

function formatPersonaStatus(status: PersonaItem['status']) {
  return status === 'published' ? '已发布' : '草稿';
}

function resetCreateForm() {
  personaName.value = '';
  personaProfile.value = '';
  personaState.value = '';
}

function openCreateModal() {
  errorMessage.value = '';
  resetCreateForm();
  showCreateModal.value = true;
}

function closeCreateModal() {
  if (creatingPersona.value) {
    return;
  }
  showCreateModal.value = false;
  resetCreateForm();
}

async function loadData() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    personas.value = workspace.personas;
    projectName.value = workspace.project.name || 'project';
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载人物设定失败');
  } finally {
    loading.value = false;
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

async function handleCreatePersona() {
  if (!personaName.value.trim() || !personaProfile.value.trim()) {
    errorMessage.value = presentError('人物名称与人物设定不能为空');
    return;
  }

  creatingPersona.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const persona = await apiClient.createPersona(projectId.value, {
      name: personaName.value.trim(),
      profile: personaProfile.value.trim(),
      state: personaState.value.trim() || undefined,
    });
    personas.value = [...personas.value, persona];
    message.value = presentSuccess('人物设定草稿已创建');
    showCreateModal.value = false;
    resetCreateForm();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '创建人物设定失败');
  } finally {
    creatingPersona.value = false;
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
        </div>

        <p v-if="personas.length === 0" class="empty-state">暂无人物设定，请点击右上角新增。</p>

        <div v-else class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">人物名称</th>
                <th scope="col">状态</th>
                <th scope="col">人物设定</th>
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
                <td>{{ persona.state || '待更新' }}</td>
                <td class="actions-col">
                  <button
                    class="table-button"
                    :disabled="persona.status === 'published'"
                    @click="handlePublishPersona(persona.id)"
                  >
                    {{ persona.status === 'published' ? '已发布' : '发布并生效' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <AppModal
      :open="showCreateModal"
      title="新增人物设定"
      subtitle="创建草稿后可在列表中发布并设为当前生效版本。"
      title-id="persona-create-title"
      @close="closeCreateModal"
    >
      <label class="field-label">
        人物名称
        <input
          v-model="personaName"
          class="field-input"
          type="text"
          placeholder="例如：沈镜川"
        />
      </label>
      <label class="field-label">
        人物设定（人物画像 / 语气风格 / 禁忌规则，每行一条）
        <textarea
          v-model="personaProfile"
          class="field-textarea"
          placeholder="例如：
人物画像：前刑警，谨慎克制
语气风格：短句、冷静
禁忌规则：不主动暴露底牌"
          rows="6"
        />
      </label>
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
        <button class="secondary-button" type="button" :disabled="creatingPersona" @click="closeCreateModal">
          取消
        </button>
        <button class="primary-button" type="button" :disabled="creatingPersona" @click="handleCreatePersona">
          {{ creatingPersona ? '创建中...' : '创建草稿' }}
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

.actions-col {
  width: 8.5rem;
  white-space: nowrap;
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
  background: #1d4ed8;
  color: #fff;
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
