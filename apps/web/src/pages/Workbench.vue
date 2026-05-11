<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiClient } from '../services/api';
import { useGenerationStore } from '../stores/generation';
import { useEditorStore } from '../stores/editor';
import KnowledgePanel from '../components/workbench/KnowledgePanel.vue';
import PromptConsole from '../components/workbench/PromptConsole.vue';
import GenerationPreview from '../components/workbench/GenerationPreview.vue';
import ConsistencyAlert from '../components/workbench/ConsistencyAlert.vue';

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

const promptConsoleRef = ref<InstanceType<typeof PromptConsole> | null>(null);

async function loadWorkspace() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const workspace = await apiClient.getWorkspace(projectId.value);
    projectName.value = workspace.project.name;
    chapterCount.value = workspace.knowledge.chapters.length;
    outlineReady.value = Boolean(workspace.knowledge.outlineSummary.trim());
    outlineSummary.value = workspace.knowledge.outlineSummary;
    activePersonaName.value =
      workspace.personas.find(
        (item: { id: string; name: string }) => item.id === workspace.settings.activePersonaId
      )?.name || '未指定';
    editorStore.setChapters(workspace.knowledge.chapters);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载工作台失败';
  } finally {
    loading.value = false;
  }
}

async function handleGenerate(task: {
  chapterNo: number;
  goal: string;
  pov: string;
  mustInclude: string[];
  avoid: string[];
  targetWords: number;
}) {
  errorMessage.value = '';
  await generationStore.generate(projectId.value, task);
  if (generationStore.isDone) {
    await loadWorkspace();
  }
}

async function handleAcceptDraft() {
  const chNo = generationStore.chapterNo;
  await generationStore.acceptDraft(projectId.value, chNo);
  editorStore.addOrUpdateChapter({
    chapterNo: chNo,
    title: `第${chNo}章`,
    content: generationStore.draftText,
    summary: '',
    updatedAt: new Date().toISOString(),
  });
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
    <div class="workbench-header">
      <h2 class="page-title">写作工作台</h2>
      <p class="page-subtitle">在当前项目下生成章节草稿，系统会自动加载该项目的设定与知识。</p>
    </div>

    <div v-if="loading" class="message">正在加载工作台...</div>
    <div v-if="errorMessage" class="message message-error">{{ errorMessage }}</div>

    <template v-if="!loading">
      <div class="workbench-layout">
        <div class="workbench-sidebar">
          <KnowledgePanel
            :project-name="projectName"
            :chapter-count="chapterCount"
            :outline-ready="outlineReady"
            :active-persona-name="activePersonaName"
            :outline-summary="outlineSummary"
          />
        </div>

        <div class="workbench-main">
          <PromptConsole
            ref="promptConsoleRef"
            :generating="generationStore.isStreaming"
            @generate="handleGenerate"
          />

          <ConsistencyAlert :notes="generationStore.consistencyNotes" />

          <GenerationPreview
            :draft-text="generationStore.draftText"
            :citations="generationStore.citations"
            :consistency-notes="generationStore.consistencyNotes"
            :is-streaming="generationStore.isStreaming"
            :is-done="generationStore.isDone"
            @accept="handleAcceptDraft"
            @regenerate="handleRegenerate"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.workbench-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}

.workbench-header {
  margin-bottom: 1rem;
}

.page-title {
  margin-bottom: 0.25rem;
}

.page-subtitle {
  color: #666;
  margin-bottom: 0.5rem;
}

.workbench-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 1rem;
  align-items: start;
}

.workbench-sidebar {
  position: sticky;
  top: 72px;
}

.workbench-main {
  min-width: 0;
}

.message {
  margin-bottom: 0.75rem;
  color: #6b7280;
}

.message-error {
  color: #b42318;
}

@media (max-width: 768px) {
  .workbench-layout {
    grid-template-columns: 1fr;
  }

  .workbench-sidebar {
    position: static;
  }
}
</style>
