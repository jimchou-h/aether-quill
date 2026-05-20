<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  apiClient,
  type PersonaItem,
  type PreviewRetrievalResult,
} from '../services/api';
import RetrievalPreviewDialog from '../components/workbench/RetrievalPreviewDialog.vue';
import { useGenerationStore } from '../stores/generation';
import { useEditorStore } from '../stores/editor';
import KnowledgePanel from '../components/workbench/KnowledgePanel.vue';
import PromptConsole from '../components/workbench/PromptConsole.vue';
import GenerationPreview from '../components/workbench/GenerationPreview.vue';
import ConsistencyAlert from '../components/workbench/ConsistencyAlert.vue';
import { presentErrorFromCaught, presentSuccess } from '../utils/pageFeedback';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const generationStore = useGenerationStore();
const editorStore = useEditorStore();

const loading = ref(false);
const errorMessage = ref('');

const projectName = ref('');
const activePersonaName = ref('');
const chapterCount = ref(0);
const outlineReady = ref(false);
const outlineSummary = ref('');

const personaNames = ref<string[]>([]);
const personas = ref<PersonaItem[]>([]);
const promptConsoleRef = ref<InstanceType<typeof PromptConsole> | null>(null);

const previewVisible = ref(false);
const previewLoading = ref(false);
const previewResult = ref<PreviewRetrievalResult | null>(null);
const previewError = ref('');
const pendingGenerateTask = ref<{
  chapterNo: number;
  goal: string;
  pov: string;
  mustInclude: string[];
  avoid: string[];
  targetWords?: number;
  appearingCharacters: string[];
  selectedEventIds: string[];
} | null>(null);

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

async function refreshWorkspaceData() {
  errorMessage.value = '';
  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    applyWorkspaceSnapshot(workspace);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '刷新工作台数据失败');
  }
}

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
  pendingGenerateTask.value = task;
  previewVisible.value = true;
  previewLoading.value = true;
  previewResult.value = null;
  previewError.value = '';

  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    const docRes = await apiClient.documents.list(projectId.value);
    const docList = apiClient.unwrapPayload(docRes) as Array<{
      id: string;
      title: string;
      content: string;
      docType?: string;
    }>;

    const activePersona =
      workspace.personas.find((item) => item.id === workspace.settings.activePersonaId) ||
      workspace.personas.find((item) => item.status === 'published') ||
      null;

    previewResult.value = await apiClient.previewRetrieval(projectId.value, {
      prompt: task.goal,
      chapterNo: task.chapterNo,
      useStructuredKb: true,
      projectCtx: {
        outlineSummary: workspace.knowledge.outlineSummary,
        personaProfile: activePersona
          ? `${activePersona.name}\n人物设定：${activePersona.profile}\n当前状态：${activePersona.state}`
          : '未配置人物设定',
        chapters: workspace.knowledge.chapters.map((ch) => ({
          chapterNo: ch.chapterNo,
          title: ch.title,
          summary: ch.summary || ch.content.slice(0, 160),
          structuredMatchingText: ch.structuredInfo?.matchingText,
        })),
        knowledgeDocuments: docList.map((doc) => ({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          docType: doc.docType ?? 'other',
        })),
        chapterSummaryPromptCount: workspace.settings.chapterSummaryPromptCount,
        chapterSummaryMemoryCount:
          (workspace.settings as { chapterSummaryMemoryCount?: number }).chapterSummaryMemoryCount ??
          3,
      },
      extraContext: {
        task: {
          chapterNo: task.chapterNo,
          goal: task.goal,
          pov: task.pov,
          mustInclude: task.mustInclude,
          avoid: task.avoid,
        },
      },
    });
  } catch (error) {
    previewError.value = presentErrorFromCaught(error, '检索预览失败');
  } finally {
    previewLoading.value = false;
  }
}

async function confirmPreviewAndGenerate() {
  previewVisible.value = false;
  const task = pendingGenerateTask.value;
  if (!task) {
    return;
  }
  await generationStore.generate(projectId.value, task);
  if (generationStore.isDone) {
    presentSuccess(`第${task.chapterNo}章草稿生成完成`);
  }
}

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

async function handleRegenerate() {
  generationStore.reset();
}

onMounted(() => {
  void loadWorkspace();
});
</script>

<template>
  <div class="workbench-page">
    <header class="workbench-header">
      <div class="workbench-header-copy">
        <h2 class="page-title">写作工作台</h2>
        <p class="page-subtitle">配置本章目标与约束，实时预览 AI 生成的草稿与引用。</p>
      </div>
      <div v-if="!loading" class="workbench-header-meta">
        <span class="meta-pill">{{ projectName || '未命名项目' }}</span>
        <span class="meta-pill">已录入 {{ chapterCount }} 章</span>
        <span class="meta-pill" :class="outlineReady ? 'meta-pill-ready' : 'meta-pill-missing'">
          {{ outlineReady ? '大纲已配置' : '大纲未配置' }}
        </span>
      </div>
    </header>

    <div v-if="loading" class="loading-state">
      <div class="loading-card">
        <div class="loading-spinner"></div>
        <p>正在加载工作台...</p>
      </div>
    </div>
    <div v-if="errorMessage || generationStore.errorMessage" class="error-banner">
      {{ errorMessage || generationStore.errorMessage }}
    </div>

    <template v-if="!loading">
      <div class="workbench-shell">
        <section class="compose-column" aria-label="生成参数">
          <KnowledgePanel
            :project-name="projectName"
            :chapter-count="chapterCount"
            :outline-ready="outlineReady"
            :active-persona-name="activePersonaName"
            :outline-summary="outlineSummary"
          />

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
            :generation-phase="generationStore.generationPhase"
            :phase-panel-collapsed="generationStore.phasePanelCollapsed"
            @accept="handleAcceptDraft"
            @regenerate="handleRegenerate"
          />
        </section>
      </div>
    </template>

    <RetrievalPreviewDialog
      :visible="previewVisible"
      :loading="previewLoading"
      :result="previewResult"
      :error-message="previewError"
      @close="previewVisible = false"
      @confirm="confirmPreviewAndGenerate"
    />
  </div>
</template>

<style scoped>
.workbench-page {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0 0 2rem;
}

.workbench-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.workbench-header-copy {
  max-width: 42rem;
}

.page-title {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
  line-height: 1.3;
  color: #111827;
}

.page-subtitle {
  margin: 0;
  color: #6b7280;
  font-size: 0.92rem;
  line-height: 1.5;
}

.workbench-header-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  max-width: 28rem;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  color: #374151;
  font-size: 0.82rem;
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
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  gap: 1.5rem;
  align-items: start;
}

.compose-column,
.result-column {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.result-column {
  position: sticky;
  top: 1rem;
}

.loading-state {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}

.loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 3rem;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  color: #6b7280;
  font-size: 0.95rem;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2.5px solid #e5e7eb;
  border-top-color: #1d4ed8;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-banner {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  background: #fef3f2;
  border: 1px solid #fecdca;
  color: #b42318;
  font-size: 0.9rem;
  line-height: 1.5;
}

@media (max-width: 1280px) {
  .workbench-shell {
    grid-template-columns: 1fr;
  }

  .result-column {
    position: static;
  }
}

@media (max-width: 960px) {
  .workbench-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .workbench-header-meta {
    justify-content: flex-start;
    max-width: none;
  }
}
</style>
