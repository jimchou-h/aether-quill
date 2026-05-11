<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient, type PersonaItem, type ProjectSettings } from '../services/api';
import { usePromptConfigStore } from '../stores/promptConfig';
import SystemPromptEditor from '../components/settings/SystemPromptEditor.vue';
import PromptVersionHistory from '../components/settings/PromptVersionHistory.vue';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const promptConfigStore = usePromptConfigStore();

const settings = ref<ProjectSettings | null>(null);
const personas = ref<PersonaItem[]>([]);
const loading = shallowRef(false);
const creatingPersona = shallowRef(false);
const exportingBundle = shallowRef(false);
const message = shallowRef('');
const errorMessage = shallowRef('');
const projectName = shallowRef('project');

const activePersonaId = shallowRef<string | null>(null);

const personaName = shallowRef('');
const personaProfile = shallowRef('');
const personaTone = shallowRef('');
const personaConstraints = shallowRef('');

const publishedPersona = computed(
  () => personas.value.find((item) => item.status === 'published') || null
);

async function loadData() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    settings.value = workspace.settings;
    personas.value = workspace.personas;
    activePersonaId.value = workspace.settings.activePersonaId;
    projectName.value = workspace.project.name || 'project';

    await promptConfigStore.loadConfig(projectId.value);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载设置失败';
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
    message.value = '总结与设定已下载到本地';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '导出失败';
  } finally {
    exportingBundle.value = false;
  }
}

async function handleCreatePersona() {
  if (!personaName.value.trim() || !personaProfile.value.trim()) {
    errorMessage.value = '人物名称与人物设定不能为空';
    return;
  }

  creatingPersona.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const persona = await apiClient.createPersona(projectId.value, {
      name: personaName.value.trim(),
      profile: personaProfile.value.trim(),
      tone: personaTone.value.trim(),
      constraints: personaConstraints.value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    });
    personas.value = [...personas.value, persona];
    personaName.value = '';
    personaProfile.value = '';
    personaTone.value = '';
    personaConstraints.value = '';
    message.value = '人物设定草稿已创建';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建人物设定失败';
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
    message.value = '人物设定已发布并设为生效版本';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '发布人物设定失败';
  }
}

onMounted(() => {
  void loadData();
});
</script>

<template>
  <div class="settings-page">
    <h2 class="page-title">项目设置</h2>
    <p class="page-subtitle">维护系统提示词与人物设定版本，确保每个项目独立生效。</p>

    <p v-if="errorMessage || promptConfigStore.errorMessage" class="message message-error">
      {{ errorMessage || promptConfigStore.errorMessage }}
    </p>
    <p v-if="message || promptConfigStore.message" class="message message-ok">
      {{ message || promptConfigStore.message }}
    </p>
    <p v-if="loading" class="message">正在加载设置...</p>

    <template v-if="!loading">
      <SystemPromptEditor :project-id="projectId" />

      <PromptVersionHistory :project-id="projectId" />

      <section class="panel">
        <h3 class="panel-title">创建人物设定</h3>
        <label class="field-label">
          人物名称
          <input v-model="personaName" class="field-input" type="text" placeholder="例如：沈镜川" />
        </label>
        <label class="field-label">
          人物画像
          <textarea
            v-model="personaProfile"
            class="field-textarea"
            placeholder="填写人物身份、行为边界、价值观和表达偏好"
          />
        </label>
        <label class="field-label">
          语气风格
          <input
            v-model="personaTone"
            class="field-input"
            type="text"
            placeholder="例如：克制、冷静、带隐喻"
          />
        </label>
        <label class="field-label">
          禁忌规则（每行一条）
          <textarea
            v-model="personaConstraints"
            class="field-textarea"
            placeholder="例如：\n不能直接泄露终极反派\n不能改变人物核心动机"
          />
        </label>
        <button class="primary-button" :disabled="creatingPersona" @click="handleCreatePersona">
          {{ creatingPersona ? '创建中...' : '创建草稿' }}
        </button>
      </section>

      <section class="panel">
        <h3 class="panel-title">人物设定列表</h3>
        <p class="meta-text">
          当前发布版本：{{ publishedPersona ? publishedPersona.name : '暂无' }}
        </p>
        <div class="persona-list">
          <article v-for="persona in personas" :key="persona.id" class="persona-card">
            <header class="persona-header">
              <h4 class="persona-name">{{ persona.name }}</h4>
              <span class="persona-status">{{ persona.status }}</span>
            </header>
            <p class="persona-profile">{{ persona.profile }}</p>
            <p class="meta-text">语气：{{ persona.tone }}</p>
            <p class="meta-text">约束：{{ persona.constraints.join('；') || '无' }}</p>
            <button
              class="secondary-button"
              :disabled="persona.status === 'published'"
              @click="handlePublishPersona(persona.id)"
            >
              {{ persona.status === 'published' ? '已发布' : '发布并生效' }}
            </button>
          </article>
        </div>
      </section>

      <section class="panel export-panel">
        <button class="secondary-button" :disabled="exportingBundle" @click="handleExportBundle">
          {{ exportingBundle ? '导出中...' : '下载总结与设定(JSON)' }}
        </button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 980px;
  margin: 0 auto;
  padding: 1rem;
}

.page-title {
  margin-bottom: 0.25rem;
}

.page-subtitle {
  color: #666;
  margin-bottom: 1rem;
}

.panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fff;
}

.panel-title {
  margin-bottom: 0.7rem;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
  font-weight: 600;
}

.field-input,
.field-select,
.field-textarea {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  font-size: 0.95rem;
}

.field-textarea {
  min-height: 100px;
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

.primary-button:hover {
  background: #2563eb;
}

.primary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-button {
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
}

.secondary-button:hover {
  background: #e5e7eb;
}

.secondary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.meta-text {
  color: #4b5563;
  margin-bottom: 0.25rem;
  font-size: 0.9rem;
}

.persona-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.persona-card {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.75rem;
}

.persona-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.persona-name {
  font-size: 0.95rem;
}

.persona-status {
  font-size: 0.75rem;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  background: #fef3c7;
  color: #92400e;
  font-weight: 500;
}

.persona-profile {
  font-size: 0.85rem;
  color: #6b7280;
  margin-bottom: 0.25rem;
  line-height: 1.4;
}

.export-panel {
  display: flex;
  justify-content: flex-end;
}
</style>
