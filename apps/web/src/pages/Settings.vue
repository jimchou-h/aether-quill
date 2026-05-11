<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient, type PersonaItem } from '../services/api';
import { usePromptConfigStore } from '../stores/promptConfig';
import SystemPromptEditor from '../components/settings/SystemPromptEditor.vue';
import PromptVersionHistory from '../components/settings/PromptVersionHistory.vue';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const promptConfigStore = usePromptConfigStore();

const personas = ref<PersonaItem[]>([]);
const loading = shallowRef(false);
const creatingPersona = shallowRef(false);
const exportingBundle = shallowRef(false);
const message = shallowRef('');
const errorMessage = shallowRef('');
const projectName = shallowRef('project');
const activeTab = shallowRef<'prompt' | 'persona'>('prompt');

const personaName = shallowRef('');
const personaProfile = shallowRef('');
const personaState = shallowRef('');

const publishedPersona = computed(
  () => personas.value.find((item) => item.status === 'published') || null
);

async function loadData() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    personas.value = workspace.personas;
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
      state: personaState.value.trim() || undefined,
    });
    personas.value = [...personas.value, persona];
    personaName.value = '';
    personaProfile.value = '';
    personaState.value = '';
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
      <div class="settings-tabs">
        <button
          class="tab-button"
          :class="{ 'tab-button-active': activeTab === 'prompt' }"
          @click="activeTab = 'prompt'"
        >
          系统提示词
        </button>
        <button
          class="tab-button"
          :class="{ 'tab-button-active': activeTab === 'persona' }"
          @click="activeTab = 'persona'"
        >
          人物设定
        </button>
      </div>

      <template v-if="activeTab === 'prompt'">
        <SystemPromptEditor :project-id="projectId" />
        <PromptVersionHistory :project-id="projectId" />
      </template>

      <template v-else>
        <section class="panel">
          <h3 class="panel-title">创建人物设定</h3>
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
              placeholder="例如：\n人物画像：前刑警，谨慎克制\n语气风格：短句、冷静\n禁忌规则：不主动暴露底牌"
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
          <button class="primary-button" :disabled="creatingPersona" @click="handleCreatePersona">
            {{ creatingPersona ? '创建中...' : '创建草稿' }}
          </button>
        </section>

        <section class="panel">
          <h3 class="panel-title">人物清单</h3>
          <p class="meta-text">
            当前发布版本：{{ publishedPersona ? publishedPersona.name : '暂无' }}
          </p>
          <p v-if="personas.length === 0" class="meta-text">暂无人物设定，请先创建。</p>
          <div v-else class="persona-list">
            <article v-for="persona in personas" :key="persona.id" class="persona-card">
              <header class="persona-header">
                <h4 class="persona-name">{{ persona.name }}</h4>
                <span class="persona-status">{{ persona.status }}</span>
              </header>
              <p class="persona-profile">{{ persona.profile }}</p>
              <p class="meta-text persona-state">当前状态：{{ persona.state || '待更新' }}</p>
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

.settings-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.tab-button {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.45rem 0.85rem;
  background: #fff;
  color: #374151;
  cursor: pointer;
  font-size: 0.9rem;
}

.tab-button-active {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
  font-weight: 600;
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
  white-space: pre-wrap;
}

.persona-state {
  color: #1d4ed8;
}

.export-panel {
  display: flex;
  justify-content: flex-end;
}
</style>
