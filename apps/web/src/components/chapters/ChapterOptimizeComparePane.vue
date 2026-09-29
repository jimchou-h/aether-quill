<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from 'vue';
import { buildOptimizeDiffBundle } from '../../utils/chapterOptimizeDiff';

const props = withDefaults(
  defineProps<{
    original: string;
    originalTitle?: string;
    draftTitle?: string;
    draftDisabled?: boolean;
    /** 流式未完成时关掉对照，避免每条 SSE 重算整章 diff */
    showDiff?: boolean;
    /** 只看红绿对照时关掉上下两栏编辑器，避免和工作台自己的成稿框重复 */
    showEditors?: boolean;
  }>(),
  { showDiff: true, showEditors: true }
);

const draft = defineModel<string>({ required: true });

/** 流式生成中用只读 pre，避免 textarea 每个合批都重绑整章 value。 */
const showStreamPreview = computed(() => props.draftDisabled === true && props.showDiff === false);

/** 流式预览只渲染末尾，布局成本与章长脱钩；完整正文仍在 model 里，结束后进可编辑框。 */
const STREAM_PREVIEW_CHARS = 3000;
const streamPreviewText = computed(() => {
  const text = draft.value;
  if (text.length <= STREAM_PREVIEW_CHARS) {
    return text;
  }
  return `…\n${text.slice(-STREAM_PREVIEW_CHARS)}`;
});

const diffReady = computed(() => props.showDiff);
/** 等一帧再算对照，先让「生成完成」状态画出来，避免结束瞬间卡死。 */
const diffComputeReady = shallowRef(false);
let diffComputeToken = 0;

watch(
  () => [props.showDiff, props.original, draft.value] as const,
  async ([ready]) => {
    const token = ++diffComputeToken;
    if (!ready) {
      diffComputeReady.value = false;
      return;
    }
    diffComputeReady.value = false;
    await nextTick();
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    if (token !== diffComputeToken || !props.showDiff) {
      return;
    }
    diffComputeReady.value = true;
  },
  { immediate: true }
);

const diffBundle = computed(() => {
  if (!diffReady.value || !diffComputeReady.value) {
    return null;
  }
  return buildOptimizeDiffBundle(props.original, draft.value);
});

const inlineDiff = computed(
  () => diffBundle.value?.inline ?? { originalSegments: [], draftSegments: [] }
);
const addedCount = computed(() => diffBundle.value?.addedCount ?? 0);
const removedCount = computed(() => diffBundle.value?.removedCount ?? 0);
const modifiedCount = computed(() => diffBundle.value?.modifiedCount ?? 0);
const hasDiff = computed(() =>
  Boolean(
    diffBundle.value &&
      props.original.trim() &&
      draft.value.trim() &&
      diffBundle.value.lines.length > 0
  )
);
</script>

<template>
  <div class="optimize-compare">
    <div v-if="showEditors" class="compare-grid compare-grid--editors">
      <div class="compare-panel">
        <h4 class="panel-title">{{ originalTitle ?? '原文' }}</h4>
        <pre class="original-text">{{ original }}</pre>
      </div>
      <div class="compare-panel">
        <h4 class="panel-title">{{ draftTitle ?? '成稿（可编辑）' }}</h4>
        <pre v-if="showStreamPreview" class="draft-input draft-stream-preview">{{
          streamPreviewText
        }}</pre>
        <textarea v-else v-model="draft" class="draft-input" :disabled="draftDisabled" />
      </div>
    </div>
    <p v-if="!diffReady" class="diff-pending">生成完成后显示对照</p>
    <p v-else-if="!diffComputeReady" class="diff-pending">正在生成对照…</p>
    <div v-else-if="hasDiff" class="diff-block">
      <div class="diff-summary">
        <span class="diff-badge diff-removed">-{{ removedCount }} 删除</span>
        <span class="diff-badge diff-added">+{{ addedCount }} 新增</span>
        <span class="diff-badge diff-modified">~{{ modifiedCount }} 修改</span>
      </div>
      <div class="compare-grid compare-grid--diff">
        <div class="compare-panel">
          <h4 class="panel-title">原文（标红为删除）</h4>
          <pre
            class="diff-pane diff-pane--original"
          ><template v-for="(seg, idx) in inlineDiff.originalSegments" :key="'o-' + idx"><span :class="{ 'diff-removed-text': seg.removed }">{{ seg.text }}</span></template></pre>
        </div>
        <div class="compare-panel">
          <h4 class="panel-title">成稿（标绿为新增）</h4>
          <pre
            class="diff-pane diff-pane--draft"
          ><template v-for="(seg, idx) in inlineDiff.draftSegments" :key="'d-' + idx"><span :class="{ 'diff-added-text': seg.added }">{{ seg.text }}</span></template></pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.optimize-compare {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-items: stretch;
}
.compare-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.compare-grid--editors .compare-panel {
  height: auto;
}
.panel-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: #4b5563;
}
.original-text,
.draft-input {
  flex: 0 0 200px;
  margin: 0;
  height: 200px;
  min-height: 200px;
  max-height: 200px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.65;
  color: #111827;
  box-sizing: border-box;
}
.diff-pane {
  margin: 0;
  height: auto;
  max-height: none;
  overflow: visible;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.75;
  font-weight: 500;
  color: #111827;
  box-sizing: border-box;
}
.diff-pane--original {
  background: #fef2f2;
  border-color: #fecaca;
}
.diff-pane--draft {
  background: #f0fdf4;
  border-color: #bbf7d0;
}
.original-text {
  background: #f8fafc;
  font-family: inherit;
}
.draft-input {
  width: 100%;
  font-family: inherit;
  resize: none;
}
.draft-stream-preview {
  background: #fff;
}
.diff-pending {
  margin: 0;
  padding: 8px 0 2px;
  font-size: 12px;
  color: #6b7280;
}
.diff-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.diff-summary {
  display: flex;
  gap: 8px;
}
.diff-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.diff-added {
  background: #4ade80;
  color: #14532d;
}
.diff-removed {
  background: #f87171;
  color: #7f1d1d;
}
.diff-modified {
  background: #fbbf24;
  color: #78350f;
}
.diff-removed-text {
  background: #ef4444;
  color: #1c1917;
  font-weight: 600;
  text-decoration: line-through;
  padding: 0.08em 0.16em;
  border-radius: 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.diff-added-text {
  background: #22c55e;
  color: #052e16;
  font-weight: 700;
  padding: 0.08em 0.16em;
  border-radius: 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
@media (max-width: 720px) {
  .compare-grid {
    grid-template-columns: 1fr;
  }
}
</style>
