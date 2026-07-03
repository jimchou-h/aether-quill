<script setup lang="ts">
import OutlineReferencePane from './OutlineReferencePane.vue';

defineProps<{
  referenceText?: string;
  referenceLabel?: string;
}>();
</script>

<template>
  <div
    class="outline-review-layout"
    :class="{ 'with-reference': Boolean(referenceText?.trim()) }"
  >
    <div class="outline-review-main">
      <slot />
    </div>
    <OutlineReferencePane
      v-if="referenceText?.trim()"
      :text="referenceText"
      :label="referenceLabel"
    />
  </div>
</template>

<style scoped>
.outline-review-layout {
  display: block;
}

.outline-review-layout.with-reference {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.85rem;
  align-items: start;
}

.outline-review-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

@media (max-width: 900px) {
  .outline-review-layout.with-reference {
    grid-template-columns: 1fr;
  }
}
</style>
