<script setup lang="ts">
import { computed } from 'vue';
import { confirmAction } from '../../composables/useAppConfirm';
import { useTaskPromptConfigStore } from '../../stores/taskPromptConfig';
import type { TaskPromptListItem } from '../../services/api';

const props = defineProps<{
  projectId: string;
  item: TaskPromptListItem;
}>();

const store = useTaskPromptConfigStore();

const templateKey = computed(() => props.item.templateKey);
const draftText = computed({
  get: () => store.draftFor(templateKey.value),
  set: (value: string) => store.setDraft(templateKey.value, value),
});

const isSaving = computed(() => store.savingKey === templateKey.value);
const isPublishing = computed(() => store.publishingKey === templateKey.value);
const isRollingBack = computed(() => store.rollingBackKey === templateKey.value);

const statusLabel = computed(() => {
  if (store.isPublished(templateKey.value)) {
    return '已发布';
  }
  if (store.isDraftModified(templateKey.value)) {
    return '草稿未保存';
  }
  return props.item.hasCustomPublished ? '草稿' : '仓库默认';
});

const statusClass = computed(() =>
  store.isPublished(templateKey.value) ? 'status-published' : 'status-draft'
);

async function handleSave() {
  await store.saveDraft(props.projectId, templateKey.value);
}

async function handlePublish() {
  await store.publish(props.projectId, templateKey.value);
}

async function handleRollback() {
  const confirmed = await confirmAction({
    title: '回滚任务 Prompt',
    content: `确定将「${props.item.name}」回滚到上一版本？`,
    okText: '确认回滚',
    danger: true,
  });
  if (confirmed) {
    await store.rollback(props.projectId, templateKey.value);
  }
}

async function handleRestoreDefault() {
  const confirmed = await confirmAction({
    title: '恢复仓库默认',
    content: `将「${props.item.name}」草稿恢复为仓库默认文本并保存，是否继续？`,
    okText: '恢复并保存',
    danger: true,
  });
  if (confirmed) {
    await store.restoreWarehouseDefault(props.projectId, templateKey.value);
  }
}
</script>

<template>
  <article class="task-prompt-card">
    <header class="card-header">
      <div>
        <h4 class="card-title">{{ item.name }}</h4>
        <p class="card-meta">
          <code>{{ item.templateKey }}</code>
          <span v-if="item.updatedAt"> · 更新于 {{ item.updatedAt }}</span>
        </p>
      </div>
      <div class="version-bar">
        <span class="version-badge" :class="statusClass">v{{ item.version }}</span>
        <span class="status-label" :class="statusClass">{{ statusLabel }}</span>
        <span class="char-count">{{ draftText.length }} 字</span>
      </div>
    </header>

    <details class="default-panel">
      <summary>查看仓库默认（只读）</summary>
      <pre class="default-text">{{ item.defaultText }}</pre>
    </details>

    <textarea
      v-model="draftText"
      class="field-textarea"
      :placeholder="`编辑 ${item.name} 的 system 角色指令`"
      rows="8"
    />

    <div class="action-bar">
      <button class="secondary-button" :disabled="isSaving" @click="handleSave">
        {{ isSaving ? '保存中...' : '保存草稿' }}
      </button>
      <button
        class="primary-button"
        :disabled="isPublishing || !store.canPublish(templateKey)"
        @click="handlePublish"
      >
        {{ isPublishing ? '发布中...' : '发布' }}
      </button>
      <button
        v-if="store.canRollback(templateKey)"
        class="rollback-button"
        :disabled="isRollingBack"
        @click="handleRollback"
      >
        {{ isRollingBack ? '回滚中...' : '回滚上一版' }}
      </button>
      <button
        v-if="item.hasCustomDraft || item.hasCustomPublished"
        class="ghost-button"
        :disabled="isSaving"
        @click="handleRestoreDefault"
      >
        恢复仓库默认
      </button>
    </div>
  </article>
</template>

<style scoped>
.task-prompt-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.9rem;
  background: #fafafa;
}

.card-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.card-title {
  margin: 0 0 0.25rem;
  font-size: 0.95rem;
}

.card-meta {
  margin: 0;
  color: #6b7280;
  font-size: 0.78rem;
}

.card-meta code {
  font-size: 0.75rem;
  background: #f3f4f6;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
}

.version-bar {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
}

.version-badge {
  font-size: 0.75rem;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  font-weight: 500;
}

.status-published {
  background: #d1fae5;
  color: #065f46;
}

.status-draft {
  background: #fef3c7;
  color: #92400e;
}

.status-label {
  font-size: 0.78rem;
  font-weight: 500;
}

.char-count {
  font-size: 0.78rem;
  color: #9ca3af;
}

.default-panel {
  margin-bottom: 0.65rem;
}

.default-panel summary {
  cursor: pointer;
  color: #6b7280;
  font-size: 0.8rem;
  margin-bottom: 0.35rem;
}

.default-text {
  margin: 0;
  padding: 0.55rem;
  background: #fff;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
  font-size: 0.78rem;
  white-space: pre-wrap;
  color: #4b5563;
  max-height: 160px;
  overflow: auto;
}

.field-textarea {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.6rem;
  font-size: 0.88rem;
  font-family: inherit;
  resize: vertical;
  min-height: 160px;
  margin-bottom: 0.65rem;
  background: #fff;
}

.field-textarea:focus {
  outline: none;
  border-color: var(--aq-primary);
  box-shadow: var(--aq-ring);
}

.action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.primary-button,
.secondary-button,
.rollback-button,
.ghost-button {
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  font-size: 0.82rem;
  cursor: pointer;
  border: none;
}

.primary-button {
  background: var(--aq-primary);
  color: #fff;
}

.primary-button:disabled,
.secondary-button:disabled,
.rollback-button:disabled,
.ghost-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-button {
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
}

.rollback-button {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.ghost-button {
  background: transparent;
  color: #6b7280;
  border: 1px solid #e5e7eb;
}
</style>
