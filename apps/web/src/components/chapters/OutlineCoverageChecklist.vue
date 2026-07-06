<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  PipelineOutlineCoverageSummary,
  PipelineOutlineCoverageStatus,
  PipelineOutlineItem,
} from '../../services/api';

const props = defineProps<{
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
  summary: PipelineOutlineCoverageSummary | null;
  busy?: boolean;
  verifying?: boolean;
}>();

const emit = defineEmits<{
  verify: [];
  'fix-items': [itemIds: string[]];
  'patch-coverage': [
    updates: Array<{
      id: string;
      coverageStatus: 'manual' | 'skipped';
      coverageNote?: string;
    }>,
  ];
}>();

const selectedIds = ref<string[]>([]);

const allItems = computed(() => [...props.required, ...props.suggested]);

const fixableIds = computed(() =>
  allItems.value
    .filter((item) => item.coverageStatus === 'partial' || item.coverageStatus === 'missed')
    .map((item) => item.id)
);

const hasFixable = computed(() => fixableIds.value.length > 0);

const summaryLine = computed(() => {
  const s = props.summary;
  if (!s) {
    return '尚未验收；改写完成后将自动对照大纲复检。';
  }
  return `必需 ${s.requiredResolved}/${s.requiredTotal} 已落实${
    s.requiredMissed > 0 ? `，${s.requiredMissed} 条待补` : ''
  }；建议项 ${s.suggestedTotal} 条`;
});

function coverageStatusLabel(status?: PipelineOutlineCoverageStatus): string {
  switch (status) {
    case 'done':
      return '已落实';
    case 'partial':
      return '部分落实';
    case 'missed':
      return '未落实';
    case 'manual':
      return '人工确认';
    case 'skipped':
      return '已跳过';
    case 'pending':
      return '待验收';
    default:
      return '待验收';
  }
}

function coverageStatusClass(status?: PipelineOutlineCoverageStatus): string {
  switch (status) {
    case 'done':
    case 'manual':
      return 'status-ok';
    case 'partial':
      return 'status-warn';
    case 'missed':
      return 'status-bad';
    case 'skipped':
      return 'status-muted';
    default:
      return 'status-pending';
  }
}

function isSelected(id: string): boolean {
  return selectedIds.value.includes(id);
}

function toggleSelect(id: string) {
  if (!fixableIds.value.includes(id)) {
    return;
  }
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter((row) => row !== id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
  }
}

function selectAllFixable() {
  selectedIds.value = [...fixableIds.value];
}

function clearSelection() {
  selectedIds.value = [];
}

function submitFix() {
  const ids = selectedIds.value.length ? selectedIds.value : fixableIds.value;
  if (!ids.length) {
    return;
  }
  emit('fix-items', ids);
  selectedIds.value = [];
}

function markManual(id: string) {
  emit('patch-coverage', [{ id, coverageStatus: 'manual' }]);
}

function markSkipped(id: string) {
  emit('patch-coverage', [{ id, coverageStatus: 'skipped' }]);
}

function canMarkSkipped(item: PipelineOutlineItem): boolean {
  return item.priority === 'suggested';
}

function canMarkManual(item: PipelineOutlineItem): boolean {
  return item.coverageStatus === 'partial' || item.coverageStatus === 'missed';
}
</script>

<template>
  <section class="coverage-checklist">
    <div class="coverage-head">
      <h5 class="section-title">大纲落实清单</h5>
      <p class="meta-line">{{ summaryLine }}</p>
    </div>

    <div class="coverage-actions">
      <button
        class="secondary-button"
        type="button"
        :disabled="busy || verifying"
        @click="emit('verify')"
      >
        {{ verifying ? '验收中…' : '重新验收' }}
      </button>
      <button
        v-if="hasFixable"
        class="secondary-button"
        type="button"
        :disabled="busy || verifying"
        @click="selectAllFixable"
      >
        全选待补项
      </button>
      <button
        v-if="selectedIds.length"
        class="text-button"
        type="button"
        :disabled="busy"
        @click="clearSelection"
      >
        清除选择
      </button>
      <button
        v-if="hasFixable"
        class="primary-button"
        type="button"
        :disabled="busy || verifying"
        @click="submitFix"
      >
        {{ busy ? '补修中…' : selectedIds.length ? `补修选中（${selectedIds.length}）` : '补修全部待补项' }}
      </button>
    </div>

    <div v-if="required.length" class="coverage-group">
      <p class="coverage-label required">必需项</p>
      <ul class="coverage-list">
        <li
          v-for="item in required"
          :key="item.id"
          class="coverage-row"
          :class="coverageStatusClass(item.coverageStatus)"
        >
          <label v-if="fixableIds.includes(item.id)" class="coverage-check">
            <input
              type="checkbox"
              :checked="isSelected(item.id)"
              :disabled="busy || verifying"
              @change="toggleSelect(item.id)"
            />
          </label>
          <div class="coverage-body">
            <div class="coverage-row-head">
              <span class="coverage-badge" :class="coverageStatusClass(item.coverageStatus)">
                {{ coverageStatusLabel(item.coverageStatus) }}
              </span>
            </div>
            <p class="coverage-text">{{ item.text }}</p>
            <p v-if="item.coverageNote" class="coverage-note">{{ item.coverageNote }}</p>
            <div v-if="canMarkManual(item)" class="coverage-row-actions">
              <button
                class="text-button"
                type="button"
                :disabled="busy || verifying"
                @click="markManual(item.id)"
              >
                人工确认已落实
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="suggested.length" class="coverage-group">
      <p class="coverage-label suggested">建议项</p>
      <ul class="coverage-list">
        <li
          v-for="item in suggested"
          :key="item.id"
          class="coverage-row"
          :class="coverageStatusClass(item.coverageStatus)"
        >
          <label v-if="fixableIds.includes(item.id)" class="coverage-check">
            <input
              type="checkbox"
              :checked="isSelected(item.id)"
              :disabled="busy || verifying"
              @change="toggleSelect(item.id)"
            />
          </label>
          <div class="coverage-body">
            <div class="coverage-row-head">
              <span class="coverage-badge" :class="coverageStatusClass(item.coverageStatus)">
                {{ coverageStatusLabel(item.coverageStatus) }}
              </span>
            </div>
            <p class="coverage-text">{{ item.text }}</p>
            <p v-if="item.coverageNote" class="coverage-note">{{ item.coverageNote }}</p>
            <div class="coverage-row-actions">
              <button
                v-if="canMarkManual(item)"
                class="text-button"
                type="button"
                :disabled="busy || verifying"
                @click="markManual(item.id)"
              >
                人工确认已落实
              </button>
              <button
                v-if="canMarkSkipped(item) && item.coverageStatus !== 'skipped'"
                class="text-button"
                type="button"
                :disabled="busy || verifying"
                @click="markSkipped(item.id)"
              >
                跳过
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.coverage-checklist {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #e5e7eb;
}

.coverage-head .section-title {
  margin: 0 0 0.25rem;
  font-size: 0.95rem;
}

.meta-line {
  margin: 0;
  color: #6b7280;
  font-size: 0.82rem;
}

.coverage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 0.75rem 0;
}

.coverage-group {
  margin-bottom: 0.75rem;
}

.coverage-label {
  margin: 0 0 0.35rem;
  font-size: 0.82rem;
  font-weight: 600;
}

.coverage-label.required {
  color: #b45309;
}

.coverage-label.suggested {
  color: #4b5563;
}

.coverage-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.coverage-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  background: #fafafa;
}

.coverage-row.status-ok {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.coverage-row.status-warn {
  border-color: #fde68a;
  background: #fffbeb;
}

.coverage-row.status-bad {
  border-color: #fecaca;
  background: #fef2f2;
}

.coverage-check {
  flex-shrink: 0;
  padding-top: 0.15rem;
}

.coverage-body {
  flex: 1;
  min-width: 0;
}

.coverage-row-head {
  margin-bottom: 0.25rem;
}

.coverage-badge {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
}

.coverage-badge.status-ok {
  background: #dcfce7;
  color: #166534;
}

.coverage-badge.status-warn {
  background: #fef3c7;
  color: #92400e;
}

.coverage-badge.status-bad {
  background: #fee2e2;
  color: #991b1b;
}

.coverage-badge.status-muted {
  background: #f3f4f6;
  color: #6b7280;
}

.coverage-badge.status-pending {
  background: #e0e7ff;
  color: #3730a3;
}

.coverage-text {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

.coverage-note {
  margin: 0.35rem 0 0;
  font-size: 0.78rem;
  color: #6b7280;
}

.coverage-row-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.35rem;
}

.text-button {
  background: none;
  border: none;
  padding: 0;
  color: #2563eb;
  font-size: 0.78rem;
  cursor: pointer;
}

.text-button:disabled {
  color: #9ca3af;
  cursor: not-allowed;
}

.secondary-button,
.primary-button {
  font-size: 0.82rem;
  padding: 0.35rem 0.75rem;
}
</style>
