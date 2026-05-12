<script setup lang="ts">
import { useNotifier } from '../../composables/useNotifier';

const { toasts, dismiss } = useNotifier();
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-relevant="additions" aria-atomic="false">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast"
      :class="`toast-${toast.variant}`"
      role="status"
    >
      <p class="toast-message">{{ toast.message }}</p>
      <button type="button" class="toast-dismiss" aria-label="关闭提示" @click="dismiss(toast.id)">
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 72px;
  right: 1rem;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(360px, calc(100vw - 2rem));
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  border-radius: 10px;
  border: 1px solid transparent;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
  pointer-events: auto;
}

.toast-error {
  border-color: #fecdca;
  background: #fef3f2;
  color: #b42318;
}

.toast-success {
  border-color: #abefc6;
  background: #ecfdf3;
  color: #067647;
}

.toast-info {
  border-color: #b2ddff;
  background: #eff8ff;
  color: #175cd3;
}

.toast-message {
  flex: 1;
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
}

.toast-dismiss {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  opacity: 0.7;
}

.toast-dismiss:hover {
  opacity: 1;
}
</style>
