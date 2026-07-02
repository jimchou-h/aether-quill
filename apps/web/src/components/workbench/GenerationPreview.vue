<script setup lang="ts">
import { computed, withDefaults } from 'vue';
import type {
  CitationItem,
  ConsistencyNote,
  GenerationPhase,
  UsedRelationEventItem,
} from '../../services/api';
import type { AiTaskProgressState } from '../../composables/useAiTaskProgress';
import AiTaskProgressPanel from '../common/AiTaskProgressPanel.vue';
import MarkdownContent from '../common/MarkdownContent.vue';
import SseInterruptButton from '../common/SseInterruptButton.vue';

const PHASE_LABELS: Record<GenerationPhase, string> = {
  retrieving: '正在检索知识库...',
  building_prompt: '正在组装写作指令...',
  waiting_llm: '等待模型响应...',
  generating: '正在生成正文...',
  checking: '正在进行一致性检查...',
  content_safety_scan: '正在执行内容安全扫描...',
  content_safety_rewrite: '正在批量重写命中句子...',
};

const PHASE_ORDER: GenerationPhase[] = [
  'retrieving',
  'building_prompt',
  'waiting_llm',
  'generating',
  'checking',
  'content_safety_scan',
];

/**
 * 生成预览组件属性定义
 */
const props = withDefaults(
  defineProps<{
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
    aiTaskProgress: AiTaskProgressState;
    embedded?: boolean;
  }>(),
  { embedded: false, aiTaskProgress: () => ({
    traceId: null,
    taskKey: null,
    stage: null,
    message: null,
    currentStep: null,
    totalSteps: null,
    active: false,
    cancelled: false,
    error: null,
  }) }
);

const emit = defineEmits<{
  accept: [];
  regenerate: [];
  interrupt: [];
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
</script>

<template>
  <section class="generation-preview" :class="{ 'generation-preview--embedded': embedded }">
    <header v-if="!embedded" class="panel-heading">
      <h3 class="panel-title">正文草稿</h3>
      <p class="panel-description">流式生成结果；引用与告警请切换到「引用与告警」标签。</p>
    </header>

    <AiTaskProgressPanel :progress="aiTaskProgress" show-trace-on-error />
    <div v-if="isStreaming" class="stream-actions">
      <SseInterruptButton @interrupt="emit('interrupt')" />
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

    <div v-if="draftText" class="draft-section markdown-pane">
      <MarkdownContent :source="draftText" :throttle-ms="isStreaming ? 200 : 0" />
    </div>

    <div v-if="!draftText && !isStreaming" class="empty-state">
      <p class="empty-title">等待生成正文</p>
      <p class="empty-copy">请先在「章节大纲」标签中确认大纲，再点击「生成正文」。</p>
    </div>

    <footer v-if="isDone || isStreaming" class="draft-footer">
      <div v-if="isStreaming" class="actions">
        <SseInterruptButton @interrupt="emit('interrupt')" />
      </div>
      <div v-if="isDone" class="actions">
        <button
          class="wb-btn wb-btn--primary"
          type="button"
          :disabled="isAccepting"
          @click="emit('accept')"
        >
          {{ isAccepting ? '落库中…' : '接受草稿并保存' }}
        </button>
        <button
          class="wb-btn wb-btn--ghost"
          type="button"
          :disabled="isAccepting || isStreaming"
          @click="emit('regenerate')"
        >
          重新生成正文
        </button>
      </div>
    </footer>
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

.generation-preview--embedded {
  border: none;
  border-radius: 0;
  padding: 1rem 1.15rem 0;
  background: transparent;
  min-height: min(68vh, 720px);
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
  color: var(--aq-primary);
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
  border: 1px solid var(--wb-border, #e5e7eb);
  border-radius: var(--wb-radius-sm, 10px);
  padding: 1rem 1.05rem;
  background: var(--wb-surface-muted, #fafafa);
  white-space: pre-wrap;
  line-height: 1.75;
  font-size: 0.94rem;
  font-family: var(--wb-font, inherit);
  color: var(--wb-text, #111827);
  min-height: 340px;
  max-height: min(58vh, 640px);
  overflow-y: auto;
}

.generation-preview--embedded .draft-output {
  flex: 1;
  max-height: none;
  min-height: 300px;
}

.draft-footer {
  position: sticky;
  bottom: 0;
  margin-top: 1rem;
  padding: 0.85rem 0 1rem;
  background: linear-gradient(to top, var(--wb-surface, #fff) 75%, transparent);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.wb-btn {
  min-height: 2.5rem;
  padding: 0.5rem 1rem;
  border-radius: var(--wb-radius-sm, 8px);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}

.wb-btn--primary {
  border: none;
  background: var(--wb-primary, #0d9488);
  color: #fff;
  transition: background var(--aq-transition-fast), transform var(--aq-transition-fast);
}

.wb-btn--primary:hover:not(:disabled) {
  background: var(--wb-primary-hover, #0f766e);
}

.wb-btn--primary:active:not(:disabled) {
  transform: scale(var(--aq-press-scale));
}

.wb-btn--ghost {
  border: 1px solid var(--wb-border, #e5e7eb);
  background: var(--wb-surface, #fff);
  color: var(--wb-text-secondary, #64748b);
}

.wb-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
