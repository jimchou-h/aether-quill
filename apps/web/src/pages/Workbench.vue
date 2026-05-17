<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient, type PersonaItem } from '../services/api';
import { useGenerationStore } from '../stores/generation';
import { useEditorStore } from '../stores/editor';
import KnowledgePanel from '../components/workbench/KnowledgePanel.vue';
import PromptConsole from '../components/workbench/PromptConsole.vue';
import GenerationPreview from '../components/workbench/GenerationPreview.vue';
import ConsistencyAlert from '../components/workbench/ConsistencyAlert.vue';
import { presentErrorFromCaught, presentSuccess } from '../utils/pageFeedback';

/** 路由实例 */
const route = useRoute();
/** 项目ID */
const projectId = computed(() => String(route.params.id || ''));

/** 生成状态管理 */
const generationStore = useGenerationStore();
/** 编辑器状态管理 */
const editorStore = useEditorStore();

/** 是否正在加载 */
const loading = ref(false);
/** 错误消息 */
const errorMessage = ref('');

/** 项目名称 */
const projectName = ref('');
/** 当前人物设定名称 */
const activePersonaName = ref('');
/** 章节数量 */
const chapterCount = ref(0);
/** 大纲是否已配置 */
const outlineReady = ref(false);
/** 大纲摘要 */
const outlineSummary = ref('');

/** 人物名称列表 */
const personaNames = ref<string[]>([]);
const personas = ref<PersonaItem[]>([]);
/** 提示词控制台引用 */
const promptConsoleRef = ref<InstanceType<typeof PromptConsole> | null>(null);

function applyWorkspaceSnapshot(workspace: Awaited<ReturnType<typeof apiClient.getWorkspace>>) {
  projectName.value = workspace.project.name;
  chapterCount.value = workspace.knowledge.chapters.length;
  outlineReady.value = Boolean(workspace.knowledge.outlineSummary.trim());
  outlineSummary.value = workspace.knowledge.outlineSummary;
  activePersonaName.value =
    workspace.personas.find(
      (item: { id: string; name: string }) => item.id === workspace.settings.activePersonaId
    )?.name || '未指定';
  personas.value = workspace.personas.map((item) => ({
    ...item,
    relationEventIds: item.relationEventIds ?? [],
    appearedChapterNos: item.appearedChapterNos ?? [],
    lastAppearedChapterNo: item.lastAppearedChapterNo ?? null,
  }));
  personaNames.value = personas.value.map((item) => item.name);
  editorStore.setChapters(workspace.knowledge.chapters);
}

/**
 * 加载工作台数据（首屏展示 loading，会短暂卸载子组件）
 */
async function loadWorkspace() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    applyWorkspaceSnapshot(workspace);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载工作台失败');
  } finally {
    loading.value = false;
  }
}

/**
 * 静默同步工作台数据（不切换 loading，避免卸载 PromptConsole 导致生成参数丢失）
 */
async function refreshWorkspaceData() {
  errorMessage.value = '';
  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    applyWorkspaceSnapshot(workspace);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '刷新工作台数据失败');
  }
}

/**
 * 处理生成请求
 * @param {Object} task - 生成任务参数
 */
async function handleGenerate(task: {
  chapterNo: number;
  goal: string;
  pov: string;
  mustInclude: string[];
  avoid: string[];
  targetWords?: number;
  appearingCharacters: string[];
  selectedEventIds: string[];
}) {
  errorMessage.value = '';
  await generationStore.generate(projectId.value, task);
  if (generationStore.isDone) {
    presentSuccess(`第${task.chapterNo}章草稿生成完成`);
  }
}

/**
 * 处理接受草稿
 */
async function handleAcceptDraft() {
  const chNo = generationStore.chapterNo;
  await generationStore.acceptDraft(projectId.value, chNo);
  if (generationStore.errorMessage) {
    return;
  }
  editorStore.addOrUpdateChapter({
    chapterNo: chNo,
    title: `第${chNo}章`,
    content: generationStore.draftText,
    summary: '',
    updatedAt: new Date().toISOString(),
  });
  presentSuccess(`第${chNo}章草稿已落库`);
  promptConsoleRef.value?.resetForm();
  await loadWorkspace();
}

/**
 * 处理重新生成
 */
async function handleRegenerate() {
  generationStore.reset();
}

/**
 * 组件挂载时加载数据
 */
onMounted(() => {
  void loadWorkspace();
});
</script>

<template>
  <div class="workbench-page">
    <header class="workbench-header">
      <div class="workbench-header-copy">
        <p class="workbench-eyebrow">当前项目</p>
        <h2 class="page-title">写作工作台</h2>
        <p class="page-subtitle">配置本章生成参数，右侧实时查看草稿与引用证据。</p>
        <p class="page-hint page-hint-warn">
          未生成结构化信息则无法匹配知识库；请在左侧表单填写本章目标后点击「解析结构化信息」，再生成草稿。
        </p>
      </div>
      <div v-if="!loading" class="workbench-header-meta">
        <span class="meta-pill">{{ projectName || '未命名项目' }}</span>
        <span class="meta-pill">已录入 {{ chapterCount }} 章</span>
        <span class="meta-pill" :class="outlineReady ? 'meta-pill-ready' : 'meta-pill-missing'">
          {{ outlineReady ? '大纲已配置' : '大纲未配置' }}
        </span>
      </div>
    </header>

    <div v-if="loading" class="message message-loading">正在加载工作台...</div>
    <div v-if="errorMessage || generationStore.errorMessage" class="message message-error">
      {{ errorMessage || generationStore.errorMessage }}
    </div>

    <template v-if="!loading">
      <div class="workbench-shell">
        <aside class="context-column">
          <KnowledgePanel
            :project-name="projectName"
            :chapter-count="chapterCount"
            :outline-ready="outlineReady"
            :active-persona-name="activePersonaName"
            :outline-summary="outlineSummary"
          />
        </aside>

        <div class="workspace-columns">
          <section class="compose-column" aria-label="生成参数">
            <PromptConsole
              ref="promptConsoleRef"
              :generating="generationStore.isStreaming"
              :project-id="projectId"
              :persona-names="personaNames"
              :personas="personas"
              :knowledge-chapters="editorStore.chapters"
              @generate="handleGenerate"
              @structured-parsed="refreshWorkspaceData"
            />

            <ConsistencyAlert :notes="generationStore.consistencyNotes" />
          </section>

          <section class="result-column" aria-label="生成结果">
            <GenerationPreview
              :draft-text="generationStore.draftText"
              :citations="generationStore.citations"
              :consistency-notes="generationStore.consistencyNotes"
              :used-relation-events="generationStore.usedRelationEvents"
              :is-streaming="generationStore.isStreaming"
              :is-done="generationStore.isDone"
              :is-accepting="generationStore.isAccepting"
              @accept="handleAcceptDraft"
              @regenerate="handleRegenerate"
            />
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.workbench-page {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0.25rem 0 2rem;
}

.workbench-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
  margin-bottom: 1.75rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid #e5e7eb;
}

.workbench-header-copy {
  max-width: 42rem;
}

.workbench-eyebrow {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
}

.page-title {
  margin: 0 0 0.5rem;
  font-size: 1.75rem;
  line-height: 1.2;
}

.page-subtitle {
  margin: 0;
  color: #6b7280;
  font-size: 1rem;
  line-height: 1.6;
}

.page-hint {
  margin: 0.65rem 0 0;
  font-size: 0.88rem;
  line-height: 1.55;
}

.page-hint-warn {
  color: #92400e;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  background: #fffbeb;
  border: 1px solid #fde68a;
}

.workbench-header-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.6rem;
  max-width: 28rem;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.8rem;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  color: #374151;
  font-size: 0.85rem;
  line-height: 1.2;
}

.meta-pill-ready {
  background: #ecfdf3;
  border-color: #abefc6;
  color: #027a48;
}

.meta-pill-missing {
  background: #fffaeb;
  border-color: #fedf89;
  color: #b54708;
}

.workbench-shell {
  display: grid;
  grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}

.context-column {
  position: sticky;
  top: 1rem;
}

.workspace-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  gap: 1.5rem;
  align-items: start;
  min-width: 0;
}

.compose-column,
.result-column {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-width: 0;
}

.result-column {
  position: sticky;
  top: 1rem;
}

.message {
  margin-bottom: 1rem;
  color: #6b7280;
}

.message-loading {
  padding: 1rem 1.25rem;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
}

.message-error {
  color: #b42318;
  padding: 0.9rem 1rem;
  border-radius: 12px;
  background: #fef3f2;
  border: 1px solid #fecdca;
}

@media (max-width: 1280px) {
  .workspace-columns {
    grid-template-columns: 1fr;
  }

  .result-column {
    position: static;
  }
}

@media (max-width: 960px) {
  .workbench-header {
    flex-direction: column;
  }

  .workbench-header-meta {
    justify-content: flex-start;
    max-width: none;
  }

  .workbench-shell {
    grid-template-columns: 1fr;
  }

  .context-column {
    position: static;
  }
}
</style>
