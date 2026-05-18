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
  <section class="knowledge-bar">
    <div class="kb-items">
      <div class="kb-item">
        <span class="kb-label">项目</span>
        <span class="kb-value">{{ projectName || '-' }}</span>
      </div>
      <div class="kb-divider"></div>
      <div class="kb-item">
        <span class="kb-label">章节</span>
        <span class="kb-value">{{ chapterCount }}</span>
      </div>
      <div class="kb-divider"></div>
      <div class="kb-item">
        <span class="kb-label">大纲</span>
        <span class="kb-value" :class="outlineReady ? 'status-ready' : 'status-missing'">
          {{ outlineReady ? '已配置' : '未配置' }}
        </span>
      </div>
      <div class="kb-divider"></div>
      <div class="kb-item">
        <span class="kb-label">当前人物</span>
        <span class="kb-value">{{ activePersonaName }}</span>
      </div>
    </div>
    <div v-if="outlineSummary" class="kb-outline">
      <span class="kb-label">大纲摘要</span>
      <p class="kb-outline-text">{{ outlineSummary }}</p>
    </div>
  </section>
</template>

<style scoped>
.knowledge-bar {
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  padding: 0.85rem 1rem;
}

.kb-items {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.kb-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.kb-label {
  font-size: 0.78rem;
  color: #6b7280;
  white-space: nowrap;
}

.kb-value {
  font-size: 0.85rem;
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
}

.kb-divider {
  width: 1px;
  height: 18px;
  background: #e5e7eb;
}

.status-ready {
  color: #059669;
}

.status-missing {
  color: #dc2626;
}

.kb-outline {
  margin-top: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid #e5e7eb;
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}

.kb-outline-text {
  margin: 0;
  font-size: 0.82rem;
  color: #4b5563;
  line-height: 1.5;
  flex: 1;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
