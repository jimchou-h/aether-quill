<script setup lang="ts">
export type WorkbenchStepId = 'requirements' | 'outline' | 'draft';

export interface WorkbenchStepItem {
  id: WorkbenchStepId;
  label: string;
  hint: string;
  status: 'pending' | 'active' | 'done' | 'locked';
}

defineProps<{
  steps: WorkbenchStepItem[];
}>();
</script>

<template>
  <nav class="wb-stepper" aria-label="写作流程步骤">
    <ol class="wb-stepper-list">
      <li
        v-for="(step, index) in steps"
        :key="step.id"
        class="wb-stepper-item"
        :class="`wb-stepper-item--${step.status}`"
      >
        <div class="wb-stepper-marker" aria-hidden="true">
          <span v-if="step.status === 'done'" class="wb-stepper-check">✓</span>
          <span v-else>{{ index + 1 }}</span>
        </div>
        <div class="wb-stepper-copy">
          <span class="wb-stepper-label">{{ step.label }}</span>
          <span class="wb-stepper-hint">{{ step.hint }}</span>
        </div>
        <span v-if="index < steps.length - 1" class="wb-stepper-connector" aria-hidden="true" />
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.wb-stepper {
  padding: 1rem 1.15rem;
  border-radius: var(--wb-radius);
  border: 1px solid var(--wb-border);
  background: var(--wb-surface);
  box-shadow: var(--wb-shadow);
}

.wb-stepper-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.wb-stepper-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  min-width: 0;
}

.wb-stepper-marker {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 700;
  border: 2px solid var(--wb-border-strong);
  color: var(--wb-text-muted);
  background: var(--wb-surface-muted);
  transition:
    border-color 0.2s,
    background 0.2s,
    color 0.2s;
}

.wb-stepper-item--active .wb-stepper-marker {
  border-color: var(--wb-primary);
  background: var(--wb-primary);
  color: #fff;
  box-shadow: 0 0 0 4px var(--wb-primary-soft);
}

.wb-stepper-item--done .wb-stepper-marker {
  border-color: var(--wb-success);
  background: var(--wb-success-soft);
  color: var(--wb-success);
}

.wb-stepper-item--locked .wb-stepper-marker {
  opacity: 0.55;
}

.wb-stepper-check {
  font-size: 0.9rem;
  line-height: 1;
}

.wb-stepper-copy {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  padding-top: 0.1rem;
}

.wb-stepper-label {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--wb-text);
  line-height: 1.3;
}

.wb-stepper-item--active .wb-stepper-label {
  color: var(--wb-primary);
}

.wb-stepper-hint {
  font-size: 0.78rem;
  color: var(--wb-text-secondary);
  line-height: 1.4;
}

.wb-stepper-connector {
  display: none;
}

@media (max-width: 900px) {
  .wb-stepper-list {
    grid-template-columns: 1fr;
  }
}
</style>
