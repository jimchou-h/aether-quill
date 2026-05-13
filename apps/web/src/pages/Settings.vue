<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient } from '../services/api';
import { usePromptConfigStore } from '../stores/promptConfig';
import SystemPromptEditor from '../components/settings/SystemPromptEditor.vue';
import OutlineSummaryEditor from '../components/settings/OutlineSummaryEditor.vue';
import PromptVersionHistory from '../components/settings/PromptVersionHistory.vue';
import { presentErrorFromCaught } from '../utils/pageFeedback';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const promptConfigStore = usePromptConfigStore();

const loading = shallowRef(false);
const errorMessage = shallowRef('');

async function loadData() {
  loading.value = true;
  errorMessage.value = '';
  try {
    await apiClient.getWorkspace(projectId.value);
    await promptConfigStore.loadConfig(projectId.value);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载设置失败');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadData();
});
</script>

<template>
  <div class="settings-page">
    <h2 class="page-title">项目设置</h2>
    <p class="page-subtitle">维护大纲摘要与系统提示词版本，确保每个项目独立生效。</p>

    <p v-if="errorMessage || promptConfigStore.errorMessage" class="message message-error">
      {{ errorMessage || promptConfigStore.errorMessage }}
    </p>
    <p v-if="promptConfigStore.message" class="message message-ok">
      {{ promptConfigStore.message }}
    </p>
    <p v-if="loading" class="message">正在加载设置...</p>

    <template v-if="!loading">
      <OutlineSummaryEditor :project-id="projectId" />
      <SystemPromptEditor :project-id="projectId" />
      <PromptVersionHistory :project-id="projectId" />
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

.message {
  margin-bottom: 0.75rem;
}

.message-ok {
  color: #027a48;
}

.message-error {
  color: #b42318;
}
</style>
