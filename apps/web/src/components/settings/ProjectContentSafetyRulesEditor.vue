<script setup lang="ts">
import { ref } from 'vue';
import type { ProjectContentSafetyRule } from '../../services/api';

const CONTENT_SAFETY_CUSTOM_RULES_MAX = 200;
const CONTENT_SAFETY_PATTERN_MAX_LENGTH = 64;

const props = defineProps<{
  rules: ProjectContentSafetyRule[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  change: [value: ProjectContentSafetyRule[]];
}>();

const severityOptions = [
  { value: 'low' as const, label: '低风险（标记）' },
  { value: 'medium' as const, label: '中风险（重写句子）' },
  { value: 'high' as const, label: '高风险（阻断保存）' },
];

const batchImportText = ref('');
const batchImportSeverity = ref<ProjectContentSafetyRule['severity']>('low');
const batchImportMessage = ref('');

function createRuleId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function replaceRules(next: ProjectContentSafetyRule[]) {
  emit(
    'change',
    next.map((rule) => ({ ...rule }))
  );
}

function normalizePatternKey(pattern: string) {
  return pattern.trim().toLowerCase();
}

function parseBatchPatterns(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function importBatchRules() {
  batchImportMessage.value = '';
  const candidates = parseBatchPatterns(batchImportText.value);
  if (candidates.length === 0) {
    batchImportMessage.value = '请输入至少一个禁用词，多个词用逗号分隔。';
    return;
  }

  const existingKeys = new Set(props.rules.map((rule) => normalizePatternKey(rule.pattern)));
  const pendingKeys = new Set<string>();
  const toAdd: ProjectContentSafetyRule[] = [];
  let skipped = 0;

  for (let i = 0; i < candidates.length; i += 1) {
    const pattern = candidates[i]!;
    if (pattern.length > CONTENT_SAFETY_PATTERN_MAX_LENGTH) {
      skipped += 1;
      continue;
    }
    const key = normalizePatternKey(pattern);
    if (existingKeys.has(key) || pendingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    if (props.rules.length + toAdd.length >= CONTENT_SAFETY_CUSTOM_RULES_MAX) {
      skipped += candidates.length - i;
      break;
    }
    pendingKeys.add(key);
    toAdd.push({
      id: createRuleId(),
      pattern,
      severity: batchImportSeverity.value,
      enabled: true,
    });
  }

  if (toAdd.length === 0) {
    batchImportMessage.value =
      skipped > 0
        ? `未添加新词：${skipped} 个重复、超长或超出上限（最多 ${CONTENT_SAFETY_CUSTOM_RULES_MAX} 条）。`
        : '未添加新词，请检查输入。';
    return;
  }

  replaceRules([...props.rules, ...toAdd]);
  batchImportText.value = '';
  batchImportMessage.value =
    skipped > 0
      ? `已添加 ${toAdd.length} 条，跳过 ${skipped} 个重复、超长或超出上限的词条。`
      : `已添加 ${toAdd.length} 条禁用词。`;
}

function addRule() {
  replaceRules([
    ...props.rules,
    {
      id: createRuleId(),
      pattern: '',
      severity: 'low',
      enabled: true,
    },
  ]);
}

function removeRule(index: number) {
  replaceRules(props.rules.filter((_, i) => i !== index));
}

function updateRule<K extends keyof ProjectContentSafetyRule>(
  index: number,
  key: K,
  value: ProjectContentSafetyRule[K]
) {
  replaceRules(props.rules.map((rule, i) => (i === index ? { ...rule, [key]: value } : rule)));
}
</script>

<template>
  <div class="rules-editor">
    <div class="batch-import-block">
      <label class="batch-label" for="aq-batch-import">批量添加（逗号分隔）</label>
      <textarea
        id="aq-batch-import"
        v-model="batchImportText"
        class="batch-textarea"
        :disabled="disabled"
        rows="2"
        placeholder="例如：违禁词甲, 违禁词乙, 违禁词丙"
      />
      <div class="batch-actions">
        <select
          v-model="batchImportSeverity"
          class="severity-select"
          :disabled="disabled"
        >
          <option v-for="opt in severityOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <button
          class="batch-import-button"
          type="button"
          :disabled="disabled"
          @click="importBatchRules"
        >
          批量引入
        </button>
      </div>
      <p v-if="batchImportMessage" class="batch-message">{{ batchImportMessage }}</p>
    </div>

    <p v-if="props.rules.length === 0" class="empty-hint">尚未添加自定义禁用词。</p>
    <p v-else class="rules-count-hint">当前 {{ props.rules.length }} 条自定义禁用词</p>

    <div v-for="(rule, index) in props.rules" :key="rule.id" class="rule-row">
      <input
        class="pattern-input"
        type="text"
        :value="rule.pattern"
        :disabled="disabled"
        maxlength="64"
        placeholder="禁用词或短语"
        @input="updateRule(index, 'pattern', ($event.target as HTMLInputElement).value)"
      />
      <select
        class="severity-select"
        :value="rule.severity"
        :disabled="disabled"
        @change="
          updateRule(
            index,
            'severity',
            ($event.target as HTMLSelectElement).value as ProjectContentSafetyRule['severity']
          )
        "
      >
        <option v-for="opt in severityOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <label class="enabled-label">
        <input
          type="checkbox"
          :checked="rule.enabled"
          :disabled="disabled"
          @change="updateRule(index, 'enabled', ($event.target as HTMLInputElement).checked)"
        />
        启用
      </label>
      <button
        class="remove-button"
        type="button"
        :disabled="disabled"
        @click="removeRule(index)"
      >
        删除
      </button>
    </div>

    <button class="add-button" type="button" :disabled="disabled" @click="addRule">
      添加禁用词
    </button>
  </div>
</template>

<style scoped>
.rules-editor {
  margin-top: 0.5rem;
}

.batch-import-block {
  margin-bottom: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px dashed #e5e7eb;
}

.batch-label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.85rem;
  color: #374151;
}

.batch-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0.45rem 0.55rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.9rem;
  resize: vertical;
  min-height: 3rem;
}

.batch-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.45rem;
}

.batch-import-button {
  padding: 0.35rem 0.75rem;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  cursor: pointer;
  font-size: 0.85rem;
}

.batch-import-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.batch-message {
  margin: 0.45rem 0 0;
  font-size: 0.8rem;
  color: #6b7280;
}

.empty-hint {
  color: #9ca3af;
  font-size: 0.85rem;
  margin: 0 0 0.5rem;
}

.rules-count-hint {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  color: #374151;
}

.rule-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.pattern-input {
  flex: 1 1 12rem;
  min-width: 10rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.9rem;
}

.severity-select {
  flex: 0 0 11rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.85rem;
  background: #fff;
}

.enabled-label {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.85rem;
  color: #374151;
  user-select: none;
}

.remove-button {
  padding: 0.3rem 0.6rem;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: #fff;
  color: #b42318;
  cursor: pointer;
  font-size: 0.85rem;
}

.remove-button:disabled,
.add-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.add-button {
  margin-top: 0.25rem;
  padding: 0.35rem 0.75rem;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
  background: #f9fafb;
  color: #374151;
  cursor: pointer;
  font-size: 0.85rem;
}
</style>
