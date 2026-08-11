<script setup lang="ts">
import { computed } from 'vue';
import type { AiTaskProgressState } from '../../composables/useAiTaskProgress';
import SseInterruptButton from './SseInterruptButton.vue';

const props = defineProps<{
  progress: AiTaskProgressState;
  showTraceOnError?: boolean;
}>();

const emit = defineEmits<{
  interrupt: [];
  dismiss: [];
}>();

const showPanel = computed(
  () =>
    props.progress.active ||
    props.progress.cancelled ||
    Boolean(props.progress.message) ||
    Boolean(props.progress.error)
);

const stepLabel = computed(() => {
  const { currentStep, totalSteps } = props.progress;
  if (typeof currentStep === 'number' && typeof totalSteps === 'number' && totalSteps > 0) {
    return `${currentStep}/${totalSteps}`;
  }
  return '';
});

const chapterLabel = computed(() => {
  if (typeof props.progress.chapterNo !== 'number') {
    return '';
  }
  return `第 ${props.progress.chapterNo} 章`;
});

const showInterrupt = computed(
  () => props.progress.active && props.progress.interruptible
);

const showDismiss = computed(
  () =>
    !props.progress.active &&
    (props.progress.cancelled ||
      Boolean(props.progress.error) ||
      props.progress.stage === 'completed')
);
</script>

<template>
  <div
    v-if="showPanel"
    class="ai-task-progress"
    role="status"
    aria-live="polite"
    :class="{
      'ai-task-progress--error': Boolean(progress.error),
      'ai-task-progress--cancelled': progress.cancelled,
      'ai-task-progress--active': progress.active,
    }"
  >
    <div class="ai-task-progress__body">
      <p v-if="progress.message" class="ai-task-progress__message">
        <span v-if="chapterLabel" class="ai-task-progress__chapter">{{ chapterLabel }}</span>
        <span v-if="stepLabel" class="ai-task-progress__step">{{ stepLabel }}</span>
        {{ progress.message }}
      </p>
      <p v-if="progress.cancelled && !progress.error" class="ai-task-progress__cancelled">
        任务已中断，可重新发起。
      </p>
      <p v-if="progress.error" class="ai-task-progress__error">
        {{ progress.error }}
        <span v-if="showTraceOnError && progress.traceId" class="ai-task-progress__trace">
          trace: {{ progress.traceId }}
        </span>
      </p>
    </div>
    <div v-if="showInterrupt || showDismiss" class="ai-task-progress__actions">
      <SseInterruptButton v-if="showInterrupt" @interrupt="emit('interrupt')" />
      <button
        v-if="showDismiss"
        type="button"
        class="ai-task-progress__dismiss"
        @click="emit('dismiss')"
      >
        关闭
      </button>
    </div>
  </div>
</template>

<style scoped>
.ai-task-progress {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0.5rem 0 0.75rem;
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  border: 1px solid #bfdbfe;
  background: #f8fafc;
  font-size: 0.86rem;
  color: #374151;
}

.ai-task-progress--active {
  border-color: #93c5fd;
  background: #eff6ff;
}

.ai-task-progress--error {
  border-color: #fecaca;
  background: #fef2f2;
}

.ai-task-progress--cancelled {
  border-color: #fde68a;
  background: #fffbeb;
}

.ai-task-progress__body {
  flex: 1;
  min-width: 0;
}

.ai-task-progress__cancelled {
  margin: 0.35rem 0 0;
  color: #92400e;
  font-size: 0.84rem;
}

.ai-task-progress__message {
  margin: 0;
  line-height: 1.5;
}

.ai-task-progress__chapter,
.ai-task-progress__step {
  display: inline-block;
  margin-right: 0.45rem;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  font-size: 0.78rem;
  font-weight: 600;
}

.ai-task-progress__chapter {
  background: #e0e7ff;
  color: #3730a3;
}

.ai-task-progress__step {
  background: #e0f2fe;
  color: #0369a1;
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

.ai-task-progress__actions {
  display: flex;
  flex-shrink: 0;
  gap: 0.35rem;
  align-items: center;
}

.ai-task-progress__dismiss {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #4b5563;
  border-radius: 6px;
  padding: 0.3rem 0.65rem;
  font-size: 0.82rem;
  cursor: pointer;
}
</style>
