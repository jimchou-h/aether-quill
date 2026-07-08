<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PipelineOutlineItem } from '../../services/api';
import { isPipelineOutlineEmpty } from '../../utils/pipelineOutline';

const props = defineProps<{
  title: string;
  hint: string;
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
  busy?: boolean;
  revisionRound?: number;
  generated?: boolean;
  generateLabel?: string;
  /** 大纲审阅时对照阅读的章节正文（只读） */
  referenceText?: string;
  referenceLabel?: string;
  /** 为 false 时由外层 OutlineReviewLayout 展示正文对照 */
  embedReference?: boolean;
}>();

const emit = defineEmits<{
  'update:required': [items: PipelineOutlineItem[]];
  'update:suggested': [items: PipelineOutlineItem[]];
  confirm: [];
  recheck: [];
  revise: [feedback: string];
  generate: [feedback?: string];
}>();

const feedback = ref('');
const revising = ref(false);
const rechecking = ref(false);

const showEmbeddedReference = computed(
  () => props.embedReference !== false && Boolean(props.referenceText?.trim())
);

const isOutlineEmpty = computed(() => isPipelineOutlineEmpty(props.required, props.suggested));

const isGenerated = computed(() => props.generated !== false);

function updateRequiredItem(id: string, patch: Partial<PipelineOutlineItem>) {
  emit(
    'update:required',
    props.required.map((item) => (item.id === id ? { ...item, ...patch } : item))
  );
}

function updateSuggestedItem(id: string, patch: Partial<PipelineOutlineItem>) {
  emit(
    'update:suggested',
    props.suggested.map((item) => (item.id === id ? { ...item, ...patch } : item))
  );
}

function removeRequired(id: string) {
  emit(
    'update:required',
    props.required.filter((item) => item.id !== id)
  );
}

function removeSuggested(id: string) {
  emit(
    'update:suggested',
    props.suggested.filter((item) => item.id !== id)
  );
}

function addManualItem(priority: 'required' | 'suggested') {
  const item: PipelineOutlineItem = {
    id: `manual-${Date.now()}`,
    text: '',
    priority,
  };
  if (priority === 'required') {
    emit('update:required', [...props.required, item]);
  } else {
    emit('update:suggested', [...props.suggested, item]);
  }
}

function togglePriority(item: PipelineOutlineItem, from: 'required' | 'suggested') {
  const to: 'required' | 'suggested' = from === 'required' ? 'suggested' : 'required';
  const next: PipelineOutlineItem = { ...item, priority: to };
  if (from === 'required') {
    emit(
      'update:required',
      props.required.filter((row) => row.id !== item.id)
    );
    emit('update:suggested', [...props.suggested, next]);
  } else {
    emit(
      'update:suggested',
      props.suggested.filter((row) => row.id !== item.id)
    );
    emit('update:required', [...props.required, next]);
  }
}

async function submitRecheck() {
  if (rechecking.value || revising.value || props.busy) {
    return;
  }
  rechecking.value = true;
  try {
    emit('recheck');
  } finally {
    rechecking.value = false;
  }
}

async function submitRevise() {
  const text = feedback.value.trim();
  if (!text || revising.value || props.busy) {
    return;
  }
  revising.value = true;
  try {
    emit('revise', text);
    feedback.value = '';
  } finally {
    revising.value = false;
  }
}

function submitGenerate() {
  if (props.busy) {
    return;
  }
  const text = feedback.value.trim();
  emit('generate', text || undefined);
}
</script>

<template>
  <section class="outline-editor">
    <h4 class="section-title">{{ title }}</h4>
    <p class="meta-line">{{ hint }}</p>
    <p v-if="revisionRound && revisionRound > 0" class="meta-line">
      已复核/修订 {{ revisionRound }} 轮，可先「重新检查」对照正文，有具体修改点再「按意见修订」。
    </p>

    <div class="outline-layout" :class="{ 'with-reference': showEmbeddedReference }">
      <div class="outline-main">
        <div class="outline-panel">
          <div class="outline-group">
            <div class="outline-group-header">
              <p class="outline-label required">必需项</p>
              <button
                class="text-button"
                type="button"
                :disabled="busy || !isGenerated"
                @click="addManualItem('required')"
              >
                添加
              </button>
            </div>
            <ul v-if="required.length" class="outline-list">
              <li v-for="item in required" :key="item.id" class="outline-item-row editable">
                <textarea
                  :value="item.text"
                  class="outline-text-input"
                  rows="2"
                  :disabled="busy || !isGenerated"
                  @input="
                    updateRequiredItem(item.id, {
                      text: ($event.target as HTMLTextAreaElement).value,
                    })
                  "
                />
                <div
                  v-if="item.personaName || item.featureRef || item.anchorHint"
                  class="outline-meta"
                >
                  <span v-if="item.personaName">角色：{{ item.personaName }}</span>
                  <span v-if="item.featureRef">特征：{{ item.featureRef }}</span>
                  <span v-if="item.anchorHint">落笔：{{ item.anchorHint }}</span>
                </div>
                <ul v-if="item.contentWarnings?.length" class="outline-warnings">
                  <li v-for="warning in item.contentWarnings" :key="warning">{{ warning }}</li>
                </ul>
                <div class="outline-item-actions">
                  <button
                    class="text-button"
                    type="button"
                    :disabled="busy || !isGenerated"
                    @click="togglePriority(item, 'required')"
                  >
                    降为建议
                  </button>
                  <button
                    class="text-button danger"
                    type="button"
                    :disabled="busy || !isGenerated"
                    @click="removeRequired(item.id)"
                  >
                    删除
                  </button>
                </div>
              </li>
            </ul>
            <p v-else class="empty-hint">暂无必需项</p>
          </div>

          <div class="outline-group">
            <div class="outline-group-header">
              <p class="outline-label suggested">建议项</p>
              <button
                class="text-button"
                type="button"
                :disabled="busy || !isGenerated"
                @click="addManualItem('suggested')"
              >
                添加
              </button>
            </div>
            <ul v-if="suggested.length" class="outline-list">
              <li v-for="item in suggested" :key="item.id" class="outline-item-row editable">
                <textarea
                  :value="item.text"
                  class="outline-text-input"
                  rows="2"
                  :disabled="busy || !isGenerated"
                  @input="
                    updateSuggestedItem(item.id, {
                      text: ($event.target as HTMLTextAreaElement).value,
                    })
                  "
                />
                <div
                  v-if="item.personaName || item.featureRef || item.anchorHint"
                  class="outline-meta"
                >
                  <span v-if="item.personaName">角色：{{ item.personaName }}</span>
                  <span v-if="item.featureRef">特征：{{ item.featureRef }}</span>
                  <span v-if="item.anchorHint">落笔：{{ item.anchorHint }}</span>
                </div>
                <div class="outline-item-actions">
                  <button
                    class="text-button"
                    type="button"
                    :disabled="busy || !isGenerated"
                    @click="togglePriority(item, 'suggested')"
                  >
                    升为必需
                  </button>
                  <button
                    class="text-button danger"
                    type="button"
                    :disabled="busy || !isGenerated"
                    @click="removeSuggested(item.id)"
                  >
                    删除
                  </button>
                </div>
              </li>
            </ul>
            <p v-else class="empty-hint">暂无建议项</p>
          </div>
        </div>
      </div>

      <aside v-if="showEmbeddedReference" class="reference-pane">
        <p class="reference-label">{{ referenceLabel || '对照正文' }}</p>
        <div class="reference-scroll">{{ referenceText }}</div>
      </aside>
    </div>

    <div class="revise-block">
      <p v-if="!isGenerated" class="empty-outline-hint left">
        先阅读左侧对照正文，再点击生成当前模块大纲；也可以先填写修改意见，系统会在首次生成后自动按意见再修订一次。
      </p>
      <div class="revise-actions">
        <button
          v-if="isGenerated"
          class="secondary-button"
          type="button"
          :disabled="busy || rechecking || revising || !isGenerated"
          @click="submitRecheck"
        >
          {{ rechecking ? '检查中…' : 'AI 重新检查' }}
        </button>
      </div>
      <label class="field-label" for="outline-feedback">修改意见（AI 按意见修订）</label>
      <textarea
        id="outline-feedback"
        v-model="feedback"
        class="feedback-input"
        rows="3"
        maxlength="2000"
        placeholder="例如：删掉第 2 条，把第 3 条改成只改口吻不改动作"
        :disabled="busy || rechecking || revising"
      />
      <button
        v-if="isGenerated"
        class="secondary-button"
        type="button"
        :disabled="busy || rechecking || revising || !feedback.trim() || !isGenerated"
        @click="submitRevise"
      >
        {{ revising ? '修订中…' : 'AI 按意见修订' }}
      </button>
      <button v-else class="primary-button" type="button" :disabled="busy" @click="submitGenerate">
        {{ busy ? '生成中…' : feedback.trim() ? '按意见生成大纲' : generateLabel || '生成大纲' }}
      </button>
    </div>

    <div class="step-actions">
      <p v-if="isGenerated && isOutlineEmpty" class="empty-outline-hint">
        当前无修改项，确认后将保留原文并继续。
      </p>
      <button
        class="primary-button"
        type="button"
        :disabled="busy || !isGenerated"
        @click="emit('confirm')"
      >
        确认大纲并改写
      </button>
    </div>
  </section>
</template>

<style scoped>
.section-title {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
}

.meta-line {
  margin: 0 0 0.5rem;
  font-size: 0.82rem;
  color: #6b7280;
}

.outline-panel {
  display: grid;
  gap: 0.75rem;
}

.outline-layout {
  display: block;
  margin-bottom: 0.75rem;
}

.outline-layout.with-reference {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
}

.outline-main {
  min-width: 0;
}

.reference-pane {
  min-width: 0;
  position: sticky;
  top: 0;
}

.reference-label {
  margin: 0 0 0.35rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #374151;
}

.reference-scroll {
  max-height: min(56vh, 560px);
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
  .outline-layout.with-reference {
    grid-template-columns: 1fr;
  }

  .reference-pane {
    position: static;
  }

  .reference-scroll {
    max-height: 240px;
  }
}

.outline-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.outline-label {
  margin: 0 0 0.35rem;
  font-size: 0.85rem;
  font-weight: 600;
}

.outline-label.required {
  color: #b45309;
}

.outline-label.suggested {
  color: #2563eb;
}

.outline-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.outline-item-row {
  padding: 0.5rem 0.65rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  margin-bottom: 0.4rem;
  background: #fafafa;
}

.outline-text-input {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 0.35rem 0.5rem;
  font-size: 0.88rem;
  resize: vertical;
  font-family: inherit;
}

.outline-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.35rem;
  font-size: 0.78rem;
  color: #6b7280;
}

.outline-warnings {
  margin: 0.35rem 0 0;
  padding-left: 1rem;
  font-size: 0.78rem;
  color: #b45309;
}

.outline-item-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.35rem;
}

.revise-block {
  margin: 0.75rem 0;
  display: grid;
  gap: 0.5rem;
}

.generate-block {
  margin: 0.75rem 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}

.revise-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.field-label {
  font-size: 0.85rem;
  color: #374151;
}

.feedback-input {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem;
  font-size: 0.88rem;
  font-family: inherit;
  resize: vertical;
}

.step-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}

.empty-outline-hint {
  margin: 0;
  width: 100%;
  font-size: 0.82rem;
  color: #b45309;
  text-align: right;
}

.empty-outline-hint.left {
  text-align: left;
}

.empty-hint {
  margin: 0;
  font-size: 0.82rem;
  color: #9ca3af;
}

.text-button {
  border: none;
  background: transparent;
  color: #2563eb;
  font-size: 0.82rem;
  cursor: pointer;
}

.text-button.danger {
  color: #dc2626;
}

.text-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.45rem 0.9rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.primary-button {
  background: #2563eb;
  color: #fff;
  border: none;
}

.secondary-button {
  background: #fff;
  color: #111827;
  border: 1px solid #d1d5db;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
