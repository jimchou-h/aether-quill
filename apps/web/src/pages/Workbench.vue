<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  apiClient,
  type PersonaItem,
  type PreviewRetrievalResult,
  type WriteContextReadiness,
} from '../services/api';
import RetrievalPreviewDialog from '../components/workbench/RetrievalPreviewDialog.vue';
import { useGenerationStore } from '../stores/generation';
import { useEditorStore } from '../stores/editor';
import KnowledgePanel from '../components/workbench/KnowledgePanel.vue';
import PromptConsole from '../components/workbench/PromptConsole.vue';
import WorkbenchStepper from '../components/workbench/WorkbenchStepper.vue';
import type { WorkbenchStepItem } from '../components/workbench/WorkbenchStepper.vue';
import WorkbenchOutputPanel from '../components/workbench/WorkbenchOutputPanel.vue';
import { presentErrorFromCaught, presentInfo, presentSuccess } from '../utils/pageFeedback';
import {
  resolveEffectiveStructuredMatchingText,
  resolveWorkbenchStructuredInfo,
} from '../utils/structured-matching';
import type { ChapterStructuredInfo, StructuredInfoParseResult } from '../services/api';
import '../components/workbench/workbench-tokens.css';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));
const workbenchStructuredByChapter = ref<Record<string, ChapterStructuredInfo>>({});

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
type WriteTaskPayload = {
  chapterNo: number;
  goal: string;
  pov: string;
  mustInclude: string[];
  avoid: string[];
  targetWords?: number;
  appearingCharacters: string[];
  selectedEventIds: string[];
};

const pendingGenerateTask = ref<WriteTaskPayload | null>(null);
const lastWriteTask = ref<WriteTaskPayload | null>(null);
const previewIntent = ref<'outline' | 'draft'>('outline');
const outputTab = ref<'outline' | 'draft' | 'evidence'>('outline');

const readinessVisible = ref(false);
const readinessLoading = ref(false);
const readinessBatchSummarizing = ref(false);
const readinessSnapshot = ref<WriteContextReadiness | null>(null);
const readinessTask = ref<WriteTaskPayload | null>(null);

const evidenceCount = computed(
  () =>
    generationStore.citations.length +
    generationStore.consistencyNotes.length +
    generationStore.usedRelationEvents.length
);

const workflowSteps = computed<WorkbenchStepItem[]>(() => {
  const hasOutline = generationStore.hasOutline;
  const outlineDone = generationStore.outlineConfirmed;
  const draftActive =
    generationStore.isStreaming || generationStore.isDone || Boolean(generationStore.draftText);

  let requirements: WorkbenchStepItem['status'] = 'active';
  let outline: WorkbenchStepItem['status'] = 'locked';
  let draft: WorkbenchStepItem['status'] = 'locked';

  if (generationStore.isOutlineStreaming) {
    requirements = 'done';
    outline = 'active';
  } else if (hasOutline && !outlineDone) {
    requirements = 'done';
    outline = 'active';
  } else if (outlineDone) {
    requirements = 'done';
    outline = 'done';
    draft = draftActive ? 'active' : 'pending';
  } else if (hasOutline) {
    requirements = 'done';
    outline = 'active';
  }

  if (generationStore.isDone) {
    draft = 'done';
  }

  return [
    {
      id: 'requirements',
      label: '写作要求',
      hint: '章节号、目标与约束',
      status: requirements,
    },
    {
      id: 'outline',
      label: '章节大纲',
      hint: '生成并确认结构',
      status: outline,
    },
    {
      id: 'draft',
      label: '正文草稿',
      hint: '流式生成与落库',
      status: draft,
    },
  ];
});

watch(
  () => generationStore.isOutlineStreaming,
  (streaming) => {
    if (streaming) {
      outputTab.value = 'outline';
    }
  }
);

watch(
  () => generationStore.isStreaming,
  (streaming) => {
    if (streaming) {
      outputTab.value = 'draft';
    }
  }
);

watch(
  () => generationStore.isDone,
  (done) => {
    if (done && evidenceCount.value > 0) {
      outputTab.value = 'draft';
    }
  }
);

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
  workbenchStructuredByChapter.value = workspace.knowledge.workbenchStructuredByChapter ?? {};
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

function onStructuredParsed(result: StructuredInfoParseResult) {
  const ch = result.chapter;
  const info = result.structuredInfo ?? ch.structuredInfo;
  if (info) {
    const existing = editorStore.chapters.find((item) => item.chapterNo === ch.chapterNo);
    if (existing) {
      editorStore.addOrUpdateChapter({
        ...existing,
        structuredInfo: info,
      });
    } else {
      workbenchStructuredByChapter.value = {
        ...workbenchStructuredByChapter.value,
        [String(ch.chapterNo)]: info,
      };
    }
  }
  void refreshWorkspaceData();
}

function buildPreviewProjectCtx(
  workspace: Awaited<ReturnType<typeof apiClient.getWorkspace>>,
  docList: Array<{ id: string; title: string; content: string; docType?: string }>
) {
  const activePersona =
    workspace.personas.find((item) => item.id === workspace.settings.activePersonaId) ||
    workspace.personas.find((item) => item.status === 'published') ||
    null;

  const tailK = Math.max(
    workspace.settings.priorChapterTailChars ?? 800,
    workspace.settings.contextExcerptMaxChars ?? 400
  );

  const chapterCtxByNo = new Map<
    number,
    {
      chapterNo: number;
      title: string;
      summary: string;
      content: string;
      contentTail: string;
      structuredMatchingText?: string;
    }
  >();

  for (const ch of workspace.knowledge.chapters) {
    const structured = resolveWorkbenchStructuredInfo(
      ch.chapterNo,
      workspace.knowledge.chapters,
      workspace.knowledge.workbenchStructuredByChapter
    );
    chapterCtxByNo.set(ch.chapterNo, {
      chapterNo: ch.chapterNo,
      title: ch.title,
      summary: ch.summary || '',
      content: ch.content,
      contentTail:
        ch.content.trim().length <= tailK
          ? ch.content.trim()
          : ch.content.trim().slice(-tailK),
      structuredMatchingText: resolveEffectiveStructuredMatchingText(structured),
    });
  }

  for (const [key, draft] of Object.entries(workspace.knowledge.workbenchStructuredByChapter ?? {})) {
    const chapterNo = Number(key);
    if (!Number.isFinite(chapterNo) || chapterNo <= 0 || chapterCtxByNo.has(chapterNo)) {
      continue;
    }
    chapterCtxByNo.set(chapterNo, {
      chapterNo,
      title: `第${chapterNo}章`,
      summary: '',
      content: '',
      contentTail: '',
      structuredMatchingText: resolveEffectiveStructuredMatchingText(draft),
    });
  }

  return {
    outlineSummary: workspace.knowledge.outlineSummary,
    personaProfile: activePersona
      ? `${activePersona.name}\n人物设定：${activePersona.profile}\n当前状态：${activePersona.state}`
      : '未配置人物设定',
    chapters: [...chapterCtxByNo.values()].sort((a, b) => a.chapterNo - b.chapterNo),
    knowledgeDocuments: docList.map((doc) => ({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      docType: doc.docType ?? 'other',
    })),
    chapterSummaryPromptCount: workspace.settings.chapterSummaryPromptCount,
    chapterSummaryMemoryCount: workspace.settings.chapterSummaryMemoryCount ?? 3,
    priorChapterTailChars: workspace.settings.priorChapterTailChars ?? 800,
    contextExcerptMaxChars: workspace.settings.contextExcerptMaxChars ?? 400,
  };
}

async function openRetrievalPreview(task: WriteTaskPayload, intent: 'outline' | 'draft') {
  errorMessage.value = '';
  pendingGenerateTask.value = task;
  previewIntent.value = intent;
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

    previewResult.value = await apiClient.previewRetrieval(projectId.value, {
      prompt: task.goal,
      chapterNo: task.chapterNo,
      useStructuredKb: true,
      projectCtx: buildPreviewProjectCtx(workspace, docList),
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

async function proceedAfterReadiness(task: WriteTaskPayload, intent: 'outline' | 'draft') {
  readinessVisible.value = false;
  readinessSnapshot.value = null;
  readinessTask.value = null;
  await openRetrievalPreview(task, intent);
}

async function handleGenerateOutline(task: WriteTaskPayload) {
  lastWriteTask.value = task;
  if (task.chapterNo <= 1) {
    await openRetrievalPreview(task, 'outline');
    return;
  }

  readinessLoading.value = true;
  try {
    const readiness = await apiClient.getWriteContextReadiness(projectId.value, task.chapterNo);
    if (readiness.priorChaptersMissingSummary.length > 0) {
      readinessSnapshot.value = readiness;
      readinessTask.value = task;
      readinessVisible.value = true;
      return;
    }
  } catch (error) {
    presentInfo(presentErrorFromCaught(error, '上下文就绪检查失败，将直接继续生成'));
  } finally {
    readinessLoading.value = false;
  }

  await openRetrievalPreview(task, 'outline');
}

async function handleReadinessContinue() {
  const task = readinessTask.value;
  if (!task) {
    return;
  }
  await proceedAfterReadiness(task, 'outline');
}

async function handleReadinessBatchSummarize() {
  const task = readinessTask.value;
  const snapshot = readinessSnapshot.value;
  if (!task || !snapshot) {
    return;
  }

  readinessBatchSummarizing.value = true;
  errorMessage.value = '';
  try {
    await apiClient.createBatchSummaryJob(projectId.value, {
      chapterNos: snapshot.priorChaptersMissingSummary,
    });
    presentSuccess(`已提交第 ${snapshot.priorChaptersMissingSummary.join('、')} 章摘要任务`);
    await refreshWorkspaceData();
    await proceedAfterReadiness(task, 'outline');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '批量补摘要失败');
  } finally {
    readinessBatchSummarizing.value = false;
  }
}

async function confirmPreviewAndContinue() {
  previewVisible.value = false;
  const task = pendingGenerateTask.value;
  if (!task) {
    return;
  }

  if (previewIntent.value === 'outline') {
    outputTab.value = 'outline';
    await generationStore.generateOutline(projectId.value, task);
    if (generationStore.hasOutline) {
      presentSuccess(`第${task.chapterNo}章大纲已生成，请确认后继续`);
    }
    return;
  }

  if (!generationStore.outlineConfirmed) {
    presentInfo('请先确认章节大纲后再生成正文');
    outputTab.value = 'outline';
    return;
  }

  outputTab.value = 'draft';
  await generationStore.generate(projectId.value, task);
  if (generationStore.isDone) {
    presentSuccess(`第${task.chapterNo}章草稿生成完成`);
  }
}

function handleConfirmOutline() {
  generationStore.confirmOutline();
  if (generationStore.outlineConfirmed) {
    presentSuccess('大纲已确认，可切换到「正文草稿」或点击生成正文');
  }
}

function handleRegenerateOutline() {
  const task = pendingGenerateTask.value ?? lastWriteTask.value;
  if (!task?.goal.trim()) {
    presentInfo('请先在左侧填写本章目标');
    return;
  }
  outputTab.value = 'outline';
  void generationStore.generateOutline(projectId.value, task);
}

async function handleGenerateDraft() {
  if (!generationStore.outlineConfirmed) {
    presentInfo('请先确认章节大纲');
    outputTab.value = 'outline';
    return;
  }
  const task = pendingGenerateTask.value ?? lastWriteTask.value;
  if (!task) {
    presentInfo('请先在左侧填写写作要求');
    return;
  }
  await openRetrievalPreview(task, 'draft');
}

function handleOutlineTextUpdate(value: string) {
  generationStore.setOutlineText(value);
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
  generationStore.reset();
  outputTab.value = 'outline';
  await loadWorkspace();
}

async function handleRegenerateDraft() {
  const task = pendingGenerateTask.value ?? lastWriteTask.value;
  if (!task || !generationStore.outlineConfirmed) {
    return;
  }
  generationStore.resetDraft();
  outputTab.value = 'draft';
  await generationStore.generate(projectId.value, task);
}

onMounted(() => {
  void loadWorkspace();
});
</script>

<template>
  <div class="wb-root workbench-page">
    <header class="wb-page-header">
      <div class="wb-page-header-main">
        <h1 class="wb-page-title">写作工作台</h1>
        <p class="wb-page-subtitle">三步完成：配置要求 → 确认大纲 → 生成并保存正文</p>
      </div>
      <KnowledgePanel
        v-if="!loading"
        class="wb-knowledge-inline"
        :project-name="projectName"
        :chapter-count="chapterCount"
        :outline-ready="outlineReady"
        :active-persona-name="activePersonaName"
        :outline-summary="outlineSummary"
        compact
      />
    </header>

    <div v-if="loading" class="wb-loading">
      <div class="wb-loading-card">
        <div class="wb-spinner" />
        <p>正在加载项目上下文…</p>
      </div>
    </div>

    <template v-else>
      <WorkbenchStepper class="wb-stepper-block" :steps="workflowSteps" />

      <div
        v-if="errorMessage || generationStore.errorMessage || generationStore.outlineErrorMessage"
        class="wb-alert wb-alert--error"
        role="alert"
      >
        {{ errorMessage || generationStore.errorMessage || generationStore.outlineErrorMessage }}
      </div>

      <div class="wb-layout">
        <aside class="wb-sidebar" aria-label="写作要求配置">
          <PromptConsole
            ref="promptConsoleRef"
            :generating="generationStore.isOutlineStreaming || generationStore.isStreaming"
            :project-id="projectId"
            :persona-names="personaNames"
            :personas="personas"
            :knowledge-chapters="editorStore.chapters"
            :workbench-structured-by-chapter="workbenchStructuredByChapter"
            @generate="handleGenerateOutline"
            @structured-parsed="onStructuredParsed"
          />
        </aside>

        <main class="wb-main" aria-label="生成产出">
          <WorkbenchOutputPanel
            v-model:active-tab="outputTab"
            :outline-text="generationStore.outlineText"
            :outline-confirmed="generationStore.outlineConfirmed"
            :is-outline-streaming="generationStore.isOutlineStreaming"
            :is-draft-streaming="generationStore.isStreaming"
            :has-outline="generationStore.hasOutline"
            :draft-text="generationStore.draftText"
            :citations="generationStore.citations"
            :consistency-notes="generationStore.consistencyNotes"
            :used-relation-events="generationStore.usedRelationEvents"
            :is-done="generationStore.isDone"
            :is-accepting="generationStore.isAccepting"
            :generation-phase="generationStore.generationPhase"
            :phase-panel-collapsed="generationStore.phasePanelCollapsed"
            :evidence-count="evidenceCount"
            @update:outline-text="handleOutlineTextUpdate"
            @confirm="handleConfirmOutline"
            @regenerate-outline="handleRegenerateOutline"
            @generate-draft="handleGenerateDraft"
            @accept-draft="handleAcceptDraft"
            @regenerate-draft="handleRegenerateDraft"
          />
        </main>
      </div>
    </template>

    <div
      v-if="readinessVisible && readinessSnapshot"
      class="wb-readiness-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="readiness-title"
    >
      <div class="wb-readiness-dialog" @click.stop>
        <h3 id="readiness-title">前文上下文提示</h3>
        <p class="wb-readiness-text">
          第
          <strong>{{ readinessSnapshot.priorChaptersMissingSummary.join('、') }}</strong>
          章缺少摘要，AI 对前文剧情理解可能不完整。前章衔接段仍会注入；近期池将使用正文摘录降级。
        </p>
        <footer class="wb-readiness-actions">
          <button
            type="button"
            class="ghost-button"
            :disabled="readinessBatchSummarizing"
            @click="readinessVisible = false"
          >
            取消
          </button>
          <button
            type="button"
            class="ghost-button"
            :disabled="readinessBatchSummarizing"
            @click="handleReadinessContinue"
          >
            仍继续生成
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="readinessBatchSummarizing"
            @click="handleReadinessBatchSummarize"
          >
            {{ readinessBatchSummarizing ? '提交中...' : '一键补摘要' }}
          </button>
        </footer>
      </div>
    </div>

    <RetrievalPreviewDialog
      :visible="previewVisible"
      :loading="previewLoading"
      :result="previewResult"
      :error-message="previewError"
      @close="previewVisible = false"
      @confirm="confirmPreviewAndContinue"
    />
  </div>
</template>

<style scoped>
.wb-readiness-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
  padding: 1rem;
}

.wb-readiness-dialog {
  width: min(28rem, 100%);
  background: #fff;
  border-radius: 10px;
  padding: 1.25rem;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}

.wb-readiness-text {
  margin: 0.75rem 0 1.25rem;
  font-size: 0.92rem;
  line-height: 1.55;
  color: #374151;
}

.wb-readiness-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.workbench-page {
  font-family: var(--wb-font);
  color: var(--wb-text);
  padding-bottom: 2.5rem;
  min-height: 100%;
}

.wb-page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.wb-page-header-main {
  flex: 1 1 16rem;
  min-width: 0;
}

.wb-page-title {
  margin: 0 0 0.35rem;
  font-size: 1.65rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.wb-page-subtitle {
  margin: 0;
  font-size: 0.92rem;
  color: var(--wb-text-secondary);
  line-height: 1.5;
}

.wb-knowledge-inline {
  flex: 1 1 20rem;
  max-width: 36rem;
}

.wb-stepper-block {
  margin-bottom: 1.25rem;
}

.wb-alert {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border-radius: var(--wb-radius-sm);
  font-size: 0.9rem;
  line-height: 1.5;
}

.wb-alert--error {
  background: var(--wb-danger-soft);
  border: 1px solid #fecaca;
  color: #991b1b;
}

.wb-layout {
  display: grid;
  grid-template-columns: minmax(300px, 0.38fr) minmax(0, 0.62fr);
  gap: 1.25rem;
  align-items: start;
}

.wb-sidebar,
.wb-main {
  min-width: 0;
}

.wb-loading {
  display: flex;
  justify-content: center;
  padding: 4rem 0;
}

.wb-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 2.5rem;
  border-radius: var(--wb-radius);
  border: 1px solid var(--wb-border);
  background: var(--wb-surface);
  color: var(--wb-text-secondary);
}

.wb-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--wb-border);
  border-top-color: var(--wb-primary);
  border-radius: 50%;
  animation: wb-spin 0.75s linear infinite;
}

@keyframes wb-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1100px) {
  .wb-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .wb-page-title {
    font-size: 1.35rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wb-spinner {
    animation: none;
  }
}
</style>
