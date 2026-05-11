<script setup lang="ts">
import { usePromptConfigStore } from '../../stores/promptConfig';

const store = usePromptConfigStore();
const props = defineProps<{ projectId: string }>();

const emit = defineEmits<{
  saved: [];
  published: [];
  rolledBack: [];
}>();

function handleSave() {
  store.saveDraft(props.projectId);
  emit('saved');
}

function handlePublish() {
  store.publish(props.projectId);
  emit('published');
}

function handleRollback() {
  store.rollback(props.projectId, store.currentVersion - 1);
  emit('rolledBack');
}
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">系统提示词（systemPromptText）</h3>
    <p class="field-hint">设置该项目的全局写作约束和风格指导，保存后生成链路将使用此文本。</p>

    <div class="version-bar">
      <span
        class="version-badge"
        :class="store.isPublished ? 'version-published' : 'version-draft'"
      >
        v{{ store.currentVersion }}
      </span>
      <span class="status-label" :class="store.isPublished ? 'status-published' : 'status-draft'">
        {{ store.isPublished ? '已发布' : '草稿' }}
      </span>
      <span class="char-count">已输入 {{ store.draftText.length }} 字</span>
    </div>

    <textarea
      v-model="store.draftText"
      class="field-textarea"
      placeholder="设置该项目的全局写作约束和风格指导"
      rows="6"
    />

    <div class="action-bar">
      <button class="secondary-button" :disabled="store.saving" @click="handleSave">
        {{ store.saving ? '保存中...' : '保存草稿' }}
      </button>
      <button
        class="primary-button"
        :disabled="store.publishing || !store.isDraftModified"
        @click="handlePublish"
      >
        {{ store.publishing ? '发布中...' : '发布' }}
      </button>
      <button
        v-if="store.hasVersions"
        class="rollback-button"
        :disabled="store.rollingBack"
        @click="handleRollback"
      >
        {{ store.rollingBack ? '回滚中...' : `回滚到 v${store.currentVersion - 1}` }}
      </button>
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

.version-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.version-badge {
  font-size: 0.8rem;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  font-weight: 500;
}

.version-published {
  background: #d1fae5;
  color: #065f46;
}

.version-draft {
  background: #fef3c7;
  color: #92400e;
}

.status-label {
  font-size: 0.8rem;
  font-weight: 500;
}

.status-published {
  color: #065f46;
}

.status-draft {
  color: #92400e;
}

.char-count {
  margin-left: auto;
  font-size: 0.8rem;
  color: #9ca3af;
}

.field-textarea {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.6rem;
  font-size: 0.9rem;
  font-family: inherit;
  resize: vertical;
  min-height: 140px;
  margin-bottom: 0.75rem;
}

.field-textarea:focus {
  outline: none;
  border-color: #1d4ed8;
  box-shadow: 0 0 0 2px rgba(29, 78, 216, 0.1);
}

.action-bar {
  display: flex;
  gap: 0.5rem;
}

.primary-button,
.secondary-button,
.rollback-button {
  border-radius: 6px;
  padding: 0.45rem 0.8rem;
  font-size: 0.85rem;
  cursor: pointer;
  border: none;
}

.primary-button {
  background: #1d4ed8;
  color: #fff;
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

.rollback-button {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.rollback-button:hover {
  background: #fee2e2;
}

.rollback-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
