<script setup lang="ts">
import { computed } from 'vue';
import type {
  CitationItem,
  ConsistencyNote,
  GenerationPhase,
  UsedRelationEventItem,
} from '../../services/api';
import type { AiTaskProgressState } from '../../composables/useAiTaskProgress';
import WriteOutlinePanel from './WriteOutlinePanel.vue';
import GenerationPreview from './GenerationPreview.vue';
import ConsistencyAlert from './ConsistencyAlert.vue';

const activeTab = defineModel<'outline' | 'draft' | 'evidence'>('activeTab', {
  default: 'outline',
});

const props = defineProps<{
  outlineText: string;
  outlineConfirmed: boolean;
  isOutlineStreaming: boolean;
  isDraftStreaming: boolean;
  hasOutline: boolean;
  draftText: string;
  citations: CitationItem[];
  consistencyNotes: ConsistencyNote[];
  usedRelationEvents: UsedRelationEventItem[];
  isDone: boolean;
  isAccepting: boolean;
  generationPhase: GenerationPhase | null;
  phasePanelCollapsed: boolean;
  aiTaskProgress: AiTaskProgressState;
  evidenceCount: number;
}>();

const emit = defineEmits<{
  'update:outlineText': [value: string];
  confirm: [];
  regenerateOutline: [];
  generateDraft: [];
  acceptDraft: [];
  regenerateDraft: [];
}>();

const tabs = computed(() => [
  {
    id: 'outline' as const,
    label: '章节大纲',
    badge: props.hasOutline ? '已生成' : props.isOutlineStreaming ? '生成中' : undefined,
  },
  {
    id: 'draft' as const,
    label: '正文草稿',
    badge: props.isDone ? '已完成' : props.isDraftStreaming ? '生成中' : undefined,
    disabled: !props.outlineConfirmed && !props.isDraftStreaming && !props.draftText,
  },
  {
    id: 'evidence' as const,
    label: '引用与告警',
    badge: props.evidenceCount > 0 ? String(props.evidenceCount) : undefined,
    disabled: props.evidenceCount === 0,
  },
]);

function selectTab(id: 'outline' | 'draft' | 'evidence') {
  const tab = tabs.value.find((item) => item.id === id);
  if (tab?.disabled) {
    return;
  }
  activeTab.value = id;
}
</script>

<template>
  <section class="wb-output" aria-label="生成产出">
    <div class="wb-output-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="wb-output-tab"
        :class="{ 'wb-output-tab--active': activeTab === tab.id }"
        :aria-selected="activeTab === tab.id"
        :disabled="tab.disabled"
        @click="selectTab(tab.id)"
      >
        <span>{{ tab.label }}</span>
        <span v-if="tab.badge" class="wb-output-tab-badge">{{ tab.badge }}</span>
      </button>
    </div>

    <div class="wb-output-body">
      <div v-show="activeTab === 'outline'" role="tabpanel" class="wb-output-pane">
        <WriteOutlinePanel
          :outline-text="outlineText"
          :outline-confirmed="outlineConfirmed"
          :is-outline-streaming="isOutlineStreaming"
          :is-draft-streaming="isDraftStreaming"
          :has-outline="hasOutline"
          embedded
          @update:outline-text="emit('update:outlineText', $event)"
          @confirm="emit('confirm')"
          @regenerate="emit('regenerateOutline')"
          @generate-draft="emit('generateDraft')"
        />
      </div>

      <div v-show="activeTab === 'draft'" role="tabpanel" class="wb-output-pane">
        <GenerationPreview
          :draft-text="draftText"
          :citations="citations"
          :consistency-notes="consistencyNotes"
          :used-relation-events="usedRelationEvents"
          :is-streaming="isDraftStreaming"
          :is-done="isDone"
          :is-accepting="isAccepting"
          :generation-phase="generationPhase"
          :phase-panel-collapsed="phasePanelCollapsed"
          :ai-task-progress="aiTaskProgress"
          embedded
          @accept="emit('acceptDraft')"
          @regenerate="emit('regenerateDraft')"
        />
      </div>

      <div
        v-show="activeTab === 'evidence'"
        role="tabpanel"
        class="wb-output-pane wb-output-pane--evidence"
      >
        <ConsistencyAlert :notes="consistencyNotes" embedded />

        <div v-if="usedRelationEvents.length > 0" class="evidence-block">
          <h4 class="evidence-title">关系事件</h4>
          <ul class="evidence-list">
            <li v-for="event in usedRelationEvents" :key="event.id" class="evidence-item">
              <span class="evidence-tag">relation</span>
              <span>{{ event.protagonist }} ↔ {{ event.counterparty }} · {{ event.summary }}</span>
            </li>
          </ul>
        </div>

        <div v-if="citations.length > 0" class="evidence-block">
          <h4 class="evidence-title">引用证据</h4>
          <ul class="evidence-list">
            <li
              v-for="(citation, index) in citations"
              :key="`${citation.sourceType}-${citation.sourceId}-${index}`"
              class="evidence-item"
            >
              <span class="evidence-tag">{{ citation.sourceType }}</span>
              <span>{{ citation.snippet }}</span>
            </li>
          </ul>
        </div>

        <p v-if="evidenceCount === 0" class="evidence-empty">
          生成正文后，引用与一致性提示会显示在这里。
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wb-output {
  display: flex;
  flex-direction: column;
  min-height: min(78vh, 820px);
  border-radius: var(--wb-radius);
  border: 1px solid var(--wb-border);
  background: var(--wb-surface);
  box-shadow: var(--wb-shadow);
  overflow: hidden;
}

.wb-output-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.65rem 0.75rem 0;
  border-bottom: 1px solid var(--wb-border);
  background: var(--wb-surface-muted);
}

.wb-output-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.85rem;
  border: none;
  border-radius: var(--wb-radius-sm) var(--wb-radius-sm) 0 0;
  background: transparent;
  color: var(--wb-text-secondary);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s;
}

.wb-output-tab:hover:not(:disabled) {
  color: var(--wb-text);
  background: rgb(255 255 255 / 70%);
}

.wb-output-tab--active {
  color: var(--wb-primary);
  background: var(--wb-surface);
  box-shadow: 0 -1px 0 var(--wb-surface);
}

.wb-output-tab:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.wb-output-tab-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--wb-primary-soft);
  color: var(--wb-primary);
}

.wb-output-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.wb-output-pane {
  min-height: 100%;
}

.wb-output-pane--evidence {
  padding: 1rem 1.15rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.evidence-block {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  padding: 0.85rem 1rem;
  background: var(--wb-surface-muted);
}

.evidence-title {
  margin: 0 0 0.55rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--wb-text);
}

.evidence-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.evidence-item {
  display: flex;
  gap: 0.55rem;
  font-size: 0.85rem;
  color: var(--wb-text-secondary);
  line-height: 1.5;
}

.evidence-tag {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  padding: 0.15rem 0.4rem;
  border-radius: 6px;
  background: var(--wb-primary-soft);
  color: var(--wb-primary);
}

.evidence-empty {
  margin: 2rem 0;
  text-align: center;
  color: var(--wb-text-muted);
  font-size: 0.9rem;
}
</style>
