<script setup lang="ts">
import { useTaskPromptConfigStore } from '../../stores/taskPromptConfig';
import TaskPromptItemEditor from './TaskPromptItemEditor.vue';

defineProps<{
  projectId: string;
}>();

const store = useTaskPromptConfigStore();
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">任务 Prompt</h3>
    <p class="field-hint">
      按改文链路分组配置 system 角色指令。发布后作用于本项目的对应任务；未自定义时使用仓库默认。
    </p>

    <p v-if="store.status === 'loading'" class="loading-hint">正在加载任务 Prompt...</p>

    <div v-else class="task-groups">
      <details
        v-for="group in store.taskPromptGroups"
        :key="group.id"
        class="task-group"
        :open="group.defaultOpen"
      >
        <summary class="task-group-summary">
          <span class="task-group-title">{{ group.title }}</span>
          <span class="task-group-count">
            {{ store.groupedItems[group.id].length }} 项
          </span>
        </summary>
        <p class="task-group-hint">{{ group.hint }}</p>
        <div v-if="store.groupedItems[group.id].length" class="task-list">
          <TaskPromptItemEditor
            v-for="item in store.groupedItems[group.id]"
            :key="item.templateKey"
            :project-id="projectId"
            :item="item"
          />
        </div>
        <p v-else class="empty-hint">该分组暂无任务 Prompt</p>
      </details>
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
  margin-bottom: 0.85rem;
}

.loading-hint {
  color: #6b7280;
  font-size: 0.85rem;
}

.task-groups {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.task-group {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.55rem 0.75rem 0.75rem;
  background: #fafafa;
}

.task-group-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  cursor: pointer;
  list-style: none;
  font-weight: 600;
  color: #111827;
}

.task-group-summary::-webkit-details-marker {
  display: none;
}

.task-group-title {
  font-size: 0.92rem;
}

.task-group-count {
  font-size: 0.78rem;
  font-weight: 500;
  color: #6b7280;
}

.task-group-hint {
  margin: 0.45rem 0 0.65rem;
  font-size: 0.78rem;
  color: #9ca3af;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.empty-hint {
  margin: 0.35rem 0 0;
  font-size: 0.82rem;
  color: #9ca3af;
}
</style>
