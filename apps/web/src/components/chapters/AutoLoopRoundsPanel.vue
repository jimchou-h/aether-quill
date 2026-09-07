<script setup lang="ts">
import { computed } from 'vue';
import type { ChapterAutoLoopItem, ChapterAutoLoopRound } from '../../services/api';
import {
  describeAutoLoopItemStatus,
  summarizeAutoLoopRound,
} from '../../utils/chapterAutoLoopItems';

const props = defineProps<{
  rounds: ChapterAutoLoopRound[];
  liveItems: ChapterAutoLoopItem[];
  activeRoundIndex: number;
  activeRoundBudget: number;
  paragraphCount: number;
  running: boolean;
}>();

/** 已完成轮直接读回传的最终条目；进行中的那一轮读实时条目。 */
const activeItems = computed(() =>
  props.running || props.rounds.length === 0 ? props.liveItems : (props.rounds.at(-1)?.items ?? [])
);

const activeRoundLabel = computed(() => {
  if (props.activeRoundIndex <= 0) {
    return '';
  }
  const budget = props.activeRoundBudget > 0 ? ` / ${props.activeRoundBudget}` : '';
  return `第 ${props.activeRoundIndex}${budget} 轮`;
});
</script>

<template>
  <div class="loop-panel">
    <p v-if="activeRoundLabel" class="loop-round-head">
      {{ activeRoundLabel }}
      <span v-if="paragraphCount > 0" class="loop-round-meta">共 {{ paragraphCount }} 段</span>
      <span v-if="running" class="loop-badge">进行中</span>
    </p>

    <ol v-if="rounds.length > 0" class="loop-round-list">
      <li v-for="round in rounds" :key="round.roundIndex" class="loop-round-item">
        <span class="loop-round-index">第 {{ round.roundIndex }} 轮</span>
        <span :class="['loop-round-summary', { 'loop-round-summary--danger': round.rolledBack }]">
          {{ summarizeAutoLoopRound(round) }}
        </span>
      </li>
    </ol>

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
        <p class="loop-item-instruction">{{ item.instruction }}</p>
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
}

.loop-round-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
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
  max-height: 320px;
  overflow-y: auto;
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
