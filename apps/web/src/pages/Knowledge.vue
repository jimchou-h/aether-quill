<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient, type IndexJob, type KnowledgeItem } from '../services/api';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const knowledge = ref<KnowledgeItem | null>(null);
const loading = shallowRef(false);
const savingOutline = shallowRef(false);
const savingChapter = shallowRef(false);
const indexing = shallowRef(false);
const message = shallowRef('');
const errorMessage = shallowRef('');

const outlineSummary = shallowRef('');
const chapterNo = shallowRef(1);
const chapterTitle = shallowRef('');
const chapterContent = shallowRef('');
const latestJob = ref<IndexJob | null>(null);

async function loadKnowledge() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await apiClient.getKnowledge(projectId.value);
    knowledge.value = result;
    outlineSummary.value = result.outlineSummary;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载知识库失败';
  } finally {
    loading.value = false;
  }
}

async function handleSaveOutline() {
  savingOutline.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const result = await apiClient.updateOutline(projectId.value, {
      outlineSummary: outlineSummary.value,
    });
    knowledge.value = result;
    message.value = '大纲已保存';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存大纲失败';
  } finally {
    savingOutline.value = false;
  }
}

async function handleSaveChapter() {
  if (!chapterTitle.value.trim() || !chapterContent.value.trim()) {
    errorMessage.value = '章节标题和内容不能为空';
    return;
  }

  savingChapter.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.upsertChapter(projectId.value, {
      chapterNo: Number(chapterNo.value),
      title: chapterTitle.value.trim(),
      content: chapterContent.value,
    });

    await loadKnowledge();
    message.value = `第 ${chapterNo.value} 章已保存`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存章节失败';
  } finally {
    savingChapter.value = false;
  }
}

function updateJobStatus(job: IndexJob) {
  latestJob.value = job;
  indexing.value = false;
}

async function handleReindex(mode: 'full' | 'incremental') {
  indexing.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const job = await apiClient.createReindexJob(projectId.value, { mode });
    message.value = mode === 'full' ? '已启动全量重建' : '已启动增量重建';
    updateJobStatus(job);
    await loadKnowledge();
  } catch (error) {
    indexing.value = false;
    errorMessage.value = error instanceof Error ? error.message : '启动索引任务失败';
  }
}

onMounted(() => {
  void loadKnowledge();
});
</script>

<template>
  <div class="knowledge-page">
    <h2 class="page-title">知识库</h2>
    <p class="page-subtitle">维护大纲与章节资料，确保每本小说单独建立索引。</p>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>
    <p v-if="loading" class="message">正在加载知识库...</p>

    <template v-if="knowledge">
      <section class="panel">
        <h3 class="panel-title">大纲总结</h3>
        <textarea
          v-model="outlineSummary"
          class="field-textarea"
          placeholder="填写总纲、卷纲与关键转折，建议 300~1000 字"
        />
        <button class="primary-button" :disabled="savingOutline" @click="handleSaveOutline">
          {{ savingOutline ? '保存中...' : '保存大纲' }}
        </button>
      </section>

      <section class="panel">
        <h3 class="panel-title">章节录入/更新</h3>
        <div class="form-grid">
          <label class="field-label">
            章节号
            <input v-model.number="chapterNo" class="field-input" type="number" min="1" />
          </label>
          <label class="field-label">
            章节标题
            <input
              v-model="chapterTitle"
              class="field-input"
              type="text"
              placeholder="第 89 章：旧港口回响"
            />
          </label>
        </div>
        <label class="field-label">
          章节内容
          <textarea
            v-model="chapterContent"
            class="field-textarea field-textarea-large"
            placeholder="粘贴章节正文，系统会自动生成摘要用于检索"
          />
        </label>
        <button class="primary-button" :disabled="savingChapter" @click="handleSaveChapter">
          {{ savingChapter ? '保存中...' : '保存章节' }}
        </button>
      </section>

      <section class="panel">
        <h3 class="panel-title">章节摘要索引</h3>
        <div class="actions-row">
          <button class="primary-button" :disabled="indexing" @click="handleReindex('incremental')">
            {{ indexing ? '处理中...' : '增量重建' }}
          </button>
          <button class="secondary-button" :disabled="indexing" @click="handleReindex('full')">
            {{ indexing ? '处理中...' : '全量重建' }}
          </button>
        </div>
        <p class="index-meta">
          当前版本：{{ knowledge.indexVersion }}， 上次索引时间：{{
            knowledge.lastIndexedAt || '未建立'
          }}
        </p>
        <p v-if="latestJob" class="index-meta">
          最近任务：{{ latestJob.status }}（{{ latestJob.processedChapters }}/{{
            latestJob.totalChapters
          }}）
        </p>
      </section>

      <section class="panel">
        <h3 class="panel-title">已录入章节（{{ knowledge.chapters.length }}）</h3>
        <div class="chapter-list">
          <article
            v-for="chapter in knowledge.chapters"
            :key="chapter.chapterNo"
            class="chapter-card"
          >
            <h4 class="chapter-title">第 {{ chapter.chapterNo }} 章 · {{ chapter.title }}</h4>
            <p class="chapter-summary">{{ chapter.summary }}</p>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.knowledge-page {
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

.form-grid {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 0.75rem;
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

.field-textarea-large {
  min-height: 180px;
}

.actions-row {
  display: flex;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.5rem 0.85rem;
  cursor: pointer;
}

.primary-button {
  border: none;
  background: #1d4ed8;
  color: #fff;
}

.secondary-button {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #1f2937;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.chapter-list {
  display: grid;
  gap: 0.65rem;
}

.chapter-card {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.65rem 0.75rem;
  background: #fafafa;
}

.chapter-title {
  margin-bottom: 0.35rem;
}

.chapter-summary {
  color: #4b5563;
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

.index-meta {
  color: #4b5563;
}
</style>
