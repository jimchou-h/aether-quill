<script setup lang="ts">
import { usePromptConfigStore } from '../../stores/promptConfig';
import { confirmAction } from '../../composables/useAppConfirm';

/** 提示词配置状态管理 */
const store = usePromptConfigStore();

/**
 * 组件属性定义
 */
const props = defineProps<{
  /** 项目ID */
  projectId: string;
}>();

/**
 * 格式化ISO时间字符串
 * @param {string} iso - ISO时间字符串
 * @returns {string} 格式化后的时间
 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * 处理回滚到指定版本
 * @param {number} version - 目标版本号
 */
async function handleRollbackTo(version: number) {
  const confirmed = await confirmAction({
    title: '回滚提示词版本',
    content: `确定回滚到版本 v${version}？当前未发布内容将被覆盖。`,
    okText: '确认回滚',
    danger: true,
  });
  if (confirmed) {
    void store.rollback(props.projectId, version);
  }
}
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">版本历史</h3>
    <p class="field-hint">所有版本均可追溯，支持回滚到任意已保存版本。</p>

    <div v-if="store.versions.length === 0" class="empty-state">暂无版本记录。</div>

    <div v-else class="version-timeline">
      <div
        v-for="ver in [...store.versions].reverse()"
        :key="ver.version"
        class="version-entry"
        :class="{ 'version-current': ver.version === store.currentVersion }"
      >
        <div
          class="version-dot"
          :class="{
            'dot-published': ver.isPublished,
            'dot-current': ver.version === store.currentVersion,
          }"
        ></div>
        <div class="version-body">
          <div class="version-header">
            <span class="version-number">v{{ ver.version }}</span>
            <span v-if="ver.isPublished" class="published-tag">已发布</span>
            <span v-if="ver.version === store.currentVersion" class="current-tag">当前</span>
            <span class="version-time">{{ formatTime(ver.createdAt) }}</span>
          </div>
          <p class="version-preview">
            {{ ver.content.slice(0, 120) }}{{ ver.content.length > 120 ? '...' : '' }}
          </p>
          <div class="version-actions">
            <button
              v-if="ver.version !== store.currentVersion"
              class="rollback-link"
              @click="handleRollbackTo(ver.version)"
            >
              回滚到此版本
            </button>
          </div>
        </div>
      </div>
    </div>
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

.panel-title {
  margin-bottom: 0.35rem;
  font-size: 1rem;
}

.field-hint {
  color: #9ca3af;
  font-size: 0.8rem;
  margin-bottom: 0.75rem;
}

.empty-state {
  color: #9ca3af;
  font-size: 0.9rem;
  text-align: center;
  padding: 1.5rem 0;
}

.version-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
}

.version-timeline::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: #e5e7eb;
}

.version-entry {
  display: flex;
  gap: 0.75rem;
  padding: 0.5rem 0;
  position: relative;
}

.version-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #e5e7eb;
  border: 3px solid #fff;
  flex-shrink: 0;
  z-index: 1;
  margin-top: 2px;
}

.dot-published {
  background: #059669;
}

.dot-current {
  background: #1d4ed8;
  box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.2);
}

.version-body {
  flex: 1;
  min-width: 0;
}

.version-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.25rem;
}

.version-number {
  font-weight: 600;
  font-size: 0.9rem;
  color: #374151;
}

.published-tag {
  font-size: 0.7rem;
  background: #d1fae5;
  color: #065f46;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-weight: 500;
}

.current-tag {
  font-size: 0.7rem;
  background: #dbeafe;
  color: #1e40af;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-weight: 500;
}

.version-time {
  margin-left: auto;
  font-size: 0.75rem;
  color: #9ca3af;
}

.version-preview {
  font-size: 0.8rem;
  color: #6b7280;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  margin-bottom: 0.25rem;
}

.version-actions {
  display: flex;
  gap: 0.5rem;
}

.rollback-link {
  background: none;
  border: none;
  color: #dc2626;
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.rollback-link:hover {
  color: #b91c1c;
}
</style>
