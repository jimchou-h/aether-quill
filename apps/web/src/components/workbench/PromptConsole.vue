<script setup lang="ts">
import { computed, onMounted, ref, watch, withDefaults } from 'vue';
import { apiClient, type ChapterItem, type RelationEventItem } from '../../services/api';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';

const props = withDefaults(
  defineProps<{
    generating: boolean;
    projectId: string;
    personaNames: string[];
    knowledgeChapters: ChapterItem[];
  }>(),
  {
    knowledgeChapters: () => [],
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

const filteredEvents = computed(() => {
  if (appearingCharacters.value.length === 0) {
    return relationEvents.value;
  }

  const selected = new Set(appearingCharacters.value);
  return relationEvents.value.filter((event) => event.actors.some((actor) => selected.has(actor)));
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
    return;
  }
  appearingCharacters.value = [...appearingCharacters.value, name];
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
    relationEvents.value = await apiClient.getRelationEvents(props.projectId, {
      appearingCharacters:
        appearingCharacters.value.length > 0 ? appearingCharacters.value : undefined,
    });
    selectedEventIds.value = selectedEventIds.value.filter((eventId) =>
      relationEvents.value.some((event) => event.id === eventId)
    );
  } catch (error) {
    eventError.value = error instanceof Error ? error.message : '加载关系事件失败';
  } finally {
    loadingEvents.value = false;
  }
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
  chapterNo.value = 1;
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

onMounted(() => {
  void loadRelationEvents();
});

defineExpose({ resetForm });
</script>

<template>
  <section class="prompt-console">
    <div class="panel-heading">
      <h3 class="panel-title">生成参数</h3>
      <p class="panel-description">填写本章目标、出场角色与约束条件后发起生成。</p>
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

    <section class="relation-section bordered-section">
      <h4 class="section-title">出场角色</h4>
      <div class="chip-list">
        <button
          v-for="name in availableCharacters"
          :key="name"
          type="button"
          class="chip-button"
          :class="{ 'chip-button-active': appearingCharacters.includes(name) }"
          @click="toggleCharacter(name)"
        >
          {{ name }}
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

    <section class="relation-section bordered-section">
      <div class="section-header">
        <h4 class="section-title">关系事件（手动勾选）</h4>
        <span class="section-meta">
          已选 {{ selectedEventIds.length }} 条 / 约 {{ selectedPreviewLength }} 字
        </span>
      </div>
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

    <div class="form-section">
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

      <button
        class="primary-button generate-button"
        :disabled="generating || !goal.trim()"
        @click="handleGenerate"
      >
        {{ generating ? '生成中...' : '生成章节草稿' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.prompt-console {
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 1.35rem;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
}

.panel-heading {
  margin-bottom: 1.25rem;
}

.panel-title {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
}

.panel-description {
  margin: 0;
  color: #6b7280;
  font-size: 0.9rem;
  line-height: 1.5;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 1.25rem;
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
  gap: 0.45rem;
  margin-bottom: 0.9rem;
  font-weight: 600;
  font-size: 0.92rem;
}

.unlimited-toggle {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 500;
  font-size: 0.88rem;
  color: #4b5563;
}

.field-input,
.field-textarea {
  border: 1px solid #d1d5db;
  border-radius: 10px;
  padding: 0.7rem 0.85rem;
  font-size: 0.95rem;
  font-family: inherit;
  background: #fff;
}

.field-input:focus,
.field-textarea:focus {
  outline: none;
  border-color: #93c5fd;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.field-textarea {
  min-height: 112px;
  resize: vertical;
  line-height: 1.6;
}

.bordered-section {
  margin-bottom: 1.25rem;
  padding: 1rem;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #edf2f7;
}

.relation-section {
  margin-bottom: 0;
}

.section-title {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.75rem;
}

.section-meta {
  font-size: 0.82rem;
  color: #6b7280;
}

.chip-list,
.custom-character-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.custom-character-row {
  margin-top: 0.75rem;
}

.chip-button,
.secondary-button,
.primary-button {
  border-radius: 999px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  font-size: 0.88rem;
}

.chip-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
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

.primary-button {
  border: none;
  background: #1d4ed8;
  color: #fff;
}

.generate-button {
  align-self: flex-start;
  margin-top: 0.5rem;
  padding: 0.72rem 1.2rem;
  border-radius: 10px;
  font-size: 0.95rem;
}

.primary-button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.event-checklist {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  max-height: 320px;
  overflow: auto;
  padding-right: 0.15rem;
}

.event-option {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 0.75rem;
  background: #fff;
}

.event-option-text {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.88rem;
  line-height: 1.5;
}

.event-option-meta {
  color: #6b7280;
}

.message {
  margin-bottom: 0.65rem;
  font-size: 0.88rem;
}

.message-error {
  color: #b42318;
}

.structured-kb-banner,
.structured-kb-ok {
  margin: 0.5rem 0 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid #fde68a;
  background: #fffbeb;
}

.structured-kb-ok {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.structured-kb-title {
  margin: 0 0 0.35rem;
  font-size: 0.82rem;
  font-weight: 700;
  color: #92400e;
}

.structured-kb-ok .structured-kb-title {
  color: #166534;
}

.structured-kb-body {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.55;
  color: #78350f;
}

.structured-kb-ok .structured-kb-body {
  color: #14532d;
}

.text-muted {
  color: #6b7280;
}

.structured-actions {
  margin-bottom: 0.75rem;
}

@media (max-width: 960px) {
  .form-row,
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
