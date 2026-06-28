<script setup lang="ts">
import { computed } from 'vue';
import type { AiTaskProgressState } from '../../composables/useAiTaskProgress';

const props = defineProps<{
  progress: AiTaskProgressState;
  showTraceOnError?: boolean;
}>();

const showPanel = computed(
  () => props.progress.active || Boolean(props.progress.message) || Boolean(props.progress.error)
);

const stepLabel = computed(() => {
  const { currentStep, totalSteps } = props.progress;
  if (typeof currentStep === 'number' && typeof totalSteps === 'number' && totalSteps > 0) {
    return `${currentStep}/${totalSteps}`;
  }
  return '';
});
</script>

<template>
  <div
    v-if="showPanel"
    class="ai-task-progress"
    role="status"
    aria-live="polite"
    :class="{ 'ai-task-progress--error': Boolean(progress.error) }"
  >
    <p v-if="progress.message" class="ai-task-progress__message">
      <span v-if="stepLabel" class="ai-task-progress__step">{{ stepLabel }}</span>
      {{ progress.message }}
    </p>
    <p v-if="progress.error" class="ai-task-progress__error">
      {{ progress.error }}
      <span v-if="showTraceOnError && progress.traceId" class="ai-task-progress__trace">
        trace: {{ progress.traceId }}
      </span>
    </p>
  </div>
</template>

<style scoped>
.ai-task-progress {
  margin: 0.5rem 0 0.75rem;
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  border: 1px solid #bfdbfe;
  background: #f8fafc;
  font-size: 0.86rem;
  color: #374151;
}

.ai-task-progress--error {
  border-color: #fecaca;
  background: #fef2f2;
}

.ai-task-progress__message {
  margin: 0;
  line-height: 1.5;
}

.ai-task-progress__step {
  display: inline-block;
  margin-right: 0.45rem;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: #e0f2fe;
  color: #0369a1;
  font-size: 0.78rem;
  font-weight: 600;
}

.ai-task-progress__error {
  margin: 0.35rem 0 0;
  color: #b42318;
}

.ai-task-progress__trace {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.78rem;
  color: #9ca3af;
}
</style>
