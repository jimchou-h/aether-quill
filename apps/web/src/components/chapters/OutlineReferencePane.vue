<script setup lang="ts">
defineProps<{
  text: string;
  label?: string;
}>();
</script>

<template>
  <aside v-if="text.trim()" class="reference-pane">
    <p class="reference-label">{{ label || '对照正文' }}</p>
    <div class="reference-scroll">{{ text }}</div>
  </aside>
</template>

<style scoped>
.reference-pane {
  min-width: 0;
  position: sticky;
  top: 0;
  align-self: start;
}

.reference-label {
  margin: 0 0 0.35rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #374151;
}

.reference-scroll {
  max-height: min(72vh, 640px);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85rem;
  line-height: 1.65;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.65rem 0.75rem;
  background: #fafafa;
}

@media (max-width: 900px) {
  .reference-pane {
    position: static;
  }

  .reference-scroll {
    max-height: 280px;
  }
}
</style>
