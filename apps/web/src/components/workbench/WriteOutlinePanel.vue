<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { presentInfo } from '../../utils/pageFeedback';

const props = withDefaults(
  defineProps<{
    outlineText: string;
    outlineConfirmed: boolean;
    isOutlineStreaming: boolean;
    isDraftStreaming: boolean;
    hasOutline: boolean;
    embedded?: boolean;
  }>(),
  { embedded: false }
);

const emit = defineEmits<{
  'update:outlineText': [value: string];
  confirm: [];
  regenerate: [];
  'generate-draft': [];
}>();

const localOutline = ref(props.outlineText);

watch(
  () => props.outlineText,
  (value) => {
    localOutline.value = value;
  }
);

watch(localOutline, (value, oldValue) => {
  if (value !== oldValue) {
    emit('update:outlineText', value);
  }
});

const canConfirm = computed(
  () => props.hasOutline && !props.isOutlineStreaming && localOutline.value.trim().length > 0
);

const canGenerateDraft = computed(
  () =>
    props.outlineConfirmed &&
    !props.isOutlineStreaming &&
    !props.isDraftStreaming &&
    localOutline.value.trim().length > 0
);

const statusTone = computed(() => {
  if (props.outlineConfirmed) return 'ok';
  if (props.hasOutline && !props.isOutlineStreaming) return 'warn';
  if (props.isOutlineStreaming) return 'busy';
  return 'idle';
});

function handleConfirm() {
  if (!canConfirm.value) {
    return;
  }
  emit('confirm');
}

function handleGenerateDraft() {
  if (!props.outlineConfirmed) {
    presentInfo('请先确认章节大纲后再生成正文');
    return;
  }
  if (!canGenerateDraft.value) {
    return;
  }
  emit('generate-draft');
}
</script>

<template>
  <section class="outline-panel" :class="{ 'outline-panel--embedded': embedded }">
    <header v-if="!embedded" class="outline-panel-header">
      <h3 class="outline-panel-title">章节大纲</h3>
      <p class="outline-panel-desc">确认结构后再生成正文；编辑或重生成后需再次确认。</p>
    </header>

    <div class="outline-status" :class="`outline-status--${statusTone}`" role="status">
      <template v-if="statusTone === 'ok'">大纲已确认，可以进入正文生成。</template>
      <template v-else-if="statusTone === 'warn'">请检查大纲内容并点击「确认大纲」。</template>
      <template v-else-if="statusTone === 'busy'">正在流式生成大纲，请稍候…</template>
      <template v-else>在左侧填写要求后，点击「生成章节大纲」。</template>
    </div>

    <div v-if="isOutlineStreaming && !localOutline" class="outline-skeleton" aria-hidden="true">
      <span class="skeleton-line skeleton-line--lg" />
      <span class="skeleton-line" />
      <span class="skeleton-line" />
      <span class="skeleton-line skeleton-line--short" />
    </div>

    <label v-else class="outline-field">
      <span class="outline-field-label">大纲内容（可直接编辑）</span>
      <textarea
        v-model="localOutline"
        class="outline-textarea"
        rows="16"
        :disabled="isOutlineStreaming"
        placeholder="建议按场景/节拍组织，例如：&#10;1. 雨夜码头 — 主角与导师对峙&#10;2. 怀表线索 — 情绪转折与悬念"
      />
    </label>

    <footer class="outline-footer">
      <button
        type="button"
        class="wb-btn wb-btn--ghost"
        :disabled="isOutlineStreaming || isDraftStreaming || !hasOutline"
        @click="emit('regenerate')"
      >
        重新生成
      </button>
      <button
        type="button"
        class="wb-btn wb-btn--secondary"
        :disabled="!canConfirm || isDraftStreaming"
        @click="handleConfirm"
      >
        {{ outlineConfirmed ? '再次确认' : '确认大纲' }}
      </button>
      <button
        type="button"
        class="wb-btn wb-btn--primary"
        :disabled="!canGenerateDraft"
        @click="handleGenerateDraft"
      >
        {{ isDraftStreaming ? '正文生成中…' : '生成正文' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.outline-panel {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 1.15rem;
}

.outline-panel--embedded {
  padding: 1rem 1.15rem 0;
}

.outline-panel-header {
  margin-bottom: 0.85rem;
}

.outline-panel-title {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--wb-text);
}

.outline-panel-desc {
  margin: 0;
  font-size: 0.85rem;
  color: var(--wb-text-secondary);
  line-height: 1.5;
}

.outline-status {
  margin-bottom: 0.85rem;
  padding: 0.6rem 0.85rem;
  border-radius: var(--wb-radius-sm);
  font-size: 0.84rem;
  line-height: 1.45;
  border: 1px solid var(--wb-border);
}

.outline-status--idle {
  background: var(--wb-surface-muted);
  color: var(--wb-text-secondary);
}

.outline-status--busy {
  background: var(--wb-primary-soft);
  border-color: #c7d2fe;
  color: var(--wb-primary);
}

.outline-status--warn {
  background: var(--wb-warning-soft);
  border-color: #fde68a;
  color: #92400e;
}

.outline-status--ok {
  background: var(--wb-success-soft);
  border-color: #a7f3d0;
  color: #047857;
}

.outline-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-bottom: 1rem;
  padding: 1rem;
  border-radius: var(--wb-radius-sm);
  border: 1px dashed var(--wb-border);
  background: var(--wb-surface-muted);
}

.skeleton-line {
  display: block;
  height: 0.75rem;
  border-radius: 6px;
  background: linear-gradient(90deg, #e2e8f0 0%, #f1f5f9 50%, #e2e8f0 100%);
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

.skeleton-line--lg {
  height: 1rem;
  width: 72%;
}

.skeleton-line--short {
  width: 45%;
}

@keyframes shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.outline-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-height: 0;
}

.outline-field-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--wb-text-secondary);
}

.outline-textarea {
  flex: 1;
  width: 100%;
  min-height: 320px;
  padding: 0.85rem 1rem;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  font-family: var(--wb-font);
  font-size: 0.92rem;
  line-height: 1.65;
  color: var(--wb-text);
  resize: vertical;
  background: var(--wb-surface);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.outline-textarea:focus {
  outline: none;
  border-color: var(--wb-primary);
  box-shadow: 0 0 0 3px var(--wb-primary-soft);
}

.outline-textarea:disabled {
  background: var(--wb-surface-muted);
  color: var(--wb-text-muted);
}

.outline-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.85rem 0 1rem;
  background: linear-gradient(to top, var(--wb-surface) 70%, transparent);
}

.wb-btn {
  min-height: 2.5rem;
  padding: 0.5rem 1rem;
  border-radius: var(--wb-radius-sm);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    opacity 0.15s;
}

.wb-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.wb-btn--primary {
  border: none;
  background: var(--wb-primary);
  color: #fff;
}

.wb-btn--primary:hover:not(:disabled) {
  background: var(--wb-primary-hover);
}

.wb-btn--secondary {
  border: 1px solid var(--wb-border-strong);
  background: var(--wb-surface);
  color: var(--wb-text);
}

.wb-btn--secondary:hover:not(:disabled) {
  background: var(--wb-surface-muted);
}

.wb-btn--ghost {
  border: 1px solid transparent;
  background: transparent;
  color: var(--wb-text-secondary);
}

.wb-btn--ghost:hover:not(:disabled) {
  background: var(--wb-surface-muted);
  color: var(--wb-text);
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-line {
    animation: none;
  }
}
</style>
