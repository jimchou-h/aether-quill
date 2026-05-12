<script setup lang="ts">
/**
 * 知识库面板组件属性定义
 */
defineProps<{
  /** 项目名称 */
  projectName: string;
  /** 章节数量 */
  chapterCount: number;
  /** 大纲是否已配置 */
  outlineReady: boolean;
  /** 当前人物设定名称 */
  activePersonaName: string;
  /** 大纲摘要 */
  outlineSummary: string;
}>();
</script>

<template>
  <section class="knowledge-panel">
    <div class="panel-heading">
      <h3 class="panel-title">项目上下文</h3>
      <p class="panel-description">生成时会自动引用当前项目设定与知识。</p>
    </div>

    <div class="meta-grid">
      <article class="meta-card">
        <span class="meta-label">项目</span>
        <span class="meta-value">{{ projectName || '-' }}</span>
      </article>
      <article class="meta-card">
        <span class="meta-label">已录入章节</span>
        <span class="meta-value">{{ chapterCount }}</span>
      </article>
      <article class="meta-card">
        <span class="meta-label">大纲状态</span>
        <span class="meta-value" :class="outlineReady ? 'status-ready' : 'status-missing'">
          {{ outlineReady ? '已配置' : '未配置' }}
        </span>
      </article>
      <article class="meta-card meta-card-wide">
        <span class="meta-label">当前人物设定</span>
        <span class="meta-value">{{ activePersonaName }}</span>
      </article>
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
  border-radius: 16px;
  padding: 1.35rem;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
}

.panel-heading {
  margin-bottom: 1.1rem;
}

.panel-title {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
}

.panel-description {
  margin: 0;
  color: #6b7280;
  font-size: 0.9rem;
  line-height: 1.5;
}

.sub-title {
  margin: 0 0 0.5rem;
  font-size: 0.92rem;
  color: #374151;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.meta-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.85rem 0.95rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #edf2f7;
}

.meta-card-wide {
  grid-column: 1 / -1;
}

.meta-label {
  color: #6b7280;
  font-size: 0.8rem;
}

.meta-value {
  color: #111827;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}

.status-ready {
  color: #027a48;
}

.status-missing {
  color: #b42318;
}

.outline-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #e5e7eb;
}

.outline-text {
  font-size: 0.92rem;
  color: #4b5563;
  line-height: 1.65;
  white-space: pre-wrap;
}
</style>
