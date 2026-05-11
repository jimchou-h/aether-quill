<script setup lang="ts">
defineProps<{
  projectName: string;
  chapterCount: number;
  outlineReady: boolean;
  activePersonaName: string;
  outlineSummary: string;
}>();
</script>

<template>
  <section class="knowledge-panel">
    <h3 class="panel-title">项目上下文</h3>
    <div class="meta-list">
      <div class="meta-item">
        <span class="meta-label">项目</span>
        <span class="meta-value">{{ projectName || '-' }}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">已录入章节</span>
        <span class="meta-value">{{ chapterCount }}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">大纲状态</span>
        <span class="meta-value" :class="outlineReady ? 'status-ready' : 'status-missing'">
          {{ outlineReady ? '已配置' : '未配置' }}
        </span>
      </div>
      <div class="meta-item">
        <span class="meta-label">当前人物设定</span>
        <span class="meta-value">{{ activePersonaName }}</span>
      </div>
    </div>
    <div v-if="outlineSummary" class="outline-section">
      <h4 class="sub-title">大纲摘要</h4>
      <p class="outline-text">{{ outlineSummary }}</p>
    </div>
  </section>
</template>

<style scoped>
.knowledge-panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fff;
}

.panel-title {
  margin-bottom: 0.7rem;
  font-size: 1rem;
}

.sub-title {
  margin-top: 0.75rem;
  margin-bottom: 0.35rem;
  font-size: 0.9rem;
  color: #374151;
}

.meta-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.meta-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
}

.meta-label {
  color: #6b7280;
}

.meta-value {
  color: #374151;
  font-weight: 500;
}

.status-ready {
  color: #027a48;
}

.status-missing {
  color: #b42318;
}

.outline-section {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #f3f4f6;
}

.outline-text {
  font-size: 0.85rem;
  color: #6b7280;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
