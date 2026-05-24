<script setup lang="ts">
import { computed, onMounted, ref, watch, withDefaults } from 'vue';
import {
  apiClient,
  type ChapterItem,
  type PersonaItem,
  type RelationEventItem,
} from '../../services/api';
import {
  buildRecommendedRelationEventIds,
  detectAbsentPersonaWarnings,
  findUnselectedRelationSuggestions,
} from '../../utils/personaGraph';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';

const props = withDefaults(
  defineProps<{
    generating: boolean;
    projectId: string;
    personaNames: string[];
    personas: PersonaItem[];
    knowledgeChapters: ChapterItem[];
  }>(),
  {
    knowledgeChapters: () => [],
    personas: () => [],
  }
);

const emit = defineEmits<{
  generate: [
    task: {
      chapterNo: number;
      goal: string;
      pov: string;
      mustInclude: string[];
      avoid: string[];
      targetWords?: number;
      appearingCharacters: string[];
      selectedEventIds: string[];
    },
  ];
  'structured-parsed': [];
}>();

function suggestedChapterNoFromMax(max: number): number {
  return max > 0 ? max + 1 : 1;
}

const chapterNo = ref(1);
const goal = ref('');
const pov = ref('第三人称有限视角');
const mustIncludeText = ref('');
const avoidText = ref('');
const targetWords = ref(3000);
const unlimitedWords = ref(false);
const customCharacter = ref('');
const appearingCharacters = ref<string[]>([]);
const selectedEventIds = ref<string[]>([]);
const relationEvents = ref<RelationEventItem[]>([]);
const loadingEvents = ref(false);
const eventError = ref('');
const parsingStructured = ref(false);
const structuredParseError = ref('');

const availableCharacters = computed(() => [...new Set(props.personaNames.filter(Boolean))]);

const currentStructured = computed(() => {
  const n = Number(chapterNo.value);
  return props.knowledgeChapters.find((c) => c.chapterNo === n)?.structuredInfo;
});

const missingStructuredForKb = computed(() => !currentStructured.value?.matchingText?.trim());

const maxChapterNo = computed(() => {
  if (props.knowledgeChapters.length === 0) {
    return 0;
  }
  return Math.max(...props.knowledgeChapters.map((chapter) => chapter.chapterNo));
});

const suggestedChapterNo = computed(() => suggestedChapterNoFromMax(maxChapterNo.value));

function applySuggestedChapterNo() {
  chapterNo.value = suggestedChapterNo.value;
}

const filteredEvents = computed(() => {
  if (appearingCharacters.value.length === 0) {
    return relationEvents.value;
  }
  const recommended = new Set(
    buildRecommendedRelationEventIds(relationEvents.value, appearingCharacters.value)
  );
  return relationEvents.value.filter((event) => recommended.has(event.id));
});

const recommendedEventIds = computed(() =>
  buildRecommendedRelationEventIds(relationEvents.value, appearingCharacters.value)
);

const relationSuggestions = computed(() =>
  findUnselectedRelationSuggestions(
    relationEvents.value,
    appearingCharacters.value,
    selectedEventIds.value
  )
);

const absentWarnings = computed(() =>
  detectAbsentPersonaWarnings(props.personas, maxChapterNo.value)
);

const personaStateByName = computed(() => {
  const map = new Map<string, string>();
  for (const persona of props.personas) {
    map.set(persona.name, persona.state || '待更新');
  }
  return map;
});

const selectedPreviewLength = computed(() =>
  filteredEvents.value
    .filter((event) => selectedEventIds.value.includes(event.id))
    .reduce((total, event) => total + event.summary.length, 0)
);

function parseMultiLine(text: string): string[] {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleCharacter(name: string) {
  if (appearingCharacters.value.includes(name)) {
    appearingCharacters.value = appearingCharacters.value.filter((item) => item !== name);
    applyRecommendedEvents();
    return;
  }
  appearingCharacters.value = [...appearingCharacters.value, name];
  applyRecommendedEvents();
}

function addCustomCharacter() {
  const name = customCharacter.value.trim();
  if (!name || appearingCharacters.value.includes(name)) {
    return;
  }
  appearingCharacters.value = [...appearingCharacters.value, name];
  customCharacter.value = '';
}

function toggleEvent(eventId: string) {
  if (selectedEventIds.value.includes(eventId)) {
    selectedEventIds.value = selectedEventIds.value.filter((item) => item !== eventId);
    return;
  }
  if (selectedEventIds.value.length >= 30) {
    eventError.value = '最多勾选 30 条关系事件';
    return;
  }
  eventError.value = '';
  selectedEventIds.value = [...selectedEventIds.value, eventId];
}

async function loadRelationEvents() {
  if (!props.projectId) return;
  loadingEvents.value = true;
  eventError.value = '';
  try {
    relationEvents.value = await apiClient.getRelationEvents(props.projectId);
    selectedEventIds.value = selectedEventIds.value.filter((eventId) =>
      relationEvents.value.some((event) => event.id === eventId)
    );
    applyRecommendedEvents();
  } catch (error) {
    eventError.value = error instanceof Error ? error.message : '加载关系事件失败';
  } finally {
    loadingEvents.value = false;
  }
}

function applyRecommendedEvents() {
  if (appearingCharacters.value.length === 0) {
    return;
  }
  const recommended = buildRecommendedRelationEventIds(
    relationEvents.value,
    appearingCharacters.value
  );
  selectedEventIds.value = [...new Set([...selectedEventIds.value, ...recommended])].slice(0, 30);
}

function handleGenerate() {
  if (!goal.value.trim()) return;

  emit('generate', {
    chapterNo: Number(chapterNo.value),
    goal: goal.value.trim(),
    pov: pov.value.trim(),
    mustInclude: parseMultiLine(mustIncludeText.value),
    avoid: parseMultiLine(avoidText.value),
    appearingCharacters: [...appearingCharacters.value],
    selectedEventIds: [...selectedEventIds.value],
    ...(unlimitedWords.value ? {} : { targetWords: Number(targetWords.value) }),
  });
}

async function handleParseStructured() {
  structuredParseError.value = '';
  parsingStructured.value = true;
  try {
    await apiClient.parseChapterStructuredInfo(props.projectId, Number(chapterNo.value), {
      mode: 'workbench',
      goal: goal.value,
      pov: pov.value,
      mustInclude: parseMultiLine(mustIncludeText.value),
      avoid: parseMultiLine(avoidText.value),
    });
    presentSuccess('本章结构化信息已解析并保存');
    emit('structured-parsed');
  } catch (error) {
    structuredParseError.value = presentErrorFromCaught(error, '解析失败');
  } finally {
    parsingStructured.value = false;
  }
}

function resetForm() {
  applySuggestedChapterNo();
  goal.value = '';
  pov.value = '第三人称有限视角';
  mustIncludeText.value = '';
  avoidText.value = '';
  targetWords.value = 3000;
  unlimitedWords.value = false;
  customCharacter.value = '';
  appearingCharacters.value = [];
  selectedEventIds.value = [];
}

watch(
  () => [props.projectId, appearingCharacters.value.join('|')] as const,
  () => {
    void loadRelationEvents();
  }
);

watch(chapterNo, () => {
  structuredParseError.value = '';
});

watch(
  maxChapterNo,
  (max, prevMax) => {
    const nextSuggested = suggestedChapterNoFromMax(max);
    const prevSuggested = suggestedChapterNoFromMax(prevMax ?? 0);
    if (chapterNo.value === prevSuggested || (chapterNo.value === 1 && max > 0)) {
      chapterNo.value = nextSuggested;
    }
  },
  { immediate: true }
);

watch(
  () => props.projectId,
  () => {
    applySuggestedChapterNo();
  }
);

onMounted(() => {
  void loadRelationEvents();
});

defineExpose({ resetForm });
</script>

<template>
  <section class="prompt-console">
    <div class="panel-heading">
      <h3 class="panel-title">生成参数</h3>
      <p class="panel-description">填写本章核心信息；角色、关系与约束可展开配置。</p>
    </div>

    <div class="form-section">
      <div class="form-row">
        <label class="field-label">
          章节号
          <input v-model.number="chapterNo" type="number" min="1" class="field-input" />
        </label>
        <div class="field-label">
          <span>目标字数</span>
          <input
            v-model.number="targetWords"
            type="number"
            min="200"
            step="100"
            class="field-input"
            :disabled="unlimitedWords"
          />
          <label class="unlimited-toggle">
            <input v-model="unlimitedWords" type="checkbox" />
            不限制字数（尽量写长）
          </label>
        </div>
      </div>

      <label class="field-label">
        本章目标
        <textarea
          v-model="goal"
          class="field-textarea"
          placeholder="例如：主角在旧港口与导师对峙并拿到怀表线索"
          rows="4"
        />
      </label>

      <div v-if="missingStructuredForKb" class="structured-kb-banner" role="status">
        <p class="structured-kb-title">知识库匹配提示</p>
        <p class="structured-kb-body">
          未生成结构化信息，无法匹配知识库。请先点击下方「解析结构化信息」，将本章目标字段抽取为与文档标题对齐的匹配文本。
        </p>
      </div>
      <div v-else class="structured-kb-ok" role="status">
        <p class="structured-kb-title">结构化信息（已就绪）</p>
        <p v-if="currentStructured?.narrativeSummary" class="structured-kb-body">
          {{ currentStructured.narrativeSummary }}
        </p>
        <p v-else class="structured-kb-body text-muted">
          已生成匹配文本，生成草稿时将按标题匹配注入知识库文档全文。
        </p>
      </div>
      <p v-if="structuredParseError" class="message message-error">{{ structuredParseError }}</p>
      <div class="structured-actions">
        <button
          type="button"
          class="secondary-button"
          :disabled="parsingStructured || generating || !goal.trim()"
          @click="handleParseStructured"
        >
          {{ parsingStructured ? '解析中...' : '解析结构化信息' }}
        </button>
      </div>

      <label class="field-label">
        叙事视角（POV）
        <input v-model="pov" class="field-input" type="text" placeholder="例如：女主第一人称" />
      </label>
    </div>

    <details class="wb-accordion">
      <summary class="wb-accordion-summary">角色与关系事件</summary>
      <div class="wb-accordion-body">
        <section class="relation-section">
          <h4 class="section-title">出场角色</h4>
          <div v-if="absentWarnings.length > 0" class="hint-list">
            <p
              v-for="warning in absentWarnings"
              :key="warning.personaId"
              class="message message-warn"
            >
              ⚠ {{ warning.name }} 已连续 {{ warning.absentChapterCount }} 章未出场
              <template v-if="warning.lastAppearedChapterNo">
                （最后出场：第{{ warning.lastAppearedChapterNo }}章）
              </template>
            </p>
          </div>
          <div class="chip-list">
            <button
              v-for="name in availableCharacters"
              :key="name"
              type="button"
              class="chip-button"
              :class="{ 'chip-button-active': appearingCharacters.includes(name) }"
              @click="toggleCharacter(name)"
            >
              <span>{{ name }}</span>
              <span class="chip-meta">{{ personaStateByName.get(name) }}</span>
            </button>
          </div>
          <div class="custom-character-row">
            <input
              v-model="customCharacter"
              class="field-input"
              placeholder="自定义出场角色"
              @keyup.enter.prevent="addCustomCharacter"
            />
            <button class="secondary-button" type="button" @click="addCustomCharacter">添加</button>
          </div>
        </section>

        <section class="relation-section relation-section--events">
          <div class="section-header">
            <h4 class="section-title">
              {{ appearingCharacters.length > 0 ? '系统推荐关系事件' : '关系事件（手动勾选）' }}
            </h4>
            <span class="section-meta">
              已选 {{ selectedEventIds.length }} 条 / 约 {{ selectedPreviewLength }} 字
            </span>
          </div>
          <p v-if="appearingCharacters.length > 0" class="message">
            已根据出场角色自动推荐 {{ recommendedEventIds.length }} 条，可取消勾选。
          </p>
          <p v-for="item in relationSuggestions" :key="item.id" class="message message-warn">
            ☐ {{ item.label }}
          </p>
          <p v-if="eventError" class="message message-error">{{ eventError }}</p>
          <p v-if="loadingEvents" class="message">正在加载关系事件...</p>
          <p v-else-if="filteredEvents.length === 0" class="message">暂无可选关系事件。</p>
          <div v-else class="event-checklist">
            <label v-for="event in filteredEvents" :key="event.id" class="event-option">
              <input
                type="checkbox"
                :checked="selectedEventIds.includes(event.id)"
                @change="toggleEvent(event.id)"
              />
              <span class="event-option-text">
                <strong>{{ event.protagonist }} ↔ {{ event.counterparty }}</strong>
                <span class="event-option-meta">
                  <template v-if="event.chapterNo">第{{ event.chapterNo }}章</template>
                </span>
                <span>{{ event.summary }}</span>
              </span>
            </label>
          </div>
        </section>
      </div>
    </details>

    <details class="wb-accordion">
      <summary class="wb-accordion-summary">写作约束（可选）</summary>
      <div class="wb-accordion-body">
        <div class="form-section form-section--flush">
          <div class="form-grid">
            <label class="field-label">
              必须包含（每行一条）
              <textarea
                v-model="mustIncludeText"
                class="field-textarea"
                placeholder="旧港口&#10;怀表线索&#10;雨夜追逐"
                rows="5"
              />
            </label>
            <label class="field-label">
              禁止内容（每行一条）
              <textarea
                v-model="avoidText"
                class="field-textarea"
                placeholder="直接揭露终极反派&#10;角色性格突变"
                rows="5"
              />
            </label>
          </div>
        </div>
      </div>
    </details>

    <div class="prompt-cta">
      <button
        class="wb-btn wb-btn--primary wb-btn--block"
        type="button"
        :disabled="generating || !goal.trim()"
        @click="handleGenerate"
      >
        {{ generating ? '正在生成大纲…' : '① 生成章节大纲' }}
      </button>
      <p class="prompt-cta-hint">将先预览检索上下文，再流式生成大纲。</p>
    </div>
  </section>
</template>

<style scoped>
.prompt-console {
  border: 1px solid var(--wb-border, #e5e7eb);
  border-radius: var(--wb-radius, 12px);
  padding: 1.15rem;
  background: var(--wb-surface, #fff);
  box-shadow: var(--wb-shadow, none);
}

.panel-heading {
  margin-bottom: 1.15rem;
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

.form-section {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-bottom: 1.15rem;
}

.form-section:last-child {
  margin-bottom: 0;
}

.form-row {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
  font-weight: 600;
  font-size: 0.88rem;
  color: #374151;
}

.unlimited-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 500;
  font-size: 0.84rem;
  color: #4b5563;
  margin-top: 0.15rem;
}

.field-input,
.field-textarea {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
  font-size: 0.92rem;
  font-family: inherit;
  background: #fff;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.field-input:focus,
.field-textarea:focus {
  outline: none;
  border-color: #93c5fd;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.field-textarea {
  min-height: 100px;
  resize: vertical;
  line-height: 1.6;
}

.wb-accordion {
  margin-bottom: 0.75rem;
  border: 1px solid var(--wb-border, #e5e7eb);
  border-radius: var(--wb-radius-sm, 10px);
  background: var(--wb-surface-muted, #f8fafc);
  overflow: hidden;
}

.wb-accordion-summary {
  padding: 0.7rem 0.9rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--wb-text, #0f172a);
  cursor: pointer;
  list-style: none;
}

.wb-accordion-summary::-webkit-details-marker {
  display: none;
}

.wb-accordion-summary::after {
  content: '＋';
  float: right;
  color: var(--wb-text-muted, #94a3b8);
  font-weight: 400;
}

.wb-accordion[open] .wb-accordion-summary::after {
  content: '－';
}

.wb-accordion-body {
  padding: 0 0.9rem 0.9rem;
  border-top: 1px solid var(--wb-border, #e5e7eb);
}

.relation-section {
  margin-bottom: 0.85rem;
}

.relation-section--events {
  margin-bottom: 0;
}

.form-section--flush {
  margin-bottom: 0;
}

.prompt-cta {
  margin-top: 1rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--wb-border, #e5e7eb);
}

.prompt-cta-hint {
  margin: 0.45rem 0 0;
  font-size: 0.78rem;
  color: var(--wb-text-muted, #94a3b8);
  text-align: center;
}

.wb-btn--block {
  width: 100%;
}

.wb-btn--primary {
  border: none;
  background: var(--wb-primary, #4f46e5);
  color: #fff;
  min-height: 2.75rem;
  border-radius: var(--wb-radius-sm, 10px);
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
}

.wb-btn--primary:hover:not(:disabled) {
  background: var(--wb-primary-hover, #4338ca);
}

.wb-btn--primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.section-title {
  margin: 0 0 0.65rem;
  font-size: 0.92rem;
  color: #374151;
}

.section-header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.65rem;
}

.section-meta {
  font-size: 0.8rem;
  color: #6b7280;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.custom-character-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.65rem;
}

.custom-character-row .field-input {
  flex: 1;
}

.chip-button,
.secondary-button {
  border-radius: 8px;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.15s;
}

.chip-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
}

.chip-button:hover {
  border-color: #93c5fd;
  background: #f0f5ff;
}

.chip-meta {
  display: block;
  font-size: 0.7rem;
  color: #6b7280;
  font-weight: 400;
}

.message-warn {
  color: #b45309;
}

.hint-list {
  margin-bottom: 0.5rem;
}

.chip-button-active {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.secondary-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
}

.secondary-button:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.primary-button {
  border: none;
  background: #1d4ed8;
  color: #fff;
  border-radius: 8px;
  padding: 0.6rem 1.1rem;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.15s;
}

.primary-button:hover {
  background: #2563eb;
}

.generate-button {
  align-self: flex-start;
  margin-top: 0.5rem;
  padding: 0.65rem 1.2rem;
  font-size: 0.92rem;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.event-checklist {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  max-height: 300px;
  overflow: auto;
  padding-right: 0.15rem;
}

.event-option {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.65rem;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s;
}

.event-option:hover {
  border-color: #93c5fd;
}

.event-option-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.85rem;
  line-height: 1.5;
}

.event-option-meta {
  color: #6b7280;
  font-size: 0.8rem;
}

.message {
  margin-bottom: 0.55rem;
  font-size: 0.85rem;
  color: #6b7280;
}

.message-error {
  color: #b42318;
}

.structured-kb-banner,
.structured-kb-ok {
  margin: 0.4rem 0 0.65rem;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #fde68a;
  background: #fffbeb;
}

.structured-kb-ok {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.structured-kb-title {
  margin: 0 0 0.3rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: #92400e;
}

.structured-kb-ok .structured-kb-title {
  color: #166534;
}

.structured-kb-body {
  margin: 0;
  font-size: 0.83rem;
  line-height: 1.5;
  color: #78350f;
}

.structured-kb-ok .structured-kb-body {
  color: #14532d;
}

.text-muted {
  color: #6b7280;
}

.structured-actions {
  margin-bottom: 0.65rem;
}

@media (max-width: 960px) {
  .form-row,
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
