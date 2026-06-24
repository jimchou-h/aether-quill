<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient } from '../services/api';
import { usePromptConfigStore } from '../stores/promptConfig';
import { useTaskPromptConfigStore } from '../stores/taskPromptConfig';
import SystemPromptEditor from '../components/settings/SystemPromptEditor.vue';
import TaskPromptSection from '../components/settings/TaskPromptSection.vue';
import OutlineSummaryEditor from '../components/settings/OutlineSummaryEditor.vue';
import ProjectGenerationPreferences from '../components/settings/ProjectGenerationPreferences.vue';
import PromptVersionHistory from '../components/settings/PromptVersionHistory.vue';
import WritingStatsPanel from '../components/settings/WritingStatsPanel.vue';
import { presentErrorFromCaught } from '../utils/pageFeedback';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const promptConfigStore = usePromptConfigStore();
const taskPromptConfigStore = useTaskPromptConfigStore();

const loading = shallowRef(false);
const errorMessage = shallowRef('');

async function loadData() {
  loading.value = true;
  errorMessage.value = '';
  try {
    await apiClient.getWorkspace(projectId.value);
    await promptConfigStore.loadConfig(projectId.value);
    await taskPromptConfigStore.loadList(projectId.value);
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

    <p v-if="errorMessage || promptConfigStore.errorMessage || taskPromptConfigStore.errorMessage" class="message message-error">
      {{ errorMessage || promptConfigStore.errorMessage || taskPromptConfigStore.errorMessage }}
    </p>
    <p v-if="promptConfigStore.message || taskPromptConfigStore.message" class="message message-ok">
      {{ promptConfigStore.message || taskPromptConfigStore.message }}
    </p>
    <p v-if="loading" class="message">正在加载设置...</p>

    <template v-if="!loading">
      <WritingStatsPanel :project-id="projectId" />
      <OutlineSummaryEditor :project-id="projectId" />
      <ProjectGenerationPreferences :project-id="projectId" />
      <SystemPromptEditor :project-id="projectId" />
      <TaskPromptSection :project-id="projectId" />
      <PromptVersionHistory :project-id="projectId" />
    </template>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 980px;
  margin: 0 auto;
}
</style>
