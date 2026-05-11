<script setup lang="ts">
import { shallowRef } from 'vue';

defineProps<{
  generating: boolean;
}>();

const emit = defineEmits<{
  generate: [
    task: {
      chapterNo: number;
      goal: string;
      pov: string;
      mustInclude: string[];
      avoid: string[];
      targetWords: number;
    },
  ];
}>();

const chapterNo = shallowRef(1);
const goal = shallowRef('');
const pov = shallowRef('第三人称有限视角');
const mustIncludeText = shallowRef('');
const avoidText = shallowRef('');
const targetWords = shallowRef(3000);

function parseMultiLine(text: string): string[] {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function handleGenerate() {
  if (!goal.value.trim()) return;

  emit('generate', {
    chapterNo: Number(chapterNo.value),
    goal: goal.value.trim(),
    pov: pov.value.trim(),
    mustInclude: parseMultiLine(mustIncludeText.value),
    avoid: parseMultiLine(avoidText.value),
    targetWords: Number(targetWords.value),
  });
}

function resetForm() {
  chapterNo.value = 1;
  goal.value = '';
  pov.value = '第三人称有限视角';
  mustIncludeText.value = '';
  avoidText.value = '';
  targetWords.value = 3000;
}

defineExpose({ resetForm });
</script>

<template>
  <section class="prompt-console">
    <h3 class="panel-title">生成参数</h3>

    <div class="form-row">
      <label class="field-label">
        章节号
        <input v-model.number="chapterNo" type="number" min="1" class="field-input" />
      </label>
      <label class="field-label">
        目标字数
        <input
          v-model.number="targetWords"
          type="number"
          min="200"
          step="100"
          class="field-input"
        />
      </label>
    </div>

    <label class="field-label">
      本章目标
      <textarea
        v-model="goal"
        class="field-textarea"
        placeholder="例如：主角在旧港口与导师对峙并拿到怀表线索"
        rows="3"
      />
    </label>

    <label class="field-label">
      叙事视角（POV）
      <input v-model="pov" class="field-input" type="text" placeholder="例如：女主第一人称" />
    </label>

    <div class="form-grid">
      <label class="field-label">
        必须包含（每行一条）
        <textarea
          v-model="mustIncludeText"
          class="field-textarea"
          placeholder="旧港口&#10;怀表线索&#10;雨夜追逐"
          rows="4"
        />
      </label>
      <label class="field-label">
        禁止内容（每行一条）
        <textarea
          v-model="avoidText"
          class="field-textarea"
          placeholder="直接揭露终极反派&#10;角色性格突变"
          rows="4"
        />
      </label>
    </div>

    <button class="primary-button" :disabled="generating || !goal.trim()" @click="handleGenerate">
      {{ generating ? '生成中...' : '生成章节草稿' }}
    </button>
  </section>
</template>

<style scoped>
.prompt-console {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fff;
}

.panel-title {
  margin-bottom: 0.7rem;
  font-size: 1rem;
}

.form-row {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
  font-weight: 600;
  font-size: 0.9rem;
}

.field-input,
.field-textarea {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  font-size: 0.95rem;
  font-family: inherit;
}

.field-textarea {
  min-height: 80px;
  resize: vertical;
}

.primary-button {
  border: none;
  background: #1d4ed8;
  color: #fff;
  border-radius: 6px;
  padding: 0.52rem 0.9rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.primary-button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
</style>
