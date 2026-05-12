<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  subtitle?: string;
  titleId: string;
  width?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-overlay"
      role="presentation"
      @click.self="emit('close')"
    >
      <section
        class="modal-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :style="width ? { width } : undefined"
      >
        <header class="modal-header">
          <div>
            <h3 :id="titleId" class="modal-title">{{ title }}</h3>
            <p v-if="subtitle" class="modal-subtitle">{{ subtitle }}</p>
          </div>
          <button type="button" class="modal-close" aria-label="关闭弹窗" @click="emit('close')">
            ×
          </button>
        </header>

        <div class="modal-body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(15, 23, 42, 0.45);
}

.modal-dialog {
  width: min(720px, 100%);
  max-height: calc(100vh - 3rem);
  overflow: auto;
  border-radius: 12px;
  background: #fff;
  padding: 1.25rem;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.18);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.modal-title {
  margin: 0;
  font-size: 1.1rem;
}

.modal-subtitle {
  margin: 0.35rem 0 0;
  color: #6b7280;
  font-size: 0.85rem;
}

.modal-close {
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.modal-close:hover {
  color: #111827;
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.65rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #e5e7eb;
}
</style>
