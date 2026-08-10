<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue';
import { apiClient, type ProjectContentSafetyRule, type ProjectSettings } from '../../services/api';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';

const CONTENT_SAFETY_CUSTOM_RULES_MAX = 200;
const CONTENT_SAFETY_PATTERN_MAX_LENGTH = 64;

const severityOptions = [
  { value: 'low' as const, label: '低风险（标记）' },
  { value: 'medium' as const, label: '中风险（重写句子）' },
  { value: 'high' as const, label: '高风险（阻断保存）' },
];

const props = defineProps<{
  projectId: string;
}>();

const summaryCount = shallowRef(3);
const memoryCount = shallowRef(3);
const priorTailChars = shallowRef(800);
const excerptMaxChars = shallowRef(400);
const outlineMaxChars = shallowRef(4000);
const personaProfileMaxChars = shallowRef(2000);
const relationMemoMaxChars = shallowRef(2000);
const updatePersonaOnSave = shallowRef(true);
const generateRelationEventsOnSave = shallowRef(true);
const contentSafetyScanEnabled = shallowRef(true);
const contentSafetyCustomRules = shallowRef<ProjectContentSafetyRule[]>([]);
const chapterOptimizeSegmentCharSize = shallowRef(3000);
const saved = shallowRef<{
  summaryCount: number;
  memoryCount: number;
  priorTailChars: number;
  excerptMaxChars: number;
  outlineMaxChars: number;
  personaProfileMaxChars: number;
  relationMemoMaxChars: number;
  updatePersonaOnSave: boolean;
  generateRelationEventsOnSave: boolean;
  contentSafetyScanEnabled: boolean;
  contentSafetyCustomRules: ProjectContentSafetyRule[];
  chapterOptimizeSegmentCharSize: number;
} | null>(null);

const loading = shallowRef(false);
const saving = shallowRef(false);
const rebuildingMemory = shallowRef(false);
const errorMessage = shallowRef('');
const message = shallowRef('');
const batchImportText = shallowRef('');
const batchImportSeverity = shallowRef<ProjectContentSafetyRule['severity']>('low');
const batchImportMessage = shallowRef('');

function createRuleId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function appendBatchPatterns(
  candidates: string[],
  severity: ProjectContentSafetyRule['severity']
): { added: number; skipped: number } {
  const existingKeys = new Set(
    contentSafetyCustomRules.value.map((rule) => normalizePatternKey(rule.pattern))
  );
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
    if (contentSafetyCustomRules.value.length + toAdd.length >= CONTENT_SAFETY_CUSTOM_RULES_MAX) {
      skipped += candidates.length - i;
      break;
    }
    pendingKeys.add(key);
    existingKeys.add(key);
    toAdd.push({
      id: createRuleId(),
      pattern,
      severity,
      enabled: true,
    });
  }

  if (toAdd.length > 0) {
    contentSafetyCustomRules.value = [...contentSafetyCustomRules.value, ...toAdd];
  }

  return { added: toAdd.length, skipped };
}

function flushPendingBatchImport(): { added: number; skipped: number } {
  const candidates = parseBatchPatterns(batchImportText.value);
  if (candidates.length === 0) {
    return { added: 0, skipped: 0 };
  }
  const result = appendBatchPatterns(candidates, batchImportSeverity.value);
  if (result.added > 0) {
    batchImportText.value = '';
  }
  return result;
}

function importBatchRules() {
  batchImportMessage.value = '';
  const candidates = parseBatchPatterns(batchImportText.value);
  if (candidates.length === 0) {
    batchImportMessage.value = '请输入至少一个禁用词，多个词用逗号分隔。';
    return;
  }

  const { added, skipped } = appendBatchPatterns(candidates, batchImportSeverity.value);
  if (added === 0) {
    batchImportMessage.value =
      skipped > 0
        ? `未添加新词：${skipped} 个重复、超长或超出上限（最多 ${CONTENT_SAFETY_CUSTOM_RULES_MAX} 条）。`
        : '未添加新词，请检查输入。';
    return;
  }

  batchImportText.value = '';
  batchImportMessage.value =
    skipped > 0
      ? `已添加 ${added} 条，跳过 ${skipped} 个重复、超长或超出上限的词条。`
      : `已添加 ${added} 条禁用词。`;
}

function addCustomRule() {
  contentSafetyCustomRules.value = [
    ...contentSafetyCustomRules.value,
    {
      id: createRuleId(),
      pattern: '',
      severity: 'low',
      enabled: true,
    },
  ];
}

function removeCustomRule(index: number) {
  contentSafetyCustomRules.value = contentSafetyCustomRules.value.filter((_, i) => i !== index);
}

function updateCustomRule<K extends keyof ProjectContentSafetyRule>(
  index: number,
  key: K,
  value: ProjectContentSafetyRule[K]
) {
  contentSafetyCustomRules.value = contentSafetyCustomRules.value.map((rule, i) =>
    i === index ? { ...rule, [key]: value } : rule
  );
}

function normalizeCustomRules(raw: unknown): ProjectContentSafetyRule[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const pattern = typeof row.pattern === 'string' ? row.pattern : '';
    const severity = row.severity;
    if (!id || !['low', 'medium', 'high'].includes(String(severity))) {
      return [];
    }
    return [
      {
        id,
        pattern,
        severity: severity as ProjectContentSafetyRule['severity'],
        enabled: row.enabled !== false,
      },
    ];
  });
}

function buildRulesPayload(): ProjectContentSafetyRule[] {
  return contentSafetyCustomRules.value
    .map((rule) => ({
      ...rule,
      pattern: rule.pattern.trim(),
    }))
    .filter((rule) => rule.pattern.length > 0);
}

function serializeCustomRules(rules: ProjectContentSafetyRule[]) {
  return JSON.stringify(
    rules.map((rule) => ({
      id: rule.id,
      pattern: rule.pattern.trim(),
      severity: rule.severity,
      enabled: rule.enabled,
    }))
  );
}

const isDirty = computed(() => {
  if (!saved.value) {
    return false;
  }
  return (
    summaryCount.value !== saved.value.summaryCount ||
    memoryCount.value !== saved.value.memoryCount ||
    priorTailChars.value !== saved.value.priorTailChars ||
    excerptMaxChars.value !== saved.value.excerptMaxChars ||
    outlineMaxChars.value !== saved.value.outlineMaxChars ||
    personaProfileMaxChars.value !== saved.value.personaProfileMaxChars ||
    relationMemoMaxChars.value !== saved.value.relationMemoMaxChars ||
    updatePersonaOnSave.value !== saved.value.updatePersonaOnSave ||
    generateRelationEventsOnSave.value !== saved.value.generateRelationEventsOnSave ||
    contentSafetyScanEnabled.value !== saved.value.contentSafetyScanEnabled ||
    chapterOptimizeSegmentCharSize.value !== saved.value.chapterOptimizeSegmentCharSize ||
    serializeCustomRules(contentSafetyCustomRules.value) !==
      serializeCustomRules(saved.value.contentSafetyCustomRules)
  );
});

function resolveCustomRules(
  raw: unknown,
  fallback: ProjectContentSafetyRule[] = []
): ProjectContentSafetyRule[] {
  const fromApi = normalizeCustomRules(raw);
  return fromApi.length > 0 ? fromApi : fallback.map((rule) => ({ ...rule }));
}

function applyFromSettings(s: ProjectSettings, rulesFallback: ProjectContentSafetyRule[] = []) {
  summaryCount.value = s.chapterSummaryPromptCount;
  memoryCount.value =
    (s as { chapterSummaryMemoryCount?: number }).chapterSummaryMemoryCount ?? 3;
  priorTailChars.value = (s as { priorChapterTailChars?: number }).priorChapterTailChars ?? 800;
  excerptMaxChars.value = (s as { contextExcerptMaxChars?: number }).contextExcerptMaxChars ?? 400;
  outlineMaxChars.value = (s as { outlineMaxChars?: number }).outlineMaxChars ?? 4000;
  personaProfileMaxChars.value =
    (s as { personaProfileMaxChars?: number }).personaProfileMaxChars ?? 2000;
  relationMemoMaxChars.value =
    (s as { relationMemoMaxChars?: number }).relationMemoMaxChars ?? 2000;
  updatePersonaOnSave.value = s.updatePersonaOnSave ?? true;
  generateRelationEventsOnSave.value = s.generateRelationEventsOnSave ?? true;
  contentSafetyScanEnabled.value = s.contentSafetyScanEnabled ?? true;
  const rules = resolveCustomRules(s.contentSafetyCustomRules, rulesFallback);
  contentSafetyCustomRules.value = rules;
  chapterOptimizeSegmentCharSize.value = s.chapterOptimizeSegmentCharSize ?? 3000;
  saved.value = {
    summaryCount: s.chapterSummaryPromptCount,
    memoryCount:
      (s as { chapterSummaryMemoryCount?: number }).chapterSummaryMemoryCount ?? 3,
    priorTailChars: (s as { priorChapterTailChars?: number }).priorChapterTailChars ?? 800,
    excerptMaxChars: (s as { contextExcerptMaxChars?: number }).contextExcerptMaxChars ?? 400,
    outlineMaxChars: (s as { outlineMaxChars?: number }).outlineMaxChars ?? 4000,
    personaProfileMaxChars:
      (s as { personaProfileMaxChars?: number }).personaProfileMaxChars ?? 2000,
    relationMemoMaxChars: (s as { relationMemoMaxChars?: number }).relationMemoMaxChars ?? 2000,
    updatePersonaOnSave: s.updatePersonaOnSave ?? true,
    generateRelationEventsOnSave: s.generateRelationEventsOnSave ?? true,
    contentSafetyScanEnabled: s.contentSafetyScanEnabled ?? true,
    contentSafetyCustomRules: rules.map((rule) => ({ ...rule })),
    chapterOptimizeSegmentCharSize: s.chapterOptimizeSegmentCharSize ?? 3000,
  };
}

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const s = await apiClient.getSettings(props.projectId);
    applyFromSettings(s);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载生成偏好失败');
  } finally {
    loading.value = false;
  }
}

function formatRebuildMemoryResult(
  result: Awaited<ReturnType<typeof apiClient.rebuildChapterSummaryMemory>>
): string {
  const parts = [`已写入 ${result.indexed} 章`];
  if (result.skipped > 0) {
    parts.push(`${result.skipped} 章跳过（无摘要）`);
  }
  if (result.failed > 0) {
    parts.push(`${result.failed} 章失败`);
  }
  return parts.join('，');
}

async function handleSyncExistingSummaryMemory() {
  rebuildingMemory.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const result = await apiClient.rebuildChapterSummaryMemory(props.projectId, {
      source: 'existing',
    });
    message.value = presentSuccess(
      `${formatRebuildMemoryResult(result)}语义记忆（使用已有 LLM 摘要，不消耗 token）`
    );
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '同步已有摘要失败');
  } finally {
    rebuildingMemory.value = false;
  }
}

async function handleRebuildSummaryMemoryFromContent() {
  rebuildingMemory.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const result = await apiClient.rebuildChapterSummaryMemory(props.projectId, {
      source: 'content_fallback',
    });
    message.value = presentSuccess(
      `${formatRebuildMemoryResult(result)}语义记忆（正文前 160 字，不消耗 LLM token）`
    );
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '从正文重建语义记忆失败');
  } finally {
    rebuildingMemory.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  errorMessage.value = '';
  message.value = '';
  const autoImport = flushPendingBatchImport();
  const rulesToSave = buildRulesPayload();
  try {
    const s = await apiClient.updateSettings(props.projectId, {
      chapterSummaryPromptCount: summaryCount.value,
      chapterSummaryMemoryCount: memoryCount.value,
      priorChapterTailChars: priorTailChars.value,
      contextExcerptMaxChars: excerptMaxChars.value,
      outlineMaxChars: outlineMaxChars.value,
      personaProfileMaxChars: personaProfileMaxChars.value,
      relationMemoMaxChars: relationMemoMaxChars.value,
      updatePersonaOnSave: updatePersonaOnSave.value,
      generateRelationEventsOnSave: generateRelationEventsOnSave.value,
      contentSafetyScanEnabled: contentSafetyScanEnabled.value,
      chapterOptimizeSegmentCharSize: chapterOptimizeSegmentCharSize.value,
      contentSafetyCustomRules: rulesToSave,
    });
    applyFromSettings(s, rulesToSave);
    const autoImportHint =
      autoImport.added > 0 ? `（保存前自动收录 ${autoImport.added} 条批量词条）` : '';
    message.value = presentSuccess(
      rulesToSave.length > 0
        ? `生成偏好已保存（含 ${rulesToSave.length} 条禁用词）${autoImportHint}`
        : `生成偏好已保存${autoImportHint}`
    );
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '保存生成偏好失败');
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.projectId,
  () => {
    void load();
  }
);

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">生成偏好</h3>
    <p class="field-hint">
      「摘要数」决定叙事上下文中注入多少条<strong>当前章节之前</strong>的章节摘要（按章号从新到旧）；设为
      0 则不注入摘要段。模型厂商、模型与温度请到顶栏「设置」中的全局模型设置配置。
    </p>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>
    <p v-if="loading" class="message">正在加载生成偏好...</p>

    <template v-if="!loading">
      <div class="row">
        <label class="field-label" for="aq-summary-count">Prompt 携带章节摘要数</label>
        <input
          id="aq-summary-count"
          v-model.number="summaryCount"
          class="field-input"
          type="number"
          min="0"
          max="10"
          step="1"
        />
      </div>
      <p class="field-hint inline-hint">
        范围 0~10；默认 3。选取「章号 &lt; 当前写作章节」的章节；无摘要时使用正文摘录降级（近期连续性池）。
      </p>

      <div class="row">
        <label class="field-label" for="aq-memory-count">语义记忆章节数</label>
        <input
          id="aq-memory-count"
          v-model.number="memoryCount"
          class="field-input"
          type="number"
          min="0"
          max="10"
          step="1"
        />
      </div>
      <p class="field-hint inline-hint">范围 0~10；默认 3。对历史章节摘要做向量检索的相关条数。</p>
      <div class="memory-rebuild-row">
        <button
          class="primary-button memory-action-button"
          type="button"
          :disabled="rebuildingMemory"
          @click="handleSyncExistingSummaryMemory"
        >
          {{ rebuildingMemory ? '同步中...' : '同步已有摘要到向量库' }}
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="rebuildingMemory"
          @click="handleRebuildSummaryMemoryFromContent"
        >
          从正文截取重建
        </button>
      </div>
      <p class="field-hint inline-hint memory-rebuild-hint">
        已用「生成摘要」产生 LLM 摘要时，点「同步已有摘要」即可写入 Qdrant，不再次调用模型。批量同步会自动限速，章数多时请耐心等待。无摘要的章会跳过。
      </p>

      <div class="row">
        <label class="field-label" for="aq-prior-tail">前章衔接字数</label>
        <input
          id="aq-prior-tail"
          v-model.number="priorTailChars"
          class="field-input"
          type="number"
          min="0"
          max="2000"
          step="50"
        />
      </div>
      <p class="field-hint inline-hint">
        写第 N 章时注入第 N-1 章正文末尾字符数；范围 0~2000，默认 800。0 表示关闭（不推荐）。
      </p>

      <div class="row">
        <label class="field-label" for="aq-outline-max">大纲注入预算（字）</label>
        <input
          id="aq-outline-max"
          v-model.number="outlineMaxChars"
          class="field-input"
          type="number"
          min="0"
          max="8000"
          step="100"
        />
      </div>
      <p class="field-hint inline-hint">
        【大纲总结】最大字符；0 不注入。超预算时按本章匹配文本做区段裁剪，默认 4000。
      </p>

      <div class="row">
        <label class="field-label" for="aq-persona-max">人物静态卡预算（字）</label>
        <input
          id="aq-persona-max"
          v-model.number="personaProfileMaxChars"
          class="field-input"
          type="number"
          min="0"
          max="8000"
          step="100"
        />
      </div>
      <p class="field-hint inline-hint">
        出场人物每人静态设定卡（或简介回退）上限；默认 2000。0 表示不注入静态正文。
      </p>

      <div class="row">
        <label class="field-label" for="aq-relation-max">关系备忘预算（字）</label>
        <input
          id="aq-relation-max"
          v-model.number="relationMemoMaxChars"
          class="field-input"
          type="number"
          min="0"
          max="8000"
          step="100"
        />
      </div>
      <p class="field-hint inline-hint">身份关系 + 已选关系事件合计上限；默认 2000。0 表示不注入。</p>

      <div class="row">
        <label class="field-label" for="aq-excerpt-max">无摘要摘录字数</label>
        <input
          id="aq-excerpt-max"
          v-model.number="excerptMaxChars"
          class="field-input"
          type="number"
          min="200"
          max="800"
          step="50"
        />
      </div>
      <p class="field-hint inline-hint">
        前序章节无摘要时，从正文尾部截取的 excerpt 长度；范围 200~800，默认 400。
      </p>

      <div class="row">
        <label class="field-label" for="aq-optimize-segment">章节优化分段字数</label>
        <input
          id="aq-optimize-segment"
          v-model.number="chapterOptimizeSegmentCharSize"
          class="field-input"
          type="number"
          min="0"
          max="20000"
          step="100"
        />
      </div>
      <p class="field-hint inline-hint">
        方案阶段长章按字数切分诊断；范围 0~20000，默认 3000。设为 0 表示不按字数分段（始终整章方案）。
      </p>

      <div class="toggle-row">
        <label class="toggle-label">
          <input v-model="updatePersonaOnSave" type="checkbox" class="toggle-checkbox" />
          <span class="toggle-text">手动保存章节后，提示更新人物出场状态</span>
        </label>
      </div>

      <div class="toggle-row">
        <label class="toggle-label">
          <input v-model="generateRelationEventsOnSave" type="checkbox" class="toggle-checkbox" />
          <span class="toggle-text">手动保存章节后，提示生成本章关系事件</span>
        </label>
      </div>
      <p class="field-hint inline-hint">
        以上开关仅控制「手动编辑保存」是否弹出后处理确认；创作精修 / 一键终稿 / 合规应用会静默更新人物状态，不会重复弹窗。
      </p>

      <div class="toggle-row">
        <label class="toggle-label">
          <input v-model="contentSafetyScanEnabled" type="checkbox" class="toggle-checkbox" />
          <span class="toggle-text">AI 正文生成后执行内容安全扫描</span>
        </label>
      </div>
      <p class="field-hint inline-hint">
        开启后，章节续写、优化正文等 AI 输出会经过硬规则扫描；关闭后跳过扫描与自动改写，但仍显示任务进度。
      </p>

      <div class="content-safety-rules-block">
        <h4 class="subsection-title">自定义禁用词</h4>
        <p class="field-hint inline-hint">
          与系统默认规则合并扫描。高风险将阻断保存，中风险尝试改写句子，低风险仅标记。可先点「批量引入」预览列表，也可直接保存（未引入的批量词条会自动收录）。
        </p>

        <div class="rules-editor">
          <div class="batch-import-block">
            <label class="batch-label" for="aq-batch-import">批量添加（逗号分隔）</label>
            <textarea
              id="aq-batch-import"
              v-model="batchImportText"
              class="batch-textarea"
              :disabled="saving"
              rows="2"
              placeholder="例如：违禁词甲, 违禁词乙, 违禁词丙"
            />
            <div class="batch-actions">
              <select v-model="batchImportSeverity" class="severity-select" :disabled="saving">
                <option v-for="opt in severityOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
              <button
                class="batch-import-button"
                type="button"
                :disabled="saving"
                @click="importBatchRules"
              >
                批量引入
              </button>
            </div>
            <p v-if="batchImportMessage" class="batch-message">{{ batchImportMessage }}</p>
          </div>

          <p v-if="contentSafetyCustomRules.length === 0" class="empty-hint">
            尚未添加自定义禁用词。
          </p>
          <p v-else class="rules-count-hint">
            当前 {{ contentSafetyCustomRules.length }} 条自定义禁用词
          </p>

          <div
            v-for="(rule, index) in contentSafetyCustomRules"
            :key="rule.id"
            class="rule-row"
          >
            <input
              class="pattern-input"
              type="text"
              :value="rule.pattern"
              :disabled="saving"
              maxlength="64"
              placeholder="禁用词或短语"
              @input="
                updateCustomRule(index, 'pattern', ($event.target as HTMLInputElement).value)
              "
            />
            <select
              class="severity-select"
              :value="rule.severity"
              :disabled="saving"
              @change="
                updateCustomRule(
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
                :disabled="saving"
                @change="
                  updateCustomRule(index, 'enabled', ($event.target as HTMLInputElement).checked)
                "
              />
              启用
            </label>
            <button
              class="remove-button"
              type="button"
              :disabled="saving"
              @click="removeCustomRule(index)"
            >
              删除
            </button>
          </div>

          <button class="add-button" type="button" :disabled="saving" @click="addCustomRule">
            添加禁用词
          </button>
        </div>
      </div>

      <div class="meta-bar">
        <span v-if="isDirty" class="dirty-badge">未保存</span>
      </div>

      <div class="action-bar">
        <button
          class="primary-button"
          type="button"
          :disabled="saving || !isDirty"
          @click="handleSave"
        >
          {{ saving ? '保存中...' : '保存生成偏好' }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fff;
}

.panel-title {
  margin-bottom: 0.35rem;
  font-size: 1rem;
}

.field-hint {
  color: #9ca3af;
  font-size: 0.8rem;
  margin-bottom: 0.75rem;
}

.inline-hint {
  margin-top: -0.35rem;
  margin-bottom: 0.75rem;
}

.message {
  margin-bottom: 0.75rem;
}

.message-ok {
  color: #027a48;
}

.message-error {
  color: #b42318;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.35rem;
}

.field-label {
  min-width: 11rem;
  font-size: 0.9rem;
  color: #374151;
}

.field-input {
  width: 8rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.95rem;
}

.field-input-wide {
  width: min(24rem, 100%);
  flex: 1 1 12rem;
}

.meta-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0;
}

.dirty-badge {
  font-size: 0.75rem;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
}

.action-bar {
  display: flex;
  gap: 0.5rem;
}

.toggle-row {
  display: flex;
  align-items: center;
  margin-bottom: 0.35rem;
}

.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
  user-select: none;
}

.toggle-checkbox {
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: #111827;
}

.toggle-text {
  font-size: 0.9rem;
  color: #374151;
}

.primary-button {
  padding: 0.45rem 0.9rem;
  border-radius: 6px;
  border: none;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  font-size: 0.9rem;
}

.primary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.memory-rebuild-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0.25rem 0 0.35rem;
}

.memory-action-button {
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
}

.memory-rebuild-hint {
  margin: 0 0 0.85rem;
}

.secondary-button {
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  cursor: pointer;
  font-size: 0.85rem;
}

.secondary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.content-safety-rules-block {
  margin: 0.75rem 0 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid #f3f4f6;
}

.subsection-title {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  color: #111827;
}

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
