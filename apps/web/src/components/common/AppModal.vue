<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  subtitle?: string;
  titleId: string;
  width?: string | number;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <a-modal
    :open="open"
    :width="width ?? 720"
    :destroy-on-close="true"
    :mask-closable="true"
    @cancel="emit('close')"
  >
    <template #title>
      <div>
        <span :id="titleId">{{ title }}</span>
        <p v-if="subtitle" class="modal-subtitle">{{ subtitle }}</p>
      </div>
    </template>

    <slot />

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </a-modal>
</template>

<style scoped>
.modal-subtitle {
  margin: 0.35rem 0 0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 0.85rem;
  font-weight: normal;
}
</style>
