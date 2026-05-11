<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient, type WriteResult } from '../services/api';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const loading = shallowRef(false);
const generating = shallowRef(false);
const errorMessage = shallowRef('');
const message = shallowRef('');

const projectName = shallowRef('');
const activePersonaName = shallowRef('');
const chapterCount = shallowRef(0);
const outlineReady = shallowRef(false);

const chapterNo = shallowRef(1);
const goal = shallowRef('');
const pov = shallowRef('第三人称有限视角');
const mustIncludeText = shallowRef('');
const avoidText = shallowRef('');
const targetWords = shallowRef(3000);

const result = ref<WriteResult | null>(null);

async function loadWorkspace() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    projectName.value = workspace.project.name;
    chapterCount.value = workspace.knowledge.chapters.length;
    outlineReady.value = Boolean(workspace.knowledge.outlineSummary.trim());
    activePersonaName.value =
      workspace.personas.find(
        (item: { id: string; name: string }) => item.id === workspace.settings.activePersonaId
      )?.name || '未指定';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载工作台失败';
  } finally {
    loading.value = false;
  }
}

function parseMultiLine(text: string) {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function handleGenerate() {
  if (!goal.value.trim()) {
    errorMessage.value = '请填写本章目标';
    return;
  }

  generating.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    result.value = await apiClient.writeChapter(projectId.value, {
      chapterNo: Number(chapterNo.value),
      goal: goal.value.trim(),
      pov: pov.value.trim(),
      mustInclude: parseMultiLine(mustIncludeText.value),
      avoid: parseMultiLine(avoidText.value),
      targetWords: Number(targetWords.value),
    });
    await loadWorkspace();
    message.value = '草稿生成完成，并已自动更新章节/设定摘要';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '生成失败';
  } finally {
    generating.value = false;
  }
}

onMounted(() => {
  void loadWorkspace();
});
</script>

<template>
  <div class="workbench-page">
    <h2 class="page-title">写作工作台</h2>
    <p class="page-subtitle">在当前项目下生成章节草稿，系统会自动加载该项目的设定与知识。</p>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>
    <p v-if="loading" class="message">正在加载工作台...</p>

    <section class="panel">
      <h3 class="panel-title">项目上下文</h3>
      <p class="meta-text">项目：{{ projectName || '-' }}</p>
      <p class="meta-text">已录入章节：{{ chapterCount }}</p>
      <p class="meta-text">大纲状态：{{ outlineReady ? '已配置' : '未配置' }}</p>
      <p class="meta-text">当前人物设定：{{ activePersonaName }}</p>
    </section>

    <section class="panel">
      <h3 class="panel-title">生成参数</h3>
      <div class="form-grid">
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
          />
        </label>
        <label class="field-label">
          禁止内容（每行一条）
          <textarea
            v-model="avoidText"
            class="field-textarea"
            placeholder="直接揭露终极反派&#10;角色性格突变"
          />
        </label>
      </div>

      <button class="primary-button" :disabled="generating" @click="handleGenerate">
        {{ generating ? '生成中...' : '生成章节草稿' }}
      </button>
    </section>

    <section v-if="result" class="panel">
      <h3 class="panel-title">生成结果</h3>
      <p class="meta-text">{{ result.reasoningBrief }}</p>
      <p class="meta-text">自动回写：{{ result.autoUpdates.updateLine }}</p>
      <pre class="draft-output">{{ result.draftText }}</pre>

      <h4 class="sub-title">引用证据</h4>
      <ul class="list">
        <li
          v-for="citation in result.citations"
          :key="`${citation.sourceType}-${citation.sourceId}`"
        >
          [{{ citation.sourceType }}] {{ citation.sourceId }}：{{ citation.snippet }}
        </li>
      </ul>

      <h4 class="sub-title">一致性提示</h4>
      <ul class="list">
        <li v-for="(note, index) in result.consistencyNotes" :key="`${note.level}-${index}`">
          {{ note.level }}：{{ note.message }}
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.workbench-page {
  max-width: 980px;
  margin: 0 auto;
  padding: 1rem;
}

.page-title {
  margin-bottom: 0.25rem;
}

.page-subtitle {
  color: #666;
  margin-bottom: 1rem;
}

.panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fff;
}

.panel-title {
  margin-bottom: 0.7rem;
}

.sub-title {
  margin-top: 0.85rem;
  margin-bottom: 0.35rem;
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
}

.field-input,
.field-textarea {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  font-size: 0.95rem;
}

.field-textarea {
  min-height: 100px;
  resize: vertical;
}

.primary-button {
  border: none;
  background: #1d4ed8;
  color: #fff;
  border-radius: 6px;
  padding: 0.52rem 0.9rem;
  cursor: pointer;
}

.primary-button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.draft-output {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.8rem;
  background: #f8fafc;
  white-space: pre-wrap;
  line-height: 1.7;
}

.meta-text {
  color: #4b5563;
  margin-bottom: 0.25rem;
}

.list {
  padding-left: 1.2rem;
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
</style>
