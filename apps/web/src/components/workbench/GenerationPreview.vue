<script setup lang="ts">
import { computed } from 'vue';
import type {
  CitationItem,
  ConsistencyNote,
  GenerationPhase,
  UsedRelationEventItem,
} from '../../services/api';

const PHASE_LABELS: Record<GenerationPhase, string> = {
  retrieving: '正在检索知识库...',
  building_prompt: '正在组装写作指令...',
  waiting_llm: '等待模型响应...',
  generating: '正在生成正文...',
  checking: '正在进行一致性检查...',
};

const PHASE_ORDER: GenerationPhase[] = [
  'retrieving',
  'building_prompt',
  'waiting_llm',
  'generating',
  'checking',
];

/**
 * 生成预览组件属性定义
 */
const props = defineProps<{
  /** 草稿文本 */
  draftText: string;
  /** 引用证据列表 */
  citations: CitationItem[];
  /** 一致性提示列表 */
  consistencyNotes: ConsistencyNote[];
  /** 本次使用的关系事件 */
  usedRelationEvents: UsedRelationEventItem[];
  /** 是否正在生成 */
  isStreaming: boolean;
  /** 是否生成完成 */
  isDone: boolean;
  /** 是否正在接受草稿（写入章节） */
  isAccepting: boolean;
  /** 当前生成阶段 */
  generationPhase: GenerationPhase | null;
  /** 阶段面板是否收起 */
  phasePanelCollapsed: boolean;
}>();

const showPhasePanel = computed(
  () => props.isStreaming && !props.phasePanelCollapsed && props.generationPhase !== null
);

const currentPhaseIndex = computed(() => {
  if (!props.generationPhase) return -1;
  return PHASE_ORDER.indexOf(props.generationPhase);
});

function phaseStatus(phase: GenerationPhase): 'done' | 'active' | 'pending' {
  const index = PHASE_ORDER.indexOf(phase);
  if (index < currentPhaseIndex.value) return 'done';
  if (index === currentPhaseIndex.value) return 'active';
  return 'pending';
}

/**
 * 组件事件定义
 */
const emit = defineEmits<{
  /** 接受草稿 */
  accept: [];
  /** 重新生成 */
  regenerate: [];
}>();
</script>

<template>
  <section class="generation-preview">
    <div class="panel-heading">
      <h3 class="panel-title">生成结果</h3>
      <p class="panel-description">草稿、引用证据与关系事件会集中展示在这里。</p>
    </div>

    <div v-if="showPhasePanel" class="phase-panel" role="status" aria-live="polite">
      <p class="phase-panel-title">生成进度</p>
      <ol class="phase-steps">
        <li
          v-for="phase in PHASE_ORDER"
          :key="phase"
          :class="['phase-step', `phase-step--${phaseStatus(phase)}`]"
        >
          <span class="phase-step-icon" aria-hidden="true">
            {{ phaseStatus(phase) === 'done' ? '✓' : phaseStatus(phase) === 'active' ? '●' : '○' }}
          </span>
          <span class="phase-step-label">{{ PHASE_LABELS[phase] }}</span>
        </li>
      </ol>
    </div>

    <div v-if="draftText" class="draft-section">
      <pre class="draft-output">{{ draftText }}</pre>
    </div>

    <div v-if="!draftText && !isStreaming" class="empty-state">
      <p class="empty-title">等待生成</p>
      <p class="empty-copy">输入生成参数后点击「生成章节草稿」，结果将实时显示在此处。</p>
    </div>

    <div v-if="isDone" class="actions">
      <button class="primary-button" type="button" :disabled="isAccepting" @click="emit('accept')">
        {{ isAccepting ? '接受中...' : '接受草稿' }}
      </button>
      <button
        class="secondary-button"
        type="button"
        :disabled="isAccepting"
        @click="emit('regenerate')"
      >
        重新生成
      </button>
    </div>

    <div v-if="usedRelationEvents.length > 0" class="citations-section">
      <h4 class="sub-title">本次使用的关系事件</h4>
      <ul class="citation-list">
        <li v-for="event in usedRelationEvents" :key="event.id" class="citation-item">
          <span class="citation-badge">relation-event</span>
          <span class="citation-snippet">
            {{ event.protagonist }} ↔ {{ event.counterparty }} · {{ event.summary }}
          </span>
        </li>
      </ul>
    </div>

    <div v-if="citations.length > 0" class="citations-section">
      <h4 class="sub-title">引用证据</h4>
      <ul class="citation-list">
        <li
          v-for="(citation, index) in citations"
          :key="`${citation.sourceType}-${citation.sourceId}-${index}`"
          class="citation-item"
        >
          <span class="citation-badge">{{ citation.sourceType }}</span>
          <span class="citation-snippet">{{ citation.snippet }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.generation-preview {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem;
  background: #fff;
}

.panel-heading {
  margin-bottom: 1rem;
}

.panel-title {
  margin: 0 0 0.3rem;
  font-size: 1rem;
}

.panel-description {
  margin: 0;
  color: #6b7280;
  font-size: 0.88rem;
  line-height: 1.5;
}

.sub-title {
  margin: 0 0 0.45rem;
  font-size: 0.9rem;
  color: #374151;
}

.phase-panel {
  margin-bottom: 1rem;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  border: 1px solid #bfdbfe;
  background: #f8fafc;
}

.phase-panel-title {
  margin: 0 0 0.65rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: #374151;
}

.phase-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.phase-step {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.86rem;
  color: #9ca3af;
}

.phase-step--active {
  color: #1d4ed8;
  font-weight: 600;
}

.phase-step--done {
  color: #059669;
}

.phase-step-icon {
  width: 1rem;
  text-align: center;
  flex-shrink: 0;
}

.phase-step--active .phase-step-icon {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 300px;
  padding: 2rem 1.5rem;
  border-radius: 10px;
  border: 1px dashed #d1d5db;
  background: #f8fafc;
  text-align: center;
}

.empty-title {
  margin: 0;
  color: #374151;
  font-size: 0.95rem;
  font-weight: 600;
}

.empty-copy {
  margin: 0;
  max-width: 22rem;
  color: #6b7280;
  font-size: 0.88rem;
  line-height: 1.6;
}

.draft-section {
  margin-bottom: 1rem;
}

.draft-output {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 1rem;
  background: #fafafa;
  white-space: pre-wrap;
  line-height: 1.8;
  font-size: 0.95rem;
  font-family: inherit;
  min-height: 360px;
  max-height: min(72vh, 760px);
  overflow-y: auto;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-bottom: 1rem;
}

.primary-button {
  border: none;
  background: #1d4ed8;
  color: #fff;
  border-radius: 8px;
  padding: 0.55rem 1rem;
  cursor: pointer;
  font-size: 0.88rem;
  transition: background 0.15s;
}

.primary-button:hover {
  background: #2563eb;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  border-radius: 8px;
  padding: 0.55rem 1rem;
  cursor: pointer;
  font-size: 0.88rem;
  transition: all 0.15s;
}

.secondary-button:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.citations-section {
  border-top: 1px solid #e5e7eb;
  padding-top: 0.85rem;
  margin-top: 0.15rem;
}

.citation-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.citation-item {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  font-size: 0.85rem;
  color: #4b5563;
  line-height: 1.5;
}

.citation-badge {
  flex-shrink: 0;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.72rem;
  padding: 0.15rem 0.4rem;
  border-radius: 999px;
  font-weight: 500;
}

.citation-snippet {
  word-break: break-word;
}
</style>
