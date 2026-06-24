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
      按任务配置 system 角色指令（首期：章节优化）。发布后作用于本项目的 optimize 调用；未自定义时使用仓库默认。
    </p>

    <p v-if="store.status === 'loading'" class="loading-hint">正在加载任务 Prompt...</p>

    <div v-else class="task-list">
      <TaskPromptItemEditor
        v-for="item in store.chapterOptimizeItems"
        :key="item.templateKey"
        :project-id="projectId"
        :item="item"
      />
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

.task-list {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
