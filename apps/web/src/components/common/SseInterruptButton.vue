<script setup lang="ts">
defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  interrupt: [];
}>();
</script>

<template>
  <button
    type="button"
    class="sse-interrupt-button"
    :disabled="disabled"
    @click="emit('interrupt')"
  >
    中断
  </button>
</template>

<style scoped>
.sse-interrupt-button {
  border: 1px solid #f59e0b;
  background: #fffbeb;
  color: #b45309;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.86rem;
  cursor: pointer;
}

.sse-interrupt-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
