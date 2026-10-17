<script setup lang="ts">
/**
 * 章节智能精修面板（AQ-382 整章顺序编排）。
 *
 * 负责呈现：一次要求、一次启动、整章范围进度、原文／候选对比、确认应用与运行历史。
 * 应用复用旧 apply 入口（planId=runId、保留摘要），成功后把章节回传给父级刷新编辑器。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { type ChapterItem } from '../../services/api';
import { useChapterRefinementRun } from '../../composables/useChapterRefinementRun';
import { confirmAction } from '../../composables/useAppConfirm';
import ChapterOptimizeComparePane from './ChapterOptimizeComparePane.vue';
import {
  buildRefinementApplyConfirmCopy,
  buildRefinementRunCorrelation,
  formatRefinementCoverage,
  formatRefinementIssueSeverity,
  formatRefinementProgressText,
  formatRefinementPauseReason,
  formatRefinementStatusLabel,
  formatRefinementStorageModeLabel,
  formatRefinementTimestamp,
  formatRefinementUsage,
} from '../../utils/chapterRefinement';

const props = defineProps<{
  projectId: string;
  chapter: ChapterItem | null;
}>();

const emit = defineEmits<{
  applied: [chapter: ChapterItem];
}>();

const {
  instruction,
  rewritePolicy,
  run,
  runs,
  starting,
  observing,
  restoring,
  applying,
  cancelling,
  resuming,
  discarding,
  statusText,
  errorMessage,
  isBusy,
  isReady,
  storageMode,
  baseText,
  candidateText,
  statusLabel,
  phaseLabel,
  progressPercent,
  canStart,
  canApply,
  canCancel,
  canResume,
  canDiscard,
  pauseHint,
  applyGate,
  sourceChanged,
  start,
  apply,
  cancel,
  resume,
  discard,
  restore,
  openRun,
  closeObservation,
} = useChapterRefinementRun({
  projectId: () => props.projectId,
  chapter: () => props.chapter,
  onApplied: (chapter) => emit('applied', chapter),
});

/** 只读候选：ComparePane 的 v-model 需要一个可写 ref，这里只做单向同步。 */
const candidateModel = ref('');
watch(candidateText, (value) => {
  candidateModel.value = value;
});

const storageModeLabel = computed(() =>
  storageMode.value ? formatRefinementStorageModeLabel(storageMode.value) : ''
);
const progressUnitText = computed(() =>
  run.value ? formatRefinementProgressText(run.value.progress) : ''
);
const usageText = computed(() => (run.value ? formatRefinementUsage(run.value.usage) : ''));
const coverageText = computed(() =>
  run.value ? formatRefinementCoverage(run.value.coverage) : ''
);
const pauseReasonText = computed(() =>
  run.value?.pauseReason ? formatRefinementPauseReason(run.value.pauseReason) : ''
);
const issues = computed(() => run.value?.issues ?? []);
const correlation = computed(() => buildRefinementRunCorrelation(run.value));
const policyHint = computed(() =>
  rewritePolicy.value === 'scene-rewrite'
    ? '场内创编：允许同一场内部加减、并拍与重排，不授权跨场重排或改变后续剧情。'
    : '保留剧情：允许改表达、节奏、对话组织与场内铺陈，保留必要事件与范围首尾状态。'
);

function openHistoryRun(runId: string) {
  void openRun(runId);
}

async function confirmCancel() {
  if (!canCancel.value) {
    return;
  }
  const confirmed = await confirmAction({
    title: '取消智能精修',
    content: '将中止当前执行并保留已完成的成果，稍后可从断点继续。是否取消？',
    okText: '确认取消',
  });
  if (confirmed) {
    await cancel();
  }
}

async function confirmDiscard() {
  if (!canDiscard.value) {
    return;
  }
  const confirmed = await confirmAction({
    title: '放弃并清理该次精修',
    content:
      '将放弃本次精修并清理冻结原文与候选材料（章节正文不受影响）。此操作不可撤销，是否继续？',
    okText: '确认放弃清理',
  });
  if (confirmed) {
    await discard();
  }
}

async function confirmApply() {
  if (!canApply.value || !run.value) {
    return;
  }
  // R11：ready_with_issues 必须显式列出未解决问题与保留原文，作者逐条确认后再覆盖
  const copy = buildRefinementApplyConfirmCopy({
    chapterNo: props.chapter?.chapterNo ?? null,
    run: run.value,
  });
  const confirmed = await confirmAction({
    title: copy.title,
    content: copy.content,
    okText: copy.okText,
  });
  if (!confirmed) {
    return;
  }
  await apply();
}

onMounted(() => {
  void restore();
});

onBeforeUnmount(() => {
  // 关闭面板只结束观察，后台 run 继续执行
  closeObservation();
});
</script>

<template>
  <div
    class="refinement-panel"
    :data-run-id="run?.runId ?? ''"
    :data-attempt-id="run?.attemptId ?? ''"
    :data-status="run?.status ?? ''"
  >
    <header class="refinement-head">
      <div class="refinement-badges">
        <span v-if="storageModeLabel" class="refinement-badge refinement-badge--storage">
          存储：{{ storageModeLabel }}
        </span>
        <span v-if="run" class="refinement-badge">{{ statusLabel }}</span>
        <span v-if="observing" class="refinement-badge refinement-badge--live">观察中</span>
      </div>
      <p class="refinement-hint">
        整章精修：冻结原文后分窗通读 → 跨窗合并场景 → 整章统筹 → 逐范围改写与检查，
        产出完整候选；确认应用复用旧入口并保留摘要。
      </p>
    </header>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-else-if="statusText" class="refinement-note">{{ statusText }}</p>
    <p v-if="restoring" class="refinement-note">正在恢复上次精修状态…</p>

    <section class="refinement-section">
      <label class="field-label" for="chapter-refinement-instruction">本章精修要求</label>
      <textarea
        id="chapter-refinement-instruction"
        v-model="instruction"
        class="field-textarea refinement-instruction"
        rows="6"
        :disabled="isBusy"
        placeholder="例如：收紧节奏，减少解释性叙述，加强人物之间的张力，保持剧情与人物状态不变。"
      />
      <div class="refinement-policy">
        <label class="field-label" for="chapter-refinement-policy">改写权限</label>
        <select
          id="chapter-refinement-policy"
          v-model="rewritePolicy"
          class="field-select refinement-policy-select"
          :disabled="isBusy"
        >
          <option value="preserve-plot">保留剧情</option>
          <option value="scene-rewrite">场内创编</option>
        </select>
        <span class="refinement-hint">{{ policyHint }}</span>
      </div>
      <div class="refinement-actions">
        <button class="primary-button" type="button" :disabled="!canStart" @click="start">
          {{ starting ? '启动中…' : '开始智能精修' }}
        </button>
        <span class="refinement-hint">
          启动后可以关闭面板；精修在后台继续，重新打开会自动恢复。
        </span>
      </div>
    </section>

    <section v-if="run" class="refinement-section refinement-progress">
      <div class="refinement-progress-head">
        <span class="refinement-progress-phase">{{ phaseLabel }}</span>
        <span class="refinement-progress-percent">{{ progressPercent }}%</span>
      </div>
      <div class="refinement-progress-bar">
        <div class="refinement-progress-fill" :style="{ width: `${progressPercent}%` }" />
      </div>
      <p class="refinement-hint">{{ run.progress.message }}</p>
      <p v-if="progressUnitText" class="refinement-hint">{{ progressUnitText }}</p>
      <p class="refinement-hint">{{ usageText }}</p>
      <p v-if="coverageText" class="refinement-hint">{{ coverageText }}</p>
      <p v-if="pauseReasonText" class="refinement-note">暂停原因：{{ pauseReasonText }}</p>
      <p v-if="pauseHint" class="refinement-note">{{ pauseHint }}</p>
      <p v-if="sourceChanged" class="refinement-note refinement-note--warn">
        章节正文在本次精修创建后已被修改，当前候选基于冻结原文，应用前请留意差异。
      </p>
      <div v-if="canCancel || canResume || canDiscard" class="refinement-actions">
        <button
          v-if="canCancel"
          class="secondary-button"
          type="button"
          :disabled="cancelling"
          @click="confirmCancel"
        >
          {{ cancelling ? '取消中…' : '取消精修' }}
        </button>
        <button
          v-if="canResume"
          class="primary-button"
          type="button"
          :disabled="resuming"
          @click="resume"
        >
          {{ resuming ? '继续中…' : '继续精修' }}
        </button>
        <button
          v-if="canDiscard"
          class="secondary-button"
          type="button"
          :disabled="discarding"
          @click="confirmDiscard"
        >
          {{ discarding ? '放弃中…' : '放弃并清理' }}
        </button>
        <span class="refinement-hint"> 关闭面板不会取消精修；取消会中止当前调用并保留成果。 </span>
      </div>
    </section>

    <section v-if="run" class="refinement-section">
      <h4 class="refinement-title">候选对比</h4>
      <ChapterOptimizeComparePane
        v-model="candidateModel"
        original-title="冻结原文"
        draft-title="候选稿（只读）"
        :original="baseText"
        :draft-disabled="true"
        :show-diff="true"
      />
      <p v-if="!isReady" class="refinement-hint">
        候选尚未完成；下方展示的是当前已接受内容，原文尾部可能还未处理。
      </p>
    </section>

    <section v-if="run" class="refinement-section refinement-apply">
      <h4 class="refinement-title">应用候选稿</h4>
      <ul v-if="issues.length" class="refinement-issues">
        <li v-for="issue in issues" :key="issue.id" class="refinement-issue">
          <span class="refinement-issue-tag">{{
            formatRefinementIssueSeverity(issue.severity)
          }}</span>
          <span class="refinement-issue-text">{{ issue.message }}</span>
        </li>
      </ul>
      <p v-if="!canApply && applyGate.reason" class="refinement-hint">{{ applyGate.reason }}</p>
      <div class="refinement-actions">
        <button class="primary-button" type="button" :disabled="!canApply" @click="confirmApply">
          {{ applying ? '应用中…' : '应用候选稿' }}
        </button>
        <span class="refinement-hint">
          复用旧应用入口：锁定冻结版本（冲突返回 1307）、保留摘要，成功后刷新编辑器。
        </span>
      </div>
    </section>

    <section v-if="runs.length" class="refinement-section">
      <h4 class="refinement-title">运行历史</h4>
      <ul class="refinement-history">
        <li v-for="item in runs" :key="item.runId">
          <button
            type="button"
            class="refinement-history-item"
            :class="{ 'refinement-history-item--active': item.runId === run?.runId }"
            @click="openHistoryRun(item.runId)"
          >
            <span class="refinement-history-status">{{
              formatRefinementStatusLabel(item.status)
            }}</span>
            <span class="refinement-history-time">{{
              formatRefinementTimestamp(item.createdAt)
            }}</span>
          </button>
        </li>
      </ul>
    </section>

    <details v-if="run" class="refinement-section refinement-correlation">
      <summary class="refinement-title">运行关联信息（排查用）</summary>
      <dl class="refinement-correlation-list">
        <div class="refinement-correlation-row">
          <dt>runId</dt>
          <dd>{{ correlation.runId }}</dd>
        </div>
        <div class="refinement-correlation-row">
          <dt>attemptId</dt>
          <dd>{{ correlation.attemptId }}</dd>
        </div>
        <div class="refinement-correlation-row">
          <dt>创建 trace</dt>
          <dd>{{ correlation.creationTraceId }}</dd>
        </div>
        <div class="refinement-correlation-row">
          <dt>冻结模板版本</dt>
          <dd>
            <template v-if="correlation.templateVersions.length">
              <span
                v-for="version in correlation.templateVersions"
                :key="version"
                class="refinement-correlation-tag"
                >{{ version }}</span
              >
            </template>
            <span v-else>无（已清理或未冻结）</span>
          </dd>
        </div>
      </dl>
    </details>
  </div>
</template>

<style scoped>
.refinement-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 2px 16px;
}

.refinement-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.refinement-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.refinement-badge {
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--aq-border-strong, #cbd5e1);
  background: #f8fafc;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
}

.refinement-badge--storage {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #1d4ed8;
}

.refinement-badge--live {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #15803d;
}

.refinement-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7280;
}

.refinement-note {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f1f5f9;
  color: #334155;
  font-size: 13px;
}

.refinement-note--warn {
  background: #fffbeb;
  color: #92400e;
  border: 1px solid #fde68a;
}

.refinement-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
}

.refinement-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.refinement-issues {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.refinement-issue {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  font-size: 13px;
  line-height: 1.5;
}

.refinement-issue-tag {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 999px;
  background: #f59e0b;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}

.refinement-issue-text {
  flex: 1 1 auto;
}

.refinement-instruction {
  width: 100%;
  min-height: 120px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
}

.refinement-policy {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.refinement-policy-select {
  width: auto;
  min-width: 140px;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
}

.refinement-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.refinement-progress-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.refinement-progress-bar {
  height: 8px;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: hidden;
}

.refinement-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #60a5fa, #2563eb);
  transition: width 0.3s ease;
}

.refinement-history {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.refinement-history-item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  font-size: 13px;
  cursor: pointer;
}

.refinement-history-item:hover {
  border-color: #93c5fd;
  background: #f8fafc;
}

.refinement-history-item--active {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
  font-weight: 600;
}

.refinement-history-status {
  font-weight: 600;
}

.refinement-history-time {
  color: #6b7280;
}

.refinement-correlation {
  gap: 10px;
}

.refinement-correlation-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.refinement-correlation-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 12px;
  line-height: 1.6;
}

.refinement-correlation-row dt {
  flex: 0 0 96px;
  margin: 0;
  color: #6b7280;
  font-weight: 600;
}

.refinement-correlation-row dd {
  flex: 1 1 auto;
  margin: 0;
  color: #334155;
  word-break: break-all;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.refinement-correlation-tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #334155;
  font-size: 12px;
}
</style>
