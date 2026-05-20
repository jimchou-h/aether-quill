<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { apiClient, type ProjectWritingStats } from '../../services/api';
import { presentErrorFromCaught } from '../../utils/pageFeedback';

const props = defineProps<{
  projectId: string;
}>();

const loading = ref(false);
const errorMessage = ref('');
const stats = ref<ProjectWritingStats | null>(null);

async function loadStats() {
  loading.value = true;
  errorMessage.value = '';
  try {
    stats.value = await apiClient.getProjectStats(props.projectId);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载写作统计失败');
    stats.value = null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.projectId,
  () => {
    void loadStats();
  }
);

onMounted(() => {
  void loadStats();
});
</script>

<template>
  <section class="panel">
    <div class="panel-header">
      <h3 class="panel-title">写作统计</h3>
      <button class="secondary-button" type="button" :disabled="loading" @click="loadStats">
        {{ loading ? '刷新中...' : '刷新' }}
      </button>
    </div>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="loading && !stats" class="message">正在加载统计数据...</p>

    <template v-else-if="stats">
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">项目总字数</span>
          <strong class="stat-value">{{ stats.totalCharCount.toLocaleString() }}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">AI 消耗 Token</span>
          <strong class="stat-value">{{ stats.totalTokens.toLocaleString() }}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">生成次数</span>
          <strong class="stat-value">{{ stats.generationTotal }}</strong>
        </div>
        <div class="stat-card">
          <span class="stat-label">成功 / 失败</span>
          <strong class="stat-value">
            {{ stats.generationCompleted }} / {{ stats.generationFailed }}
          </strong>
        </div>
      </div>

      <div v-if="stats.chapterCharCounts.length > 0" class="chapter-stats">
        <h4 class="sub-title">各章字数</h4>
        <ul class="chapter-list">
          <li v-for="item in stats.chapterCharCounts" :key="item.chapterNo" class="chapter-row">
            <span>第 {{ item.chapterNo }} 章</span>
            <span>{{ item.charCount.toLocaleString() }} 字</span>
          </li>
        </ul>
      </div>
      <p v-else class="empty-hint">暂无章节数据。</p>
    </template>
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

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.panel-title {
  margin: 0;
}

.sub-title {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  color: #374151;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.stat-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.75rem;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.stat-label {
  font-size: 0.82rem;
  color: #6b7280;
}

.stat-value {
  font-size: 1.15rem;
  color: #111827;
}

.chapter-stats {
  border-top: 1px solid #e5e7eb;
  padding-top: 0.75rem;
}

.chapter-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 280px;
  overflow-y: auto;
}

.chapter-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.88rem;
  color: #4b5563;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  background: #f9fafb;
}

.empty-hint {
  margin: 0;
  color: #9ca3af;
  font-size: 0.88rem;
}

.message {
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}

.message-error {
  color: #b42318;
}

.secondary-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  font-size: 0.85rem;
}

.secondary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
