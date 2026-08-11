<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  apiClient,
  buildPersonasContextPayload,
  formatPipelineStageLabel,
  isTerminalChapterPipelineRunEnd,
  type ChapterItem,
  type ChapterPipelineConfig,
  type ChapterPipelineOutlineType,
  type ChapterPipelineRunModule,
  type ChapterPipelineSessionView,
  type ChapterPipelineVersionKey,
  type PipelineOutlineItem,
  type PipelineOutlineState,
  type PreviewRetrievalResult,
} from '../../services/api';
import RetrievalPreviewDialog from '../workbench/RetrievalPreviewDialog.vue';
import { resolveEffectiveStructuredMatchingText } from '../../utils/structured-matching';
import {
  hasSelectedPersonaCard,
  resolvePersonaNamesFromPreviewSelection,
} from '../../utils/pipelinePersonaPreview';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';
import {
  applyAiTaskProgressEvent,
  completeAiTaskProgress,
  failAiTaskProgress,
  resetAiTaskProgress,
  startAiTaskProgress,
} from '../../composables/useAiTaskProgress';
import {
  useChapterAiActivityInterrupt,
  useChapterPageAiActivity,
} from '../../composables/chapterAiActivityContext';
import { useChapterSseTask } from '../../composables/useChapterSseTask';
import AiTaskProgressPanel from '../common/AiTaskProgressPanel.vue';
import MarkdownContent from '../common/MarkdownContent.vue';
import SseInterruptButton from '../common/SseInterruptButton.vue';
import PipelineOutlineEditor from './PipelineOutlineEditor.vue';
import OutlineReviewLayout from './OutlineReviewLayout.vue';
import OutlineCoverageChecklist from './OutlineCoverageChecklist.vue';
import PipelineBriefPanel from './PipelineBriefPanel.vue';
import { buildChapterDiffLines, buildInlineDiffViews } from '../../utils/chapterOptimizeDiff';
import { confirmAction } from '../../composables/useAppConfirm';
import {
  areRequiredOutlineItemsResolved,
  isPipelineOutlineEmpty,
} from '../../utils/pipelineOutline';
import {
  resolveGenerateModuleForOutlineStep,
  resolveManualContinueAction,
  resolveOutlineTypeForStep,
  resolvePipelineBootstrapAction,
  type PipelineDialogStep,
} from '../../utils/chapterPipelineOptimizeFlow';
import {
  configOverridesFromSelection,
  isPipelineModuleSelectionValid,
  selectionFromProjectSettings,
  type PipelineModuleSelection,
} from '../../utils/pipelineModuleSelection';
import type {
  ChapterPipelineRewriteFixItemsModule,
  ChapterPipelineRewriteReviseModule,
  PipelineOutlineCoverageSummary,
} from '../../services/api';

type PipelineStep = PipelineDialogStep;

interface PipelineStepItem {
  key: PipelineStep | 'sensory' | 'character-traits-outline';
  label: string;
}

const props = defineProps<{
  visible: boolean;
  projectId: string;
  chapter: ChapterItem | null;
}>();

const emit = defineEmits<{
  close: [];
  applied: [chapter: ChapterItem];
}>();

const sessionId = ref('');
const session = ref<ChapterPipelineSessionView | null>(null);
const config = ref<ChapterPipelineConfig | null>(null);
const step = ref<PipelineStep>('ready');
const running = ref(false);
const applying = ref(false);
const errorMessage = ref('');
const streamingText = ref('');
const progressLabel = ref('');
const aiTaskProgress = useChapterPageAiActivity();
const activityInterruptHandler = useChapterAiActivityInterrupt();
const { interruptStream, beginStream, handleStreamError, endStream } =
  useChapterSseTask(aiTaskProgress);

function bindActivityInterrupt() {
  if (activityInterruptHandler) {
    activityInterruptHandler.value = () => interruptStream();
    clearActivityInterrupt();
  }
}

function clearActivityInterrupt() {
  if (activityInterruptHandler) {
    activityInterruptHandler.value = null;
  }
}
const chapterUpdatedAtSnapshot = ref('');
const outlineRevisionRound = ref(0);
const activeOutlineType = ref<ChapterPipelineOutlineType>('sensory');
const outlineRequired = ref<PipelineOutlineItem[]>([]);
const outlineSuggested = ref<PipelineOutlineItem[]>([]);
const previewVisible = ref(false);
const previewLoading = ref(false);
const previewResult = ref<PreviewRetrievalResult | null>(null);
const previewError = ref('');
const pendingRunAll = ref(false);
const selectedPersonaNames = ref<string[]>([]);
const optimizationIntent = ref('');
const runModuleSelection = ref<PipelineModuleSelection>({
  characterAdjustment: false,
  characterTraits: true,
  sensory: true,
  homogenization: false,
});
const moduleSelectionValid = computed(() => isPipelineModuleSelectionValid(runModuleSelection.value));

const isBusy = computed(() => running.value || applying.value);

const originalText = computed(
  () => session.value?.versions.original ?? props.chapter?.content ?? ''
);

const currentVersionText = computed(() => {
  const versions = session.value?.versions;
  if (!versions) {
    return '';
  }
  return (
    versions.final ??
    versions.afterRules ??
    versions.afterSensory ??
    versions.afterCharacterTraits ??
    versions.afterCharacter ??
    versions.original ??
    ''
  );
});

const previewMode = ref<'final' | 'diff'>('diff');
const stepPreviewText = ref('');
const rewriteReviseFeedback = ref('');
const coverageSummary = ref<PipelineOutlineCoverageSummary | null>(null);
const coverageVerifying = ref(false);
/** 最近一次完成改写的模块（run-all 跳到 done 后仍保留验收上下文） */
const activeCoverageModule = ref<ChapterPipelineRewriteFixItemsModule | null>(null);

function moduleToCoverageContext(module: ChapterPipelineRewriteFixItemsModule): {
  outlineType: ChapterPipelineOutlineType;
  module: ChapterPipelineRewriteFixItemsModule;
} {
  switch (module) {
    case 'character':
      return { outlineType: 'character', module: 'character' };
    case 'character-traits':
      return { outlineType: 'character-traits', module: 'character-traits' };
    default:
      return { outlineType: 'sensory', module: 'sensory-rewrite' };
  }
}

function versionKeyToCoverageModule(
  versionKey?: string
): ChapterPipelineRewriteFixItemsModule | null {
  switch (versionKey) {
    case 'afterCharacter':
      return 'character';
    case 'afterCharacterTraits':
      return 'character-traits';
    case 'afterSensory':
      return 'sensory-rewrite';
    default:
      return null;
  }
}

function shouldPauseForSensoryCoverageReview(): boolean {
  const outline = session.value?.sensoryOutline;
  if (!outline?.userConfirmed || isPipelineOutlineEmpty(outline.required, outline.suggested)) {
    return false;
  }
  if (!session.value?.versions.afterSensory?.trim()) {
    return false;
  }
  const modules = config.value?.pipelineEnabledModules ?? [1, 2];
  return modules.includes(2);
}

function resolveCoverageContext(currentStep: PipelineStep): {
  outlineType: ChapterPipelineOutlineType;
  module: ChapterPipelineRewriteFixItemsModule;
} | null {
  switch (currentStep) {
    case 'character':
      return { outlineType: 'character', module: 'character' };
    case 'character-traits':
      return { outlineType: 'character-traits', module: 'character-traits' };
    case 'sensory-rewrite':
      return { outlineType: 'sensory', module: 'sensory-rewrite' };
    default:
      return null;
  }
}

const coverageContext = computed(() => resolveCoverageContext(step.value));

const effectiveCoverageContext = computed(() => {
  if (activeCoverageModule.value) {
    return moduleToCoverageContext(activeCoverageModule.value);
  }
  return coverageContext.value;
});

const coverageOutlineState = computed(() => {
  const ctx = effectiveCoverageContext.value;
  if (!ctx || !session.value) {
    return null;
  }
  switch (ctx.outlineType) {
    case 'character':
      return session.value.characterOutline;
    case 'character-traits':
      return session.value.characterTraitsOutline;
    default:
      return session.value.sensoryOutline;
  }
});

const showCoverageChecklist = computed(() => {
  if (running.value || step.value === 'ready' || isOutlineStep.value) {
    return false;
  }
  const outline = coverageOutlineState.value;
  if (!effectiveCoverageContext.value || !outline) {
    return false;
  }
  return !isPipelineOutlineEmpty(outline.required, outline.suggested);
});

const coverageRequired = computed(() => coverageOutlineState.value?.required ?? []);
const coverageSuggested = computed(() => coverageOutlineState.value?.suggested ?? []);

const briefContext = computed(() => {
  if (!session.value) {
    return null;
  }
  switch (step.value) {
    case 'character':
      return { outlineType: 'character' as const, outline: session.value.characterOutline };
    case 'character-traits':
      return {
        outlineType: 'character-traits' as const,
        outline: session.value.characterTraitsOutline,
      };
    case 'sensory-rewrite':
      return { outlineType: 'sensory' as const, outline: session.value.sensoryOutline };
    default:
      return null;
  }
});

const showBriefPanel = computed(() => {
  if (running.value || step.value === 'ready' || isOutlineStep.value) {
    return false;
  }
  const ctx = briefContext.value;
  if (!ctx?.outline?.userConfirmed) {
    return false;
  }
  return !isPipelineOutlineEmpty(ctx.outline.required, ctx.outline.suggested);
});

const briefDraft = ref('');
const briefSynthesizing = ref(false);

watch(
  () => briefContext.value?.outline?.synthesizedBrief ?? '',
  (value) => {
    briefDraft.value = value;
  },
  { immediate: true }
);

const briefEditedByUser = computed(
  () => briefContext.value?.outline?.briefEditedByUser === true
);

function resolveStepVersionKey(currentStep: PipelineStep): ChapterPipelineVersionKey | null {
  switch (currentStep) {
    case 'character':
      return 'afterCharacter';
    case 'character-traits':
      return 'afterCharacterTraits';
    case 'sensory-rewrite':
      return 'afterSensory';
    case 'homogenization':
    case 'done':
      return 'final';
    default:
      return null;
  }
}

const stepVersionKey = computed(() => resolveStepVersionKey(step.value));

const isOutlineStep = computed(() =>
  ['character-outline', 'character-traits-outline', 'sensory-outline'].includes(step.value)
);

type PipelineOutlineReferenceKey = ChapterPipelineVersionKey | 'original';

function pickVersionText(
  versions: ChapterPipelineSessionView['versions'] | undefined,
  keys: PipelineOutlineReferenceKey[]
): string {
  if (!versions) {
    return '';
  }
  for (const key of keys) {
    const text = versions[key]?.trim();
    if (text) {
      return text;
    }
  }
  return '';
}

const outlineReferenceText = computed(() => {
  const fallback = props.chapter?.content?.trim() ?? '';
  const versions = session.value?.versions;
  if (!isOutlineStep.value) {
    return fallback;
  }
  switch (step.value) {
    case 'character-outline':
      return pickVersionText(versions, ['original']) || fallback;
    case 'character-traits-outline':
      return pickVersionText(versions, ['afterCharacter', 'original']) || fallback;
    case 'sensory-outline':
      return (
        pickVersionText(versions, ['afterCharacterTraits', 'afterCharacter', 'original']) ||
        fallback
      );
    default:
      return fallback;
  }
});

const outlineReferenceLabel = computed(() => {
  const versions = session.value?.versions;
  switch (step.value) {
    case 'character-outline':
      return '本章正文';
    case 'character-traits-outline':
      return versions?.afterCharacter?.trim() ? '角色调整后正文' : '本章正文';
    case 'sensory-outline':
      if (versions?.afterCharacterTraits?.trim()) {
        return '特征润色后正文';
      }
      if (versions?.afterCharacter?.trim()) {
        return '角色调整后正文';
      }
      return '本章正文';
    default:
      return '对照正文';
  }
});

const modalWidth = computed(() => (isOutlineStep.value ? 1080 : 920));
const outlineGenerated = computed(() => {
  switch (activeOutlineType.value) {
    case 'character':
      return Boolean(session.value?.characterOutline);
    case 'character-traits':
      return Boolean(session.value?.characterTraitsOutline);
    default:
      return Boolean(session.value?.sensoryOutline);
  }
});

function readStepVersionFromSession(): string {
  const key = stepVersionKey.value;
  if (!key || !session.value?.versions) {
    return '';
  }
  return session.value.versions[key] ?? '';
}

const previewCompareText = computed(() => {
  if (stepVersionKey.value) {
    const direct = stepPreviewText.value.trim() || readStepVersionFromSession();
    if (direct.trim()) {
      return direct;
    }
    return currentVersionText.value;
  }
  return currentVersionText.value;
});

const diffLines = computed(() => {
  if (!originalText.value || !previewCompareText.value) {
    return [];
  }
  return buildChapterDiffLines(originalText.value, previewCompareText.value);
});

const diffAddedCount = computed(() => diffLines.value.filter((r) => r.type === 'added').length);
const diffRemovedCount = computed(() => diffLines.value.filter((r) => r.type === 'removed').length);
const diffModifiedCount = computed(
  () => diffLines.value.filter((r) => r.type === 'modified').length
);

const inlineDiff = computed(() =>
  buildInlineDiffViews(originalText.value, previewCompareText.value)
);

const hasResultDiff = computed(() =>
  Boolean(originalText.value && previewCompareText.value && diffLines.value.length > 0)
);

const showResultPreview = computed(() => {
  if (running.value || step.value === 'ready' || isOutlineStep.value) {
    return false;
  }
  if (stepVersionKey.value) {
    return Boolean(previewCompareText.value.trim());
  }
  return Boolean(currentVersionText.value);
});

const pipelineIncomplete = computed(() => {
  if (!session.value || step.value === 'done' || step.value === 'ready') {
    return false;
  }
  const versions = session.value.versions;
  const modules = config.value?.pipelineEnabledModules ?? [1, 2];
  const traitsEnabled = config.value?.pipelineCharacterTraitsEnabled !== false;
  const adjustmentEnabled = config.value?.pipelineCharacterAdjustmentEnabled === true;

  if (modules.includes(4) && config.value?.pipelineHomogenizationEnabled) {
    if (!versions.final?.trim()) {
      return true;
    }
  }
  if (modules.includes(2)) {
    if (!versions.afterSensory?.trim()) {
      return true;
    }
  }
  if (modules.includes(1)) {
    if (adjustmentEnabled && !versions.afterCharacter?.trim()) {
      return true;
    }
    if (traitsEnabled && !versions.afterCharacterTraits?.trim()) {
      return true;
    }
  }
  return false;
});

const pipelineSteps = computed<PipelineStepItem[]>(() => {
  const modules = config.value?.pipelineEnabledModules ?? [1, 2];
  const adjustmentEnabled = config.value?.pipelineCharacterAdjustmentEnabled === true;
  const steps: PipelineStepItem[] = [{ key: 'ready', label: '准备' }];
  if (modules.includes(1)) {
    if (adjustmentEnabled) {
      steps.push({ key: 'character', label: '角色调整' });
    }
    if (config.value?.pipelineCharacterTraitsEnabled !== false) {
      steps.push({ key: 'character-traits-outline', label: '特征润色' });
    }
  }
  if (modules.includes(2)) {
    steps.push({ key: 'sensory', label: '感官优化' });
  }
  if (modules.includes(4) && config.value?.pipelineHomogenizationEnabled) {
    steps.push({ key: 'homogenization', label: '同质化' });
  }
  steps.push({ key: 'done', label: '应用' });
  return steps;
});

const activeStepIndex = computed(() => {
  const idx = pipelineSteps.value.findIndex((item) => {
    if (step.value === 'character-outline' || step.value === 'character') {
      return item.key === 'character';
    }
    if (step.value === 'character-traits-outline' || step.value === 'character-traits') {
      return item.key === 'character-traits-outline';
    }
    if (step.value === 'sensory-outline' || step.value === 'sensory-rewrite') {
      return item.key === 'sensory';
    }
    if (step.value === 'homogenization') {
      return item.key === 'homogenization';
    }
    if (step.value === 'done') {
      return item.key === 'done';
    }
    return item.key === step.value;
  });
  return idx >= 0 ? idx : 0;
});

function isStepDone(index: number) {
  return index < activeStepIndex.value;
}

function isStepActive(index: number) {
  return index === activeStepIndex.value;
}

function resetState() {
  sessionId.value = '';
  session.value = null;
  config.value = null;
  step.value = 'ready';
  running.value = false;
  applying.value = false;
  errorMessage.value = '';
  streamingText.value = '';
  progressLabel.value = '';
  outlineRequired.value = [];
  outlineSuggested.value = [];
  outlineRevisionRound.value = 0;
  activeOutlineType.value = 'sensory';
  previewVisible.value = false;
  previewLoading.value = false;
  previewResult.value = null;
  previewError.value = '';
  pendingRunAll.value = false;
  selectedPersonaNames.value = [];
  previewMode.value = 'diff';
  stepPreviewText.value = '';
  rewriteReviseFeedback.value = '';
  coverageSummary.value = null;
  coverageVerifying.value = false;
  activeCoverageModule.value = null;
  runModuleSelection.value = {
    characterAdjustment: false,
    characterTraits: true,
    sensory: true,
    homogenization: false,
  };
  resetAiTaskProgress(aiTaskProgress);
}

async function loadProjectPipelineDefaults() {
  try {
    const settings = await apiClient.getSettings(props.projectId);
    runModuleSelection.value = selectionFromProjectSettings(settings);
  } catch {
    // 使用 resetState 中的默认值
  }
}

type PipelineEndEvent = {
  gateRequired?: boolean;
  gate?: string;
  currentModule?: number | 'done';
  characterOutline?: ChapterPipelineSessionView['characterOutline'];
  characterTraitsOutline?: ChapterPipelineSessionView['characterTraitsOutline'];
  sensoryOutline?: ChapterPipelineSessionView['sensoryOutline'];
  versionKey?: string;
  versionText?: string;
  homogenizationReport?: ChapterPipelineSessionView['homogenizationReport'];
  outlinePassthrough?: boolean;
};

function syncStepPreviewFromSession(force = false) {
  const key = stepVersionKey.value;
  if (!key || !session.value?.versions) {
    if (force) {
      stepPreviewText.value = '';
    }
    return;
  }
  const fromSession = session.value.versions[key] ?? '';
  if (force || !stepPreviewText.value.trim()) {
    stepPreviewText.value = fromSession;
  }
}

function applyEndVersionText(endEvent: PipelineEndEvent) {
  if (endEvent.versionText?.trim()) {
    stepPreviewText.value = endEvent.versionText;
    return;
  }
  syncStepPreviewFromSession(true);
}

watch(stepVersionKey, () => syncStepPreviewFromSession(true));

watch(
  () => step.value,
  (nextStep) => {
    if (nextStep === 'done') {
      previewMode.value = 'diff';
      return;
    }
    if (resolveStepVersionKey(nextStep)) {
      previewMode.value = 'final';
    }
  }
);

watch(
  () => props.visible,
  (visible) => {
    if (visible && props.chapter) {
      resetState();
      chapterUpdatedAtSnapshot.value = props.chapter.updatedAt;
      void loadProjectPipelineDefaults();
    }
    if (!visible) {
      resetState();
    }
  }
);

function close() {
  if (running.value) {
    interruptStream();
    clearActivityInterrupt();
    running.value = false;
  }
  if (applying.value) {
    return;
  }
  emit('close');
}

function applyOutlineToEditor(
  outlineType: ChapterPipelineOutlineType,
  source?: PipelineOutlineState | null
) {
  activeOutlineType.value = outlineType;
  const resolved =
    source ??
    (outlineType === 'character'
      ? session.value?.characterOutline
      : outlineType === 'character-traits'
        ? session.value?.characterTraitsOutline
        : session.value?.sensoryOutline);
  if (!resolved) {
    outlineRequired.value = [];
    outlineSuggested.value = [];
    outlineRevisionRound.value = 0;
    return;
  }
  outlineRequired.value = [...(resolved.required ?? [])];
  outlineSuggested.value = [...(resolved.suggested ?? [])];
  outlineRevisionRound.value = resolved.revisionRound ?? 0;
}

function loadOutlineFromSession(outlineType: ChapterPipelineOutlineType) {
  applyOutlineToEditor(outlineType);
}

function getOutlineStateForType(outlineType: ChapterPipelineOutlineType) {
  switch (outlineType) {
    case 'character':
      return session.value?.characterOutline;
    case 'character-traits':
      return session.value?.characterTraitsOutline;
    default:
      return session.value?.sensoryOutline;
  }
}

function enterOutlineGate(outlineType: ChapterPipelineOutlineType) {
  activeOutlineType.value = outlineType;
  step.value =
    outlineType === 'character'
      ? 'character-outline'
      : outlineType === 'character-traits'
        ? 'character-traits-outline'
        : 'sensory-outline';
  loadOutlineFromSession(outlineType);
}

async function refreshSession() {
  if (!sessionId.value || !props.chapter) {
    return;
  }
  session.value = await apiClient.getChapterPipelineSession(
    props.projectId,
    props.chapter.chapterNo,
    sessionId.value
  );
  if (session.value.sourceUpdatedAt?.trim()) {
    chapterUpdatedAtSnapshot.value = session.value.sourceUpdatedAt;
  }
  if (step.value === 'character-outline') {
    loadOutlineFromSession('character');
  } else if (step.value === 'character-traits-outline') {
    loadOutlineFromSession('character-traits');
  } else if (step.value === 'sensory-outline') {
    loadOutlineFromSession('sensory');
  } else if (session.value.sensoryOutline) {
    loadOutlineFromSession('sensory');
  }
  syncStepPreviewFromSession(true);
}

async function handleStart(runAll = false) {
  if (!props.chapter?.content?.trim()) {
    errorMessage.value = '章节正文为空';
    return;
  }
  pendingRunAll.value = runAll;
  await openPersonaPreview();
}

async function openPersonaPreview() {
  if (!props.chapter) {
    return;
  }
  previewVisible.value = true;
  previewLoading.value = true;
  previewResult.value = null;
  previewError.value = '';
  errorMessage.value = '';

  try {
    const workspace = await apiClient.getWorkspace(props.projectId);
    const docRes = await apiClient.documents.list(props.projectId);
    const docList = apiClient.unwrapPayload(docRes) as Array<{
      id: string;
      title: string;
      content: string;
      docType?: string;
      personaId?: string | null;
    }>;

    const activePersona =
      workspace.personas.find((item) => item.id === workspace.settings.activePersonaId) ||
      workspace.personas.find((item) => item.status === 'published') ||
      null;

    previewResult.value = await apiClient.previewRetrieval(props.projectId, {
      prompt: props.chapter.content.slice(0, 2000),
      chapterNo: props.chapter.chapterNo,
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
          structuredMatchingText: resolveEffectiveStructuredMatchingText(ch.structuredInfo),
        })),
        knowledgeDocuments: docList.map((doc) => ({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          docType: doc.docType ?? 'other',
          personaId: doc.personaId ?? null,
        })),
        chapterSummaryPromptCount: workspace.settings.chapterSummaryPromptCount,
        chapterSummaryMemoryCount:
          (workspace.settings as { chapterSummaryMemoryCount?: number })
            .chapterSummaryMemoryCount ?? 3,
        priorChapterTailChars:
          (workspace.settings as { priorChapterTailChars?: number }).priorChapterTailChars ?? 800,
        contextExcerptMaxChars:
          (workspace.settings as { contextExcerptMaxChars?: number }).contextExcerptMaxChars ?? 400,
        outlineMaxChars: (workspace.settings as { outlineMaxChars?: number }).outlineMaxChars ?? 4000,
        personaProfileMaxChars:
          (workspace.settings as { personaProfileMaxChars?: number }).personaProfileMaxChars ??
          2000,
        relationMemoMaxChars:
          (workspace.settings as { relationMemoMaxChars?: number }).relationMemoMaxChars ?? 2000,
        personas: buildPersonasContextPayload(workspace.personas),
      },
      extraContext: {
        retrievalInstruction: '创作精修',
        retrievalChapterTitle: props.chapter.title,
        retrievalChapterSummary: props.chapter.summary || props.chapter.content.slice(0, 500),
      },
    });
  } catch (error) {
    previewError.value = error instanceof Error ? error.message : '检索预览失败';
  } finally {
    previewLoading.value = false;
  }
}

async function confirmPersonaPreviewAndStart(selectedIds: string[]) {
  if (!previewResult.value) {
    return;
  }
  if (!hasSelectedPersonaCard(previewResult.value, selectedIds)) {
    presentErrorFromCaught(new Error('请至少勾选一条角色卡'), '未选择角色卡');
    return;
  }
  const names = resolvePersonaNamesFromPreviewSelection(previewResult.value, selectedIds);
  if (!names.length) {
    presentErrorFromCaught(new Error('未能解析角色卡名称'), '未选择角色卡');
    return;
  }
  selectedPersonaNames.value = names;
  previewVisible.value = false;
  await startPipelineSession(pendingRunAll.value);
}

async function maybeAutoVerifyCoverageAfterRewrite() {
  if (!effectiveCoverageContext.value) {
    return;
  }
  await runCoverageVerify(true);
}

async function runCoverageVerify(showToastOnComplete = true) {
  const ctx = effectiveCoverageContext.value;
  if (!ctx || !props.chapter || !sessionId.value || coverageVerifying.value) {
    return;
  }
  const outline = coverageOutlineState.value;
  if (!outline || isPipelineOutlineEmpty(outline.required, outline.suggested)) {
    coverageSummary.value = null;
    return;
  }

  coverageVerifying.value = true;
  errorMessage.value = '';
  bindActivityInterrupt();
  startAiTaskProgress(aiTaskProgress, {
    source: 'dialog:pipeline',
    chapterNo: props.chapter?.chapterNo ?? null,
    interruptible: true,
    taskKey: 'chapter.pipeline.coverage.verify',
    message: '对照大纲验收落实中…',
  });

  try {
    const result = await apiClient.verifyChapterPipelineOutlineCoverage(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        outlineType: ctx.outlineType,
        module: ctx.module,
        draftTextOverride: stepPreviewText.value.trim() || undefined,
      }
    );
    coverageSummary.value = result.summary;
    await refreshSession();
    if (showToastOnComplete) {
      const missed = result.summary.requiredMissed;
      if (missed > 0) {
        presentSuccess(`验收完成：${missed} 条必需项未落实，请勾选后手动补修`);
      } else {
        presentSuccess('必需大纲项均已落实');
      }
    }
    completeAiTaskProgress(aiTaskProgress, '大纲验收完成');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '大纲验收失败';
    failAiTaskProgress(aiTaskProgress, errorMessage.value);
    if (showToastOnComplete) {
      presentErrorFromCaught(error, '大纲验收失败');
    }
  } finally {
    coverageVerifying.value = false;
  }
}

async function handleFixCoverageItems(itemIds: string[]) {
  const ctx = effectiveCoverageContext.value;
  if (!ctx || !props.chapter || !sessionId.value || running.value || !itemIds.length) {
    return;
  }

  await persistStepPreviewText();
  running.value = true;
  streamingText.value = '';
  errorMessage.value = '';
  bindActivityInterrupt();
  startAiTaskProgress(aiTaskProgress, {
    source: 'dialog:pipeline',
    chapterNo: props.chapter?.chapterNo ?? null,
    interruptible: true,
    taskKey: 'chapter.pipeline.rewrite.fix-items',
    message: '按清单补修正文中…',
  });
  const signal = beginStream();

  try {
    await apiClient.fixChapterPipelineRewriteItemsSSE(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        module: ctx.module,
        itemIds,
        draftTextOverride: stepPreviewText.value.trim() || undefined,
      },
      {
        onStart: ({ stage }) => {
          streamingText.value = '';
          progressLabel.value = formatPipelineStageLabel(stage);
        },
        onStage: ({ stage, segmentIndex, segmentTotal }) => {
          progressLabel.value = formatPipelineStageLabel(stage, segmentIndex, segmentTotal);
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: 'chapter.pipeline.rewrite.fix-items',
            stage,
            message: progressLabel.value,
            currentStep: segmentIndex,
            totalSteps: segmentTotal,
          });
        },
        onContent: (text) => {
          streamingText.value += text;
        },
        onEnd: async (event) => {
          const endEvent = event as { versionText?: string };
          await refreshSession();
          if (endEvent.versionText) {
            stepPreviewText.value = endEvent.versionText;
          } else {
            syncStepPreviewFromSession(true);
          }
          completeAiTaskProgress(aiTaskProgress, '按清单补修完成');
          presentSuccess('已按选中大纲项补修');
          await maybeAutoVerifyCoverageAfterRewrite();
        },
        onError: (message) => {
          errorMessage.value = message;
          failAiTaskProgress(aiTaskProgress, message);
        },
      },
      { signal }
    );
  } catch (error) {
    if (handleStreamError(error)) {
      return;
    }
    errorMessage.value = error instanceof Error ? error.message : '按清单补修失败';
    failAiTaskProgress(aiTaskProgress, errorMessage.value);
    presentErrorFromCaught(error, '按清单补修失败');
  } finally {
    running.value = false;
    endStream();
  }
}

async function handleResynthesizeBrief() {
  const ctx = briefContext.value;
  if (!ctx || !props.chapter || !sessionId.value || briefSynthesizing.value) {
    return;
  }
  briefSynthesizing.value = true;
  try {
    const result = await apiClient.synthesizeChapterPipelineOutlineBrief(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      { outlineType: ctx.outlineType }
    );
    briefDraft.value = result.synthesizedBrief;
    await refreshSession();
    presentSuccess('编辑意向书已重新合成');
  } catch (error) {
    presentErrorFromCaught(error, '意向书合成失败');
  } finally {
    briefSynthesizing.value = false;
  }
}

async function handleSaveBrief() {
  const ctx = briefContext.value;
  if (!ctx || !props.chapter || !sessionId.value || running.value) {
    return;
  }
  const text = briefDraft.value.trim();
  if (!text) {
    presentErrorFromCaught(new Error('意向书不能为空'), '保存失败');
    return;
  }
  try {
    session.value = await apiClient.patchChapterPipelineOutlineBrief(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      { outlineType: ctx.outlineType, synthesizedBrief: text }
    );
    presentSuccess('编辑意向书已保存');
  } catch (error) {
    presentErrorFromCaught(error, '保存意向书失败');
  }
}

async function handlePatchCoverage(
  updates: Array<{
    id: string;
    coverageStatus: 'manual' | 'skipped';
    coverageNote?: string;
  }>
) {
  const ctx = effectiveCoverageContext.value;
  if (!ctx || !props.chapter || !sessionId.value || !updates.length) {
    return;
  }
  try {
    session.value = await apiClient.patchChapterPipelineOutlineCoverage(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      { outlineType: ctx.outlineType, updates }
    );
    const outline = coverageOutlineState.value;
    if (outline) {
      coverageSummary.value = {
        requiredTotal: outline.required.length,
        requiredResolved: outline.required.filter(
          (item) => item.coverageStatus === 'done' || item.coverageStatus === 'manual'
        ).length,
        requiredMissed: outline.required.filter(
          (item) => item.coverageStatus === 'missed' || item.coverageStatus === 'partial'
        ).length,
        suggestedTotal: outline.suggested.length,
      };
    }
  } catch (error) {
    presentErrorFromCaught(error, '更新验收状态失败');
  }
}

async function startPipelineSession(runAll = false) {
  if (!props.chapter?.content?.trim()) {
    errorMessage.value = '章节正文为空';
    return;
  }
  if (!moduleSelectionValid.value) {
    errorMessage.value = '请至少勾选一个精修模块';
    return;
  }
  running.value = true;
  errorMessage.value = '';
  try {
    const result = await apiClient.startChapterPipeline(props.projectId, props.chapter.chapterNo, {
      selectedPersonaNames: selectedPersonaNames.value,
      optimizationIntent: optimizationIntent.value.trim() || undefined,
      configOverrides: configOverridesFromSelection(runModuleSelection.value),
    });
    sessionId.value = result.sessionId;
    config.value = result.config;
    await refreshSession();
    const action = resolvePipelineBootstrapAction(runAll, result.config, session.value);
    step.value = action.step;
    const outlineType = resolveOutlineTypeForStep(action.step);
    if (outlineType) {
      enterOutlineGate(outlineType);
    }
    if (action.autoRun && action.module) {
      await runModule(action.module);
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '启动失败';
    presentErrorFromCaught(error, '启动创作精修失败');
  } finally {
    running.value = false;
  }
}

function applyOutlineFromEndEvent(
  outlineType: ChapterPipelineOutlineType,
  endEvent: PipelineEndEvent | null
) {
  if (!endEvent) {
    return;
  }
  switch (outlineType) {
    case 'character':
      if (endEvent.characterOutline) {
        applyOutlineToEditor('character', endEvent.characterOutline);
      }
      break;
    case 'character-traits':
      if (endEvent.characterTraitsOutline) {
        applyOutlineToEditor('character-traits', endEvent.characterTraitsOutline);
      }
      break;
    default:
      if (endEvent.sensoryOutline) {
        applyOutlineToEditor('sensory', endEvent.sensoryOutline);
      }
      break;
  }
}

async function handleGenerateOutline(feedback?: string) {
  const outlineType = resolveOutlineTypeForStep(step.value);
  const module = resolveGenerateModuleForOutlineStep(step.value);
  if (!module || !outlineType) {
    return;
  }
  const trimmedFeedback = feedback?.trim();
  const endEvent = await runModule(
    module,
    trimmedFeedback ? { userFeedback: trimmedFeedback } : undefined
  );
  if (trimmedFeedback) {
    applyOutlineFromEndEvent(outlineType, endEvent);
    if (isPipelineOutlineEmpty(outlineRequired.value, outlineSuggested.value)) {
      await refreshSession();
      loadOutlineFromSession(outlineType);
    }
    if (!isPipelineOutlineEmpty(outlineRequired.value, outlineSuggested.value)) {
      presentSuccess('大纲已按意见生成，请继续审阅');
    }
    return;
  }
}

async function runModule(
  module: ChapterPipelineRunModule,
  payload?: { issueId?: string; forceRegenerate?: boolean; userFeedback?: string }
): Promise<PipelineEndEvent | null> {
  if (!props.chapter || !sessionId.value) {
    return null;
  }
  running.value = true;
  streamingText.value = '';
  errorMessage.value = '';
  const isRunAll = module === 'run-all';
  bindActivityInterrupt();
  startAiTaskProgress(aiTaskProgress, {
    source: 'dialog:pipeline',
    chapterNo: props.chapter?.chapterNo ?? null,
    interruptible: true,
    taskKey: isRunAll ? 'chapter.pipeline.run-all' : 'chapter.pipeline.run',
    message: isRunAll ? '全自动精修执行中…' : '创作精修执行中…',
  });
  const signal = beginStream();
  let endEventResult: PipelineEndEvent | null = null;
  let resolveOnEnd!: () => void;
  const onEndSettled = new Promise<void>((resolve) => {
    resolveOnEnd = resolve;
  });
  let onEndResolved = false;
  const settleOnEnd = () => {
    if (onEndResolved) {
      return;
    }
    onEndResolved = true;
    resolveOnEnd();
  };

  try {
    await apiClient.runChapterPipelineModuleSSE(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      module,
      payload,
      {
        onStart: ({ stage }) => {
          streamingText.value = '';
          progressLabel.value = formatPipelineStageLabel(stage);
        },
        onStage: ({ stage, segmentIndex, segmentTotal }) => {
          progressLabel.value = formatPipelineStageLabel(stage, segmentIndex, segmentTotal);
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey: isRunAll ? 'chapter.pipeline.run-all' : 'chapter.pipeline.run',
            stage,
            message: progressLabel.value,
            currentStep: segmentIndex,
            totalSteps: segmentTotal,
          });
        },
        onContent: (text) => {
          streamingText.value += text;
        },
        onEnd: async (event) => {
          try {
            const endEvent = event as PipelineEndEvent;
            endEventResult = endEvent;
            if (endEvent.gateRequired && endEvent.gate) {
            if (endEvent.gate === 'character-outline') {
              step.value = 'character-outline';
              if (endEvent.characterOutline) {
                applyOutlineToEditor('character', endEvent.characterOutline);
              } else {
                await refreshSession();
                loadOutlineFromSession('character');
              }
            } else if (endEvent.gate === 'character-traits-outline') {
              step.value = 'character-traits-outline';
              if (endEvent.characterTraitsOutline) {
                applyOutlineToEditor('character-traits', endEvent.characterTraitsOutline);
              } else {
                await refreshSession();
                loadOutlineFromSession('character-traits');
              }
            } else if (endEvent.gate === 'sensory-outline') {
              step.value = 'sensory-outline';
              if (endEvent.sensoryOutline) {
                applyOutlineToEditor('sensory', endEvent.sensoryOutline);
              } else {
                await refreshSession();
                loadOutlineFromSession('sensory');
              }
            } else {
              await refreshSession();
            }
            completeAiTaskProgress(aiTaskProgress, '等待确认大纲');
            return;
          }
          await refreshSession();
          const coverageModule = versionKeyToCoverageModule(endEvent.versionKey);
          if (coverageModule) {
            activeCoverageModule.value = coverageModule;
          }
          if (endEvent.currentModule === 'done' && shouldPauseForSensoryCoverageReview()) {
            activeCoverageModule.value = 'sensory-rewrite';
            step.value = 'sensory-rewrite';
            applyEndVersionText(endEvent);
            if (endEvent.outlinePassthrough) {
              presentSuccess('无大纲修改项，已保留原文');
            }
            await maybeAutoVerifyCoverageAfterRewrite();
            completeAiTaskProgress(aiTaskProgress, '感官改写完成，请验收大纲落实');
            return;
          }
          applyPipelineStepFromEnd(endEvent);
          applyEndVersionText(endEvent);
          if (endEvent.outlinePassthrough) {
            presentSuccess('无大纲修改项，已保留原文');
          }
          if (!endEvent.gateRequired && effectiveCoverageContext.value) {
            await maybeAutoVerifyCoverageAfterRewrite();
          }
          if (
            !isRunAll &&
            module === 'character-outline' &&
            endEvent.characterOutline?.userConfirmed
          ) {
            step.value = 'character';
            await runModule('character');
            return;
          }
          if (
            !isRunAll &&
            module === 'character-traits-outline' &&
            endEvent.characterTraitsOutline?.userConfirmed
          ) {
            step.value = 'character-traits';
            await runModule('character-traits');
            return;
          }
          if (!isRunAll && module === 'sensory-outline' && endEvent.sensoryOutline?.userConfirmed) {
            step.value = 'sensory-rewrite';
            await runModule('sensory-rewrite');
            return;
          }
          if (isTerminalChapterPipelineRunEnd(module, endEvent)) {
            completeAiTaskProgress(
              aiTaskProgress,
              endEvent.currentModule === 'done' ? '全自动精修完成' : '步骤完成'
            );
            } else if (isRunAll) {
              applyAiTaskProgressEvent(aiTaskProgress, {
                taskKey: 'chapter.pipeline.run-all',
                message: progressLabel.value || '继续执行后续模块…',
              });
            }
          } finally {
            settleOnEnd();
          }
        },
        onError: (message) => {
          errorMessage.value = message;
          failAiTaskProgress(aiTaskProgress, message);
          settleOnEnd();
        },
      },
      { signal }
    );
    await onEndSettled;
    return endEventResult;
  } catch (error) {
    if (handleStreamError(error)) {
      return null;
    }
    errorMessage.value = error instanceof Error ? error.message : '执行失败';
    failAiTaskProgress(aiTaskProgress, errorMessage.value);
    presentErrorFromCaught(error, '创作精修执行失败');
    return null;
  } finally {
    running.value = false;
    endStream();
    settleOnEnd();
  }
}

function resolveRunModuleAfterOutlineConfirm(
  outlineType: ChapterPipelineOutlineType
): ChapterPipelineRunModule {
  switch (outlineType) {
    case 'character':
      return 'character';
    case 'character-traits':
      return 'character-traits';
    default:
      return 'sensory-rewrite';
  }
}

async function confirmOutline() {
  if (!props.chapter || !sessionId.value) {
    return;
  }
  if (isPipelineOutlineEmpty(outlineRequired.value, outlineSuggested.value)) {
    const confirmed = await confirmAction({
      title: '确认空大纲',
      content: '当前无修改项，确认后将保留原文并继续',
      okText: '确认并继续',
    });
    if (!confirmed) {
      return;
    }
  }
  running.value = true;
  try {
    session.value = await apiClient.patchChapterPipelineOutline(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        outlineType: activeOutlineType.value,
        required: outlineRequired.value,
        suggested: outlineSuggested.value,
        confirmed: true,
      }
    );
    const nextModule = resolveRunModuleAfterOutlineConfirm(activeOutlineType.value);
    if (activeOutlineType.value === 'character') {
      step.value = 'character';
    } else if (activeOutlineType.value === 'character-traits') {
      step.value = 'character-traits';
    } else {
      step.value = 'sensory-rewrite';
    }
    await runModule(nextModule);
  } catch (error) {
    presentErrorFromCaught(error, '确认大纲失败');
  } finally {
    running.value = false;
  }
}

async function recheckOutline() {
  if (!props.chapter || !sessionId.value) {
    return;
  }
  running.value = true;
  try {
    const result = await apiClient.reviseChapterPipelineOutline(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        outlineType: activeOutlineType.value,
        mode: 'recheck',
        currentOutline: {
          required: outlineRequired.value,
          suggested: outlineSuggested.value,
        },
      }
    );
    outlineRequired.value = [...result.required];
    outlineSuggested.value = [...result.suggested];
    outlineRevisionRound.value = result.revisionRound;
    await refreshSession();
    presentSuccess('大纲已重新检查，请继续审阅');
  } catch (error) {
    presentErrorFromCaught(error, 'AI 重新检查大纲失败');
  } finally {
    running.value = false;
  }
}

async function reviseOutlineWithFeedback(
  feedback: string,
  successMessage = '大纲已按意见修订，请继续审阅'
) {
  if (!props.chapter || !sessionId.value) {
    return;
  }
  running.value = true;
  try {
    const result = await apiClient.reviseChapterPipelineOutline(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        outlineType: activeOutlineType.value,
        mode: 'revise',
        currentOutline: {
          required: outlineRequired.value,
          suggested: outlineSuggested.value,
        },
        userFeedback: feedback,
      }
    );
    outlineRequired.value = [...result.required];
    outlineSuggested.value = [...result.suggested];
    outlineRevisionRound.value = result.revisionRound;
    await refreshSession();
    presentSuccess(successMessage);
  } catch (error) {
    presentErrorFromCaught(error, 'AI 修订大纲失败');
  } finally {
    running.value = false;
  }
}

const outlineEditorTitle = computed(() => {
  switch (activeOutlineType.value) {
    case 'character':
      return '角色调整大纲';
    case 'character-traits':
      return '角色特征润色大纲';
    default:
      return '感官优化大纲';
  }
});

const outlineEditorHint = computed(() => {
  switch (activeOutlineType.value) {
    case 'character':
      return '审阅拟调整的对白/行为/互动项；可先「重新检查」对照正文，有具体修改点再「按意见修订」。';
    case 'character-traits':
      return '仅补充角色卡明确要求但原文缺失的特征；可先重新检查，再按意见修订或手改后确认改写。';
    default:
      return '请确认必需项；可先重新检查对照正文，有具体修改点再按意见修订。';
  }
});

function resolveRetryModule(currentStep: PipelineStep): ChapterPipelineRunModule | null {
  switch (currentStep) {
    case 'character':
      return 'character';
    case 'character-traits':
      return 'character-traits';
    case 'sensory-rewrite':
      return 'sensory-rewrite';
    case 'homogenization':
      return 'homogenization-rewrite';
    default:
      return null;
  }
}

const canRetryCurrentStep = computed(() =>
  Boolean(
    resolveRetryModule(step.value) &&
    showResultPreview.value &&
    !isOutlineStep.value &&
    !running.value
  )
);

const canEditStepPreview = computed(() => Boolean(stepVersionKey.value));

const showStepActions = computed(() => {
  if (running.value || step.value === 'ready' || isOutlineStep.value || step.value === 'done') {
    return false;
  }
  if (pipelineIncomplete.value) {
    return true;
  }
  return canEditStepPreview.value && showResultPreview.value;
});

const continueButtonLabel = computed(() =>
  pipelineIncomplete.value ? '继续下一步（后续模块）' : '完成精修并进入应用'
);

const activeRewriteReviseModule = computed((): ChapterPipelineRewriteReviseModule | null => {
  if (step.value === 'character') {
    return 'character';
  }
  if (step.value === 'sensory-rewrite') {
    return 'sensory-rewrite';
  }
  return null;
});

const showRewriteRevisePanel = computed(
  () => Boolean(activeRewriteReviseModule.value && showResultPreview.value && !running.value)
);

const rewriteReviseFeedbackLabel = computed(() =>
  step.value === 'character' ? '修改意见（AI 按意见再改）' : '修改意见（AI 按意见再改）'
);

const rewriteReviseFeedbackPlaceholder = computed(() =>
  step.value === 'character'
    ? '例如：男主对白再冷一点，女主反应别太突兀'
    : '例如：第 3 段嗅觉描写过重，减轻一些；保留触觉细节'
);

const rewriteReviseSuccessMessage = computed(() =>
  step.value === 'character' ? '角色正文已按意见修订' : '感官正文已按意见修订'
);

async function persistStepPreviewText(
  options: { requireContent?: boolean } = {}
): Promise<boolean> {
  const key = stepVersionKey.value;
  if (!key || !props.chapter || !sessionId.value) {
    if (options.requireContent) {
      throw new Error('当前步骤不可保存');
    }
    return false;
  }
  const text = stepPreviewText.value.trim();
  if (!text) {
    if (options.requireContent) {
      throw new Error('正文为空，无法保存');
    }
    return false;
  }
  if (session.value?.versions[key] === text) {
    return true;
  }
  session.value = await apiClient.patchChapterPipelineVersion(
    props.projectId,
    props.chapter.chapterNo,
    sessionId.value,
    { versionKey: key, text }
  );
  return true;
}

async function handleSaveStepEdits() {
  try {
    await persistStepPreviewText({ requireContent: true });
    presentSuccess('已保存当前步骤正文');
  } catch (error) {
    presentErrorFromCaught(error, '保存失败');
  }
}

async function handleContinueNext() {
  await persistStepPreviewText();
  const outline = coverageOutlineState.value;
  if (
    outline &&
    !isPipelineOutlineEmpty(outline.required, outline.suggested) &&
    !areRequiredOutlineItemsResolved(outline.required)
  ) {
    const missed = coverageSummary.value?.requiredMissed ?? outline.required.length;
    const confirmed = await confirmAction({
      title: '必需大纲项未全部落实',
      content: `仍有 ${missed} 条必需项未通过验收（未落实或仅部分落实）。继续下一步可能导致遗漏，是否仍要继续？`,
      okText: '仍要继续',
    });
    if (!confirmed) {
      return;
    }
  }
  activeCoverageModule.value = null;
  if (!pipelineIncomplete.value) {
    step.value = 'done';
    return;
  }
  if (!config.value) {
    return;
  }
  const action = resolveManualContinueAction(step.value, config.value, session.value);
  const outlineType = resolveOutlineTypeForStep(action.step);
  if (outlineType) {
    enterOutlineGate(outlineType);
    return;
  }
  step.value = action.step;
  if (action.autoRun && action.module) {
    await runModule(action.module);
  }
}

async function handleRetryCurrentStep() {
  const module = resolveRetryModule(step.value);
  if (!module) {
    return;
  }
  streamingText.value = '';
  await runModule(module);
}

async function reviseRewriteWithFeedback() {
  const module = activeRewriteReviseModule.value;
  if (!module || !props.chapter || !sessionId.value || running.value) {
    return;
  }
  const feedback = rewriteReviseFeedback.value.trim();
  if (!feedback) {
    return;
  }
  await persistStepPreviewText();
  running.value = true;
  errorMessage.value = '';
  streamingText.value = '';
  const taskKey =
    module === 'character'
      ? 'chapter.pipeline.character.revise'
      : 'chapter.pipeline.sensory-rewrite.revise';
  bindActivityInterrupt();
  startAiTaskProgress(aiTaskProgress, {
    source: 'dialog:pipeline',
    chapterNo: props.chapter?.chapterNo ?? null,
    interruptible: true,
    taskKey,
    message: module === 'character' ? '角色正文按意见修订中…' : '感官正文按意见修订中…',
  });
  const signal = beginStream();

  try {
    await apiClient.reviseChapterPipelineRewriteSSE(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        module,
        userFeedback: feedback,
        draftTextOverride: stepPreviewText.value.trim() || undefined,
      },
      {
        onStart: ({ stage }) => {
          streamingText.value = '';
          progressLabel.value = formatPipelineStageLabel(stage);
        },
        onStage: ({ stage, segmentIndex, segmentTotal }) => {
          progressLabel.value = formatPipelineStageLabel(stage, segmentIndex, segmentTotal);
          applyAiTaskProgressEvent(aiTaskProgress, {
            taskKey,
            stage,
            message: progressLabel.value,
            currentStep: segmentIndex,
            totalSteps: segmentTotal,
          });
        },
        onContent: (text) => {
          streamingText.value += text;
        },
        onEnd: async (event) => {
          const endEvent = event as PipelineEndEvent;
          await refreshSession();
          applyEndVersionText(endEvent);
          rewriteReviseFeedback.value = '';
          completeAiTaskProgress(aiTaskProgress, rewriteReviseSuccessMessage.value);
          presentSuccess(rewriteReviseSuccessMessage.value);
          await maybeAutoVerifyCoverageAfterRewrite();
        },
        onError: (message) => {
          errorMessage.value = message;
          failAiTaskProgress(aiTaskProgress, message);
        },
      },
      { signal }
    );
  } catch (error) {
    if (handleStreamError(error)) {
      return;
    }
    errorMessage.value = error instanceof Error ? error.message : '正文按意见修订失败';
    failAiTaskProgress(aiTaskProgress, errorMessage.value);
    presentErrorFromCaught(
      error,
      module === 'character' ? '角色正文按意见修订失败' : '感官正文按意见修订失败'
    );
  } finally {
    running.value = false;
    endStream();
  }
}

async function handleApply() {
  if (!props.chapter || !sessionId.value) {
    return;
  }
  applying.value = true;
  try {
    await persistStepPreviewText();
    const result = await apiClient.applyChapterPipeline(
      props.projectId,
      props.chapter.chapterNo,
      sessionId.value,
      {
        expectedChapterUpdatedAt: chapterUpdatedAtSnapshot.value,
        preserveSummary: true,
        useVersion: 'final',
        draftTextOverride:
          step.value === 'done' && stepPreviewText.value.trim()
            ? stepPreviewText.value.trim()
            : undefined,
      }
    );
    presentSuccess('创作精修已应用');
    emit('applied', result.chapter);
    emit('close');
  } catch (error) {
    presentErrorFromCaught(error, '应用失败');
  } finally {
    applying.value = false;
  }
}

function applyPipelineStepFromEnd(event: PipelineEndEvent) {
  if (event.characterOutline && !event.characterOutline.userConfirmed) {
    applyOutlineToEditor('character', event.characterOutline);
    step.value = 'character-outline';
    return;
  }
  if (event.characterTraitsOutline && !event.characterTraitsOutline.userConfirmed) {
    applyOutlineToEditor('character-traits', event.characterTraitsOutline);
    step.value = 'character-traits-outline';
    return;
  }
  if (event.sensoryOutline && !event.sensoryOutline.userConfirmed) {
    applyOutlineToEditor('sensory', event.sensoryOutline);
    step.value = 'sensory-outline';
    return;
  }
  if (event.currentModule === 'done' || event.versionKey === 'final') {
    step.value = 'done';
    return;
  }
  switch (event.versionKey) {
    case 'afterCharacter':
      step.value = 'character';
      return;
    case 'afterCharacterTraits':
      step.value = 'character-traits';
      return;
    case 'afterSensory':
      step.value = 'sensory-rewrite';
      return;
    default:
      break;
  }
  if (event.homogenizationReport) {
    step.value = 'homogenization';
    return;
  }
  if (typeof event.currentModule === 'number') {
    if (event.currentModule >= 4) {
      step.value = 'homogenization';
      return;
    }
    if (event.currentModule >= 2) {
      step.value = 'sensory-rewrite';
      return;
    }
    step.value = 'character';
  }
}
</script>

<template>
  <a-modal
    :open="props.visible"
    :width="modalWidth"
    :title="`创作精修${props.chapter ? ` · 第${props.chapter.chapterNo}章` : ''}`"
    :footer="null"
    :mask-closable="true"
    :closable="true"
    destroy-on-close
    @cancel="close"
  >
    <p class="modal-subtitle">
      默认链：特征润色 →
      感官优化；硬规则请用「终稿合规检验」。中间版本仅在会话内流转，应用后才写入章节正文。
    </p>

    <ol class="stepper">
      <li
        v-for="(item, index) in pipelineSteps"
        :key="`${item.key}-${index}`"
        :class="{ active: isStepActive(index), done: isStepDone(index) }"
      >
        <span class="stepper-no">{{ index + 1 }}</span>
        <span>{{ item.label }}</span>
      </li>
    </ol>

    <div v-if="running" class="stream-actions">
      <SseInterruptButton
        @interrupt="
          () => {
            interruptStream();
    clearActivityInterrupt();
            running = false;
          }
        "
      />
    </div>
    <AiTaskProgressPanel :progress="aiTaskProgress" show-trace-on-error />
    <p v-if="progressLabel" class="meta-line progress-line">{{ progressLabel }}</p>
    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>

    <section v-if="step === 'ready'" class="step-section">
      <p class="intro-text">
        勾选本次要执行的精修模块（默认取自项目设置，可按章覆盖）。启动前会弹出检索预览确认角色卡；感官/角色大纲支持人工
        gate。发布前硬规则请使用「终稿合规检验」。
      </p>
      <div class="module-run-selection">
        <h4 class="section-title">本次精修模块</h4>
        <label class="module-check">
          <input
            v-model="runModuleSelection.characterAdjustment"
            type="checkbox"
            :disabled="isBusy"
          />
          角色对白调整
        </label>
        <label class="module-check">
          <input v-model="runModuleSelection.characterTraits" type="checkbox" :disabled="isBusy" />
          角色特征润色
        </label>
        <label class="module-check">
          <input v-model="runModuleSelection.sensory" type="checkbox" :disabled="isBusy" />
          感官优化
        </label>
        <label class="module-check">
          <input v-model="runModuleSelection.homogenization" type="checkbox" :disabled="isBusy" />
          同质化检测
        </label>
      </div>
      <p v-if="!moduleSelectionValid" class="message message-error">
        请至少勾选一个精修模块
      </p>
      <label class="field-label" for="pipeline-optimization-intent">整体优化意图（可选）</label>
      <textarea
        id="pipeline-optimization-intent"
        v-model="optimizationIntent"
        class="intent-textarea"
        rows="4"
        maxlength="2000"
        placeholder="例如：加强心理描写、收紧节奏、突出两人张力……将注入各模块大纲与意向书合成"
        :disabled="isBusy"
      />
      <p v-if="selectedPersonaNames.length" class="meta-line">
        已选角色：{{ selectedPersonaNames.join('、') }}
      </p>
      <div class="step-actions">
        <button class="secondary-button" type="button" :disabled="isBusy" @click="close">
          取消
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="isBusy || !moduleSelectionValid"
          title="按项目设置跳过 gate，自动跑完当前勾选链"
          @click="handleStart(true)"
        >
          {{ running ? '执行中…' : '全自动精修' }}
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="isBusy || !moduleSelectionValid"
          @click="handleStart()"
        >
          {{ running ? '启动中…' : '开始创作精修' }}
        </button>
      </div>
    </section>

    <OutlineReviewLayout
      v-else-if="isOutlineStep"
      :reference-text="outlineReferenceText"
      :reference-label="outlineReferenceLabel"
    >
      <PipelineOutlineEditor
        v-model:required="outlineRequired"
        v-model:suggested="outlineSuggested"
        :title="outlineEditorTitle"
        :hint="outlineEditorHint"
        :busy="isBusy"
        :generated="outlineGenerated"
        generate-label="生成大纲"
        :revision-round="outlineRevisionRound"
        :embed-reference="false"
        @generate="handleGenerateOutline"
        @confirm="confirmOutline"
        @recheck="recheckOutline"
        @revise="reviseOutlineWithFeedback"
      />
    </OutlineReviewLayout>

    <section v-if="streamingText && running" class="step-section">
      <h4 class="section-title">生成预览</h4>
      <div class="stream-preview markdown-pane">
        <MarkdownContent :source="streamingText" :throttle-ms="200" />
      </div>
    </section>

    <section v-if="showBriefPanel && !running" class="step-section brief-section">
      <PipelineBriefPanel
        v-model="briefDraft"
        :brief-edited-by-user="briefEditedByUser"
        :busy="isBusy"
        :synthesizing="briefSynthesizing"
        @save="handleSaveBrief"
        @resynthesize="handleResynthesizeBrief"
      />
    </section>

    <section v-if="showCoverageChecklist && !running" class="step-section coverage-section">
      <OutlineCoverageChecklist
        :required="coverageRequired"
        :suggested="coverageSuggested"
        :summary="coverageSummary"
        :busy="isBusy"
        :verifying="coverageVerifying"
        @verify="runCoverageVerify(true)"
        @fix-items="handleFixCoverageItems"
        @patch-coverage="handlePatchCoverage"
      />
    </section>

    <section v-if="showResultPreview" class="step-section result-preview-section">
      <h4 class="section-title">{{ step === 'done' ? '精修结果' : '与原文对比' }}</h4>
      <div v-if="hasResultDiff" class="diff-summary">
        <span class="diff-badge diff-added">+{{ diffAddedCount }} 新增</span>
        <span class="diff-badge diff-removed">-{{ diffRemovedCount }} 删除</span>
        <span class="diff-badge diff-modified">~{{ diffModifiedCount }} 修改</span>
      </div>
      <div v-if="hasResultDiff" class="preview-toggle">
        <button
          type="button"
          class="preview-toggle-btn"
          :class="{ active: previewMode === 'final' }"
          @click="previewMode = 'final'"
        >
          最终正文
        </button>
        <button
          type="button"
          class="preview-toggle-btn"
          :class="{ active: previewMode === 'diff' }"
          @click="previewMode = 'diff'"
        >
          对比视图
        </button>
      </div>
      <p v-if="previewMode === 'final' && stepVersionKey" class="meta-line editable-hint">
        可直接编辑正文；继续下一步或应用前会自动保存到当前步骤版本。
      </p>
      <textarea
        v-if="previewMode === 'final' || !hasResultDiff"
        v-model="stepPreviewText"
        class="final-editor"
        :class="{ 'final-preview-done': step === 'done' }"
        rows="18"
        :readonly="!stepVersionKey"
        :disabled="isBusy || !stepVersionKey"
      />
      <div v-else class="draft-compare-grid">
        <div class="compare-pane">
          <p class="field-label">原文（快照）</p>
          <div class="scroll-pane full-text-pane">
            <template v-for="(seg, idx) in inlineDiff.originalSegments" :key="'o-' + idx">
              <span :class="{ 'diff-removed-text': seg.removed }">{{ seg.text }}</span>
            </template>
          </div>
        </div>
        <div class="compare-pane">
          <p class="field-label">精修正文</p>
          <div class="scroll-pane full-text-pane">
            <template v-for="(seg, idx) in inlineDiff.draftSegments" :key="'d-' + idx">
              <span :class="{ 'diff-added-text': seg.added }">{{ seg.text }}</span>
            </template>
          </div>
        </div>
      </div>
      <p v-if="hasResultDiff" class="meta-line compare-hint">
        红色删除线 = 原文有而精修删去；绿色 = 精修新增。两侧均为完整正文，不会漏段。
      </p>
      <div v-if="showRewriteRevisePanel" class="revise-block">
        <label class="field-label" for="rewrite-revise-feedback">{{ rewriteReviseFeedbackLabel }}</label>
        <textarea
          id="rewrite-revise-feedback"
          v-model="rewriteReviseFeedback"
          class="feedback-input"
          rows="3"
          maxlength="2000"
          :placeholder="rewriteReviseFeedbackPlaceholder"
          :disabled="isBusy"
        />
        <button
          class="secondary-button"
          type="button"
          :disabled="isBusy || !rewriteReviseFeedback.trim()"
          @click="reviseRewriteWithFeedback"
        >
          {{ running ? '修订中…' : 'AI 按意见再改' }}
        </button>
      </div>
    </section>

    <div v-if="showStepActions" class="step-actions">
      <button
        v-if="canEditStepPreview && showResultPreview"
        class="secondary-button"
        type="button"
        :disabled="isBusy"
        @click="handleSaveStepEdits"
      >
        保存编辑
      </button>
      <button
        v-if="canRetryCurrentStep"
        class="secondary-button"
        type="button"
        :disabled="isBusy"
        @click="handleRetryCurrentStep"
      >
        重试当前步
      </button>
      <button class="primary-button" type="button" :disabled="isBusy" @click="handleContinueNext">
        {{ continueButtonLabel }}
      </button>
    </div>

    <p v-if="step === 'done'" class="field-hint compliance-hint">
      应用前请确认正文质量；发布前硬规则请再运行「终稿合规检验」。
    </p>

    <div v-if="step === 'done'" class="step-actions">
      <button class="secondary-button" type="button" :disabled="isBusy" @click="close">取消</button>
      <button class="primary-button" type="button" :disabled="applying" @click="handleApply">
        {{ applying ? '应用中…' : '应用最终版' }}
      </button>
    </div>
  </a-modal>

  <RetrievalPreviewDialog
    :visible="previewVisible"
    :loading="previewLoading"
    :result="previewResult"
    :error-message="previewError"
    :z-index="1300"
    @close="previewVisible = false"
    @confirm="confirmPersonaPreviewAndStart"
  />
</template>

<style scoped>
.modal-subtitle {
  margin: 0 0 1rem;
  color: #6b7280;
  font-size: 0.85rem;
}

.stepper {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.5rem;
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  font-size: 0.85rem;
  color: #9ca3af;
}

.stepper li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.stepper li.active {
  color: #111827;
  font-weight: 600;
}

.stepper li.done {
  color: #059669;
}

.stepper-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  background: #e5e7eb;
  color: #4b5563;
  font-size: 0.75rem;
  flex-shrink: 0;
}

.stepper li.active .stepper-no {
  background: #111827;
  color: #fff;
}

.stepper li.done .stepper-no {
  background: #059669;
  color: #fff;
}

.message {
  margin: 0 0 0.8rem;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  font-size: 0.85rem;
}

.message-error {
  background: #fef2f2;
  color: #991b1b;
}

.meta-line {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  color: #6b7280;
}

.progress-line {
  color: #374151;
}

.step-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-title {
  margin: 0;
  font-size: 0.95rem;
  color: #111827;
}

.intro-text {
  margin: 0;
  font-size: 0.9rem;
  color: #4b5563;
  line-height: 1.55;
}

.module-run-selection {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem 1rem;
  margin: 0.75rem 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.module-check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  color: #374151;
  cursor: pointer;
  user-select: none;
}

.intent-textarea {
  width: 100%;
  min-height: 5.5rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.9rem;
  line-height: 1.5;
  resize: vertical;
}

.field-hint {
  margin: 0;
  font-size: 0.8rem;
  color: #6b7280;
  line-height: 1.5;
}

.compliance-hint {
  margin-bottom: 0.5rem;
}

.outline-panel {
  display: grid;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.outline-label {
  margin: 0 0 0.45rem;
  font-size: 0.8rem;
  font-weight: 600;
}

.outline-label.required {
  color: #b45309;
}

.outline-label.suggested {
  color: #1d4ed8;
}

.outline-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.88rem;
  color: #374151;
  line-height: 1.55;
}

.outline-item-row {
  margin-bottom: 0.45rem;
}

.outline-item-body {
  flex: 1;
  min-width: 0;
}

.outline-warnings {
  margin: 0.35rem 0 0;
  padding-left: 1rem;
  list-style: disc;
  font-size: 0.78rem;
  color: #b45309;
}

.outline-suggested-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}

.empty-hint {
  margin: 0;
  font-size: 0.82rem;
  color: #9ca3af;
}

.text-button {
  border: none;
  background: transparent;
  color: #2563eb;
  font-size: 0.8rem;
  cursor: pointer;
  flex-shrink: 0;
}

.text-button:hover {
  text-decoration: underline;
}

.issue-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.issue-item {
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid #f3f4f6;
  background: #fff;
}

.issue-item:last-child {
  border-bottom: none;
}

.issue-item.manual {
  border-left: 3px solid #ef4444;
}

.issue-item.ai_segment {
  border-left: 3px solid #f59e0b;
}

.issue-item.auto {
  border-left: 3px solid #22c55e;
}

.issue-item.is-fixed {
  opacity: 0.72;
  background: #f9fafb;
}

.issue-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  margin-bottom: 0.25rem;
}

.issue-category {
  font-size: 0.72rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.issue-strategy {
  font-size: 0.72rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: #f3f4f6;
  color: #4b5563;
}

.issue-fixed-badge {
  font-size: 0.72rem;
  color: #059669;
}

.issue-text {
  margin: 0;
  font-size: 0.88rem;
  color: #111827;
}

.issue-context {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: #9ca3af;
}

.stream-preview {
  margin: 0;
  max-height: 200px;
  overflow: auto;
  padding: 0.65rem 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
  font-size: 0.82rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.diff-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.preview-toggle {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}

.preview-toggle-btn {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #4b5563;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.preview-toggle-btn.active {
  border-color: #111827;
  background: #111827;
  color: #fff;
}

.final-preview {
  margin: 0;
  max-height: 280px;
  overflow: auto;
  padding: 0.75rem 0.85rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
  font-size: 0.88rem;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.final-preview-done {
  max-height: 420px;
}

.final-editor {
  width: 100%;
  min-height: 280px;
  padding: 0.75rem 0.85rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  font-size: 0.88rem;
  line-height: 1.65;
  resize: vertical;
  font-family: inherit;
}

.final-editor.final-preview-done {
  min-height: 360px;
}

.final-editor:disabled {
  background: #f3f4f6;
  cursor: not-allowed;
}

.editable-hint {
  margin-bottom: 0.35rem;
}

.result-preview-section {
  margin-top: 0.25rem;
}

.field-label {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: #6b7280;
}

.revise-block {
  margin-top: 0.75rem;
  display: grid;
  gap: 0.5rem;
}

.feedback-input {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem;
  font-size: 0.88rem;
  font-family: inherit;
  resize: vertical;
}

.draft-compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.compare-pane {
  min-width: 0;
}

.scroll-pane {
  max-height: 360px;
  overflow: auto;
  padding: 0.65rem 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
  font-size: 0.82rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.full-text-pane {
  margin: 0;
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}

.compare-hint {
  margin-top: 0.35rem;
}

.diff-line {
  min-height: 1.6em;
}

.line-added,
.line-removed,
.line-modified,
.line-modified-original {
  padding-left: 0.65rem;
  border-left: 3px solid transparent;
  margin-left: -3px;
}

.line-added {
  background: #dcfce7;
  border-left-color: #22c55e;
}

.line-removed {
  background: #fee2e2;
  border-left-color: #ef4444;
}

.line-modified {
  background: #fef9c3;
  border-left-color: #eab308;
}

.line-modified-original {
  background: #fee2e2;
  border-left-color: #ef4444;
}

.diff-removed-text {
  text-decoration: line-through;
  color: #dc2626;
  opacity: 0.9;
}

.diff-added-text {
  color: #166534;
  font-weight: 500;
}

.diff-badge {
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.diff-added {
  background: #dcfce7;
  color: #166534;
}

.diff-removed {
  background: #fee2e2;
  color: #991b1b;
}

.diff-modified {
  background: #fef9c3;
  color: #854d0e;
}

.step-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.5rem 0.9rem;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
}

.primary-button {
  background: #111827;
  color: #fff;
  border: none;
}

.secondary-button {
  background: #fff;
  color: #111827;
  border: 1px solid #d1d5db;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
