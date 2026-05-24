<script setup lang="ts">
import { withDefaults } from 'vue';
import type { ConsistencyNote } from '../../services/api';

withDefaults(
  defineProps<{
    notes: ConsistencyNote[];
    embedded?: boolean;
  }>(),
  { embedded: false }
);
</script>

<template>
  <div
    v-if="notes.length > 0"
    class="consistency-alerts"
    :class="{ 'consistency-alerts--embedded': embedded }"
  >
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
  border-radius: 12px;
  padding: 1rem 1.15rem;
  background: #fff;
}

.consistency-alerts--embedded {
  border-radius: var(--wb-radius-sm);
  border-color: var(--wb-border);
  background: var(--wb-surface-muted);
  padding: 0.85rem 1rem;
}

.alert-title {
  font-size: 0.92rem;
  margin: 0 0 0.65rem;
  color: #374151;
}

.alert-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.alert-item {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  font-size: 0.85rem;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  line-height: 1.5;
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
  font-size: 0.7rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
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
