<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient, type PersonaItem } from '../services/api';
import RelationEventManager from '../components/settings/RelationEventManager.vue';
import { presentErrorFromCaught } from '../utils/pageFeedback';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const personas = ref<PersonaItem[]>([]);
const loading = shallowRef(false);
const errorMessage = shallowRef('');

async function loadData() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    personas.value = workspace.personas;
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载关系事件失败');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadData();
});
</script>

<template>
  <div class="relation-events-page">
    <header class="page-header">
      <div>
        <h2 class="page-title">关系事件</h2>
        <p class="page-subtitle">维护人物关系与章节事件，供写作与检索引用。</p>
      </div>
    </header>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="loading" class="message">正在加载关系事件...</p>

    <RelationEventManager v-if="!loading" :project-id="projectId" :personas="personas" />
  </div>
</template>

<style scoped>
.relation-events-page {
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

.message {
  margin: 0;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  font-size: 0.88rem;
}

.message-error {
  background: #fef2f2;
  color: #991b1b;
}
</style>
