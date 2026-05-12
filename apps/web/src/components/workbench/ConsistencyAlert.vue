<script setup lang="ts">
import type { ConsistencyNote } from '../../services/api';

/**
 * 一致性提示组件属性定义
 */
defineProps<{
  /** 一致性提示列表 */
  notes: ConsistencyNote[];
}>();
</script>

<template>
  <div v-if="notes.length > 0" class="consistency-alerts">
    <h4 class="alert-title">一致性提示</h4>
    <ul class="alert-list">
      <li
        v-for="(note, index) in notes"
        :key="`${note.level}-${index}`"
        class="alert-item"
        :class="`alert-${note.level}`"
      >
        <span class="alert-level-badge">{{ note.level }}</span>
        <span class="alert-message">{{ note.message }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.consistency-alerts {
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 1rem 1.15rem;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.03);
}

.alert-title {
  font-size: 0.95rem;
  margin: 0 0 0.75rem;
  color: #374151;
}

.alert-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.alert-item {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  font-size: 0.88rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  line-height: 1.55;
}

.alert-info {
  background: #f0f9ff;
  color: #0369a1;
}

.alert-warning {
  background: #fffbeb;
  color: #b45309;
}

.alert-block {
  background: #fef2f2;
  color: #b91c1c;
}

.alert-level-badge {
  flex-shrink: 0;
  font-size: 0.75rem;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
}

.alert-info .alert-level-badge {
  background: #bae6fd;
  color: #0369a1;
}

.alert-warning .alert-level-badge {
  background: #fde68a;
  color: #b45309;
}

.alert-block .alert-level-badge {
  background: #fecaca;
  color: #b91c1c;
}

.alert-message {
  flex: 1;
}
</style>
