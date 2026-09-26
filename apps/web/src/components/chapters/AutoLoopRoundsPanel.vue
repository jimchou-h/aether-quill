<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type { ChapterAutoLoopItem, ChapterAutoLoopRound } from '../../services/api';
import {
  AUTO_LOOP_PARAGRAPH_MISMATCH_HINT,
  autoLoopRoundKey,
  describeAutoLoopItemStatus,
  formatAutoLoopTimelineLabel,
  formatAutoLoopWindowPrefix,
  resolveAutoLoopSelectedRoundKey,
  resolveAutoLoopTimelineItems,
  resolveAutoLoopTimelineLatestKey,
  shouldShowAutoLoopParagraphMismatchHint,
  summarizeAutoLoopRound,
} from '../../utils/chapterAutoLoopItems';
import { canOpenPromptLabKind, findPromptLabCall } from '../../utils/autoLoopPromptLab';
import type { AutoLoopPromptLabCall } from '../../services/api';

const props = defineProps<{
  rounds: ChapterAutoLoopRound[];
  liveItems: ChapterAutoLoopItem[];
  activeRoundIndex: number;
  activeRoundBudget: number;
  liveWindowIndex?: number;
  liveWindowTotal?: number;
  paragraphCount: number;
  running: boolean;
  promptLabCalls?: AutoLoopPromptLabCall[];
}>();

const emit = defineEmits<{
  openDiagnoseLab: [call: AutoLoopPromptLabCall];
}>();

const lockedKey = shallowRef<string | null>(null);

watch(
  () => props.rounds.length,
  (length) => {
    if (length === 0) {
      lockedKey.value = null;
    }
  }
);

const latestKey = computed(() =>
  resolveAutoLoopTimelineLatestKey({
    rounds: props.rounds,
    running: props.running,
    liveWindowIndex: props.liveWindowIndex ?? 0,
    liveRoundIndex: props.activeRoundIndex,
  })
);

const selectedKey = computed(() =>
  resolveAutoLoopSelectedRoundKey({
    lockedKey: lockedKey.value,
    rounds: props.rounds,
    running: props.running,
    liveWindowIndex: props.liveWindowIndex ?? 0,
    liveRoundIndex: props.activeRoundIndex,
  })
);

const activeItems = computed(() =>
  resolveAutoLoopTimelineItems({
    selectedKey: selectedKey.value,
    latestKey: latestKey.value,
    rounds: props.rounds,
    liveItems: props.liveItems,
    running: props.running,
  })
);

const showMismatchHint = computed(() =>
  shouldShowAutoLoopParagraphMismatchHint({
    selectedKey: selectedKey.value,
    latestKey: latestKey.value,
  })
);

const showBackToCurrent = computed(
  () => Boolean(lockedKey.value) && lockedKey.value !== latestKey.value
);

const activeRoundLabel = computed(() => {
  if (props.activeRoundIndex <= 0) {
    return '';
  }
  const windowLabel = formatAutoLoopWindowPrefix(props.liveWindowIndex, props.liveWindowTotal);
  const budget = props.activeRoundBudget > 0 ? ` / ${props.activeRoundBudget}` : '';
  const roundLabel = `第 ${props.activeRoundIndex}${budget} 轮`;
  return windowLabel ? `${windowLabel} · ${roundLabel}` : roundLabel;
});

function isLatestRound(round: ChapterAutoLoopRound): boolean {
  return autoLoopRoundKey(round) === latestKey.value;
}

function selectRound(round: ChapterAutoLoopRound) {
  const key = autoLoopRoundKey(round);
  lockedKey.value = key === latestKey.value ? null : key;
}

function backToCurrent() {
  lockedKey.value = null;
}

function diagnoseCallFor(round: ChapterAutoLoopRound) {
  const byId = round.promptLabCallId
    ? (props.promptLabCalls ?? []).find((call) => call.id === round.promptLabCallId)
    : undefined;
  return (
    byId ??
    findPromptLabCall(props.promptLabCalls ?? [], {
      kind: 'diagnose',
      roundIndex: round.roundIndex,
      windowIndex: round.windowIndex,
    })
  );
}

function canOpenDiagnoseLab(round: ChapterAutoLoopRound) {
  const call = diagnoseCallFor(round);
  return Boolean(call && canOpenPromptLabKind(call.kind));
}
</script>

<template>
  <div class="loop-panel">
    <p v-if="activeRoundLabel" class="loop-round-head">
      {{ activeRoundLabel }}
      <span v-if="paragraphCount > 0" class="loop-round-meta">共 {{ paragraphCount }} 段</span>
      <span v-if="running" class="loop-badge">进行中</span>
      <button
        v-if="showBackToCurrent"
        class="loop-back-current"
        type="button"
        @click="backToCurrent"
      >
        回到当前
      </button>
    </p>
    <p v-else-if="showBackToCurrent" class="loop-round-head">
      <button class="loop-back-current" type="button" @click="backToCurrent">回到当前</button>
    </p>

    <ol v-if="rounds.length > 0" class="loop-round-list">
      <li v-for="round in rounds" :key="autoLoopRoundKey(round)" class="loop-round-item">
        <button
          :class="[
            'loop-round-button',
            { 'loop-round-button--selected': autoLoopRoundKey(round) === selectedKey },
          ]"
          type="button"
          @click="selectRound(round)"
        >
          <span class="loop-round-index">{{ formatAutoLoopTimelineLabel(round) }}</span>
          <span v-if="running && isLatestRound(round)" class="loop-badge"> 进行中 </span>
          <span :class="['loop-round-summary', { 'loop-round-summary--danger': round.rolledBack }]">
            {{ summarizeAutoLoopRound(round) }}
          </span>
        </button>
        <button
          v-if="canOpenDiagnoseLab(round)"
          class="loop-lab-button"
          type="button"
          @click.stop="emit('openDiagnoseLab', diagnoseCallFor(round)!)"
        >
          调诊断 Prompt
        </button>
      </li>
    </ol>

    <p v-if="showMismatchHint" class="loop-mismatch-hint">
      {{ AUTO_LOOP_PARAGRAPH_MISMATCH_HINT }}
    </p>

    <p v-if="activeItems.length === 0" class="loop-empty">
      {{ running ? '正在复诊，稍后会列出要改的段落…' : '暂无诊断条目' }}
    </p>

    <ul v-else class="loop-item-list">
      <li v-for="item in activeItems" :key="item.id" class="loop-item">
        <div class="loop-item-head">
          <span :class="['loop-severity', `loop-severity--${item.severity}`]">
            {{ item.severity === 'high' ? '严重' : item.severity === 'medium' ? '中等' : '轻微' }}
          </span>
          <span class="loop-item-anchor">
            第 {{ item.resolvedParagraphIndex ?? item.paragraphIndex }} 段
          </span>
          <span
            :class="[
              'loop-item-status',
              `loop-item-status--${describeAutoLoopItemStatus(item.status).tone}`,
            ]"
          >
            {{ describeAutoLoopItemStatus(item.status).label }}
          </span>
        </div>
        <p v-if="item.issue" class="loop-item-issue">{{ item.issue }}</p>
        <p v-if="item.instruction" class="loop-item-instruction">{{ item.instruction }}</p>
        <p v-if="item.note" class="loop-item-note">{{ item.note }}</p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.loop-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: auto;
  overflow: visible;
}

.loop-round-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
  flex-wrap: wrap;
}

.loop-round-meta {
  font-size: 12px;
  font-weight: 400;
  color: #6b7280;
}

.loop-badge {
  padding: 1px 8px;
  border-radius: 10px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 500;
}

.loop-round-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.loop-round-item {
  display: flex;
  gap: 8px;
  font-size: 13px;
  color: #374151;
}

.loop-round-button {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.loop-round-button:hover {
  background: #f9fafb;
}

.loop-round-button--selected {
  border-color: #93c5fd;
  background: #eff6ff;
}

.loop-back-current {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.loop-lab-button {
  margin-top: 6px;
  padding: 1px 8px;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  cursor: pointer;
}

.loop-mismatch-hint {
  margin: 0;
  font-size: 12px;
  color: #b45309;
}

.loop-round-index {
  flex: 0 0 auto;
  font-weight: 600;
}

.loop-round-summary--danger {
  color: #b91c1c;
}

.loop-empty {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
}

.loop-item-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.loop-item {
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}

.loop-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.loop-severity {
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
}

.loop-severity--high {
  background: #fef2f2;
  color: #b91c1c;
}

.loop-severity--medium {
  background: #fffbeb;
  color: #b45309;
}

.loop-severity--low {
  background: #f3f4f6;
  color: #4b5563;
}

.loop-item-anchor {
  font-size: 12px;
  color: #6b7280;
}

.loop-item-status {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
}

.loop-item-status--neutral {
  color: #6b7280;
}

.loop-item-status--success {
  color: #047857;
}

.loop-item-status--warning {
  color: #b45309;
}

.loop-item-status--danger {
  color: #b91c1c;
}

.loop-item-issue {
  margin: 6px 0 0;
  font-size: 13px;
  color: #4b5563;
}

.loop-item-instruction {
  margin: 4px 0 0;
  font-size: 13px;
  color: #1f2937;
}

.loop-item-note {
  margin: 4px 0 0;
  font-size: 12px;
  color: #b45309;
}
</style>
