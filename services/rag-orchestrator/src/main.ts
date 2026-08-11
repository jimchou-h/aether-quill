/**
 * RAG Orchestrator — HTTP 入口与生成流水线编排
 *
 * ## 服务职责
 *
 * API 服务（NestJS）在写作/优化前会把项目快照 POST 到 `/api/projects/:id/context`，
 * 本服务在内存中维护 `projectContextStore`，供检索与 prompt 拼装读取。
 *
 * ## 两条主生成链路
 *
 * 1. **POST /api/generate** — 通用生成（续写、章节优化 plan/draft、大纲等）
 *    - 有 `chapterNo` 锚定 → 标题匹配 + 向量补足合并（AQ-360）；无 structuredMatchingText 时向量兜底
 *    - 无章节锚定 → 走向量检索：embedding → Qdrant topK → Reranker topN → 证据块
 * 2. **POST /api/generate/draft** — 写作工作台正文（须先有 `confirmedOutlineText`）
 *    - 同样走融合检索；无匹配文本时向量兜底
 *
 * ## 上下文 vs 证据（写入 LLM prompt 的两段）
 *
 * - **叙事上下文**（`narrative-context`）：前章衔接、人物快照、近期摘要、语义记忆、大纲、关系备忘
 * - **检索证据**（`knowledge-retrieval`）：向量 chunk 或标题匹配后的知识库全文/裁剪段落
 *
 * ## 目录对照
 *
 * - `context/`   — 叙事上下文拼装、人物快照、章节摘要向量记忆
 * - `retrieval/` — 向量检索、重排、标题匹配、token 预算裁剪
 * - `generation/`— Prompt 拼装、LLM 调用、Trace、各类抽取任务
 * - `consistency/` — 生成后轻量规则检查（非 LLM）
 */

import { loadEnv } from './config/load-env';
import {
  assertGenerationProfileEnv,
  assertRagInfrastructureEnv,
  formatContentSafetyBlockMessage,
  getResolvedRagInfrastructureEnv,
  mergeContentSafetyRules,
  processContentSafety,
  sanitizeProjectContentSafetyRules,
  sanitizeWritingStyleSamples,
  buildStyleSamplePromptBlock,
  isWritingStyleInjectionTemplateKey,
  selectWritingStyleSamplesForTask,
  normalizeGenerationModelId,
  resolveGenerationCallProfile,
  resolveWritingGenerationTemperatureOverride,
  normalizeUserGenerationPreferences,
  type ProjectContentSafetyRule,
  type ResolvedGenerationCallProfile,
  type UserGenerationPreferences,
  type WritingStyleSample,
} from '@aether-quill/config';
import express from 'express';
import { VectorStore } from './retrieval/vector-store';
import { Reranker } from './retrieval/reranker';
import {
  buildChapterOptimizeRetrievalQuery,
  buildEmbeddingRetrievalQuery,
  buildGenerationRetrievalQuery,
  buildRetrievalQuery,
  CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
  isChapterOptimizeTemplateKey,
  WRITE_CHAPTER_DRAFT_TEMPLATE_KEY,
  WRITE_CHAPTER_OUTLINE_TEMPLATE_KEY,
  DraftCitation,
  buildStructuredKnowledgeEvidence,
  resolveChapterScopedEmbeddingQuery,
  retrieveKnowledgeForDraft,
} from './retrieval/knowledge-retrieval';
import { mergeTitleAndVectorEvidence } from './retrieval/hybrid-knowledge-merge';
import { GenerationService, GenerationContext } from './generation/generation.service';
import { assembleSystemMessageContent } from './generation/system-prompt.util';
import { resolveTaskSystemPromptFromContext } from './generation/task-prompt-defaults';
import {
  assertConfirmedOutlineText,
  buildWorkbenchDraftUserPrompt,
} from './generation/write-chapter-prompt';
import { indexChapterSummaryInQdrant } from './context/chapter-summary-memory';
import { buildNarrativeContextText, type NarrativeContextMeta } from './context/narrative-context';
import { type PersonaContextPayload } from './context/persona-snapshot';
import { runPreviewRetrieval, type PreviewRetrievalRequest } from './retrieval/preview-retrieval';
import {
  listPersonaCardsFromKnowledgeDocs,
  mapChaptersForStructuredKnowledgeMatch,
  parseAppearingCharactersFromExtra,
  shouldApplyChapterOptimizeMatchingBoost,
} from './retrieval/optimize-matching-text';
import {
  clampChapterSummaryMemoryCount,
  clampChapterSummaryPromptCount,
  clampContextExcerptMaxChars,
  clampGenerationTemperature,
  clampOutlineMaxChars,
  clampPersonaProfileMaxChars,
  clampPriorChapterTailChars,
  clampRelationMemoMaxChars,
  DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
  DEFAULT_CONTEXT_EXCERPT_MAX_CHARS,
  DEFAULT_GENERATION_TEMPERATURE,
  DEFAULT_OUTLINE_MAX_CHARS,
  DEFAULT_PERSONA_PROFILE_MAX_CHARS,
  DEFAULT_PRIOR_CHAPTER_TAIL_CHARS,
  DEFAULT_RELATION_MEMO_MAX_CHARS,
} from './context/generation-preferences';
import { ConsistencyChecker } from './consistency';
import {
  logger,
  metrics,
  startSpan,
  endSpan,
  getSpansByTrace,
  getActiveSpanCount,
  observabilityMiddleware,
  observabilityErrorHandler,
  RequestWithObservability,
} from './observability';

loadEnv();
assertRagInfrastructureEnv('rag-orchestrator');
assertGenerationProfileEnv('rag-orchestrator');
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(observabilityMiddleware);

const PORT = process.env.PORT || 3001;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

const vectorStore = new VectorStore();
const reranker = new Reranker();
const generationService = new GenerationService();
const consistencyChecker = new ConsistencyChecker();

const CHAPTER_COMPLIANCE_OUTLINE_TEMPLATE_KEY = 'chapter.compliance.outline';
const CHAPTER_COMPLIANCE_REWRITE_TEMPLATE_KEY = 'chapter.compliance.rewrite';

function isComplianceTemplateKey(templateKey: string): boolean {
  return (
    templateKey === CHAPTER_COMPLIANCE_OUTLINE_TEMPLATE_KEY ||
    templateKey === CHAPTER_COMPLIANCE_REWRITE_TEMPLATE_KEY
  );
}

function buildTargetWordsRequirement(targetWords: unknown): string {
  const parsed = Number(targetWords);
  if (Number.isFinite(parsed) && parsed > 0) {
    return `${parsed}字左右`;
  }
  return '不设字数上限，在情节完整的前提下尽量充实详尽';
}

interface ContextChapter {
  chapterNo: number;
  title: string;
  summary: string;
  content?: string;
  contentTail?: string;
  /** 由 API 同步：章节已解析的结构化匹配文本，用于知识库标题匹配 */
  structuredMatchingText?: string;
}

interface KnowledgeDocumentPayload {
  id: string;
  title: string;
  content: string;
  docType?: string;
  personaId?: string | null;
}

interface ProjectContext {
  systemPromptText: string;
  /** 项目已发布 task prompt（templateKey → system 文本） */
  taskPrompts?: Record<string, string>;
  personaProfile: string;
  outlineSummary: string;
  chapters: ContextChapter[];
  /** 叙事上下文注入：当前章之前最近 N 章摘要（0 不注入） */
  chapterSummaryPromptCount: number;
  /** 语义记忆池：向量检索历史章节摘要条数 */
  chapterSummaryMemoryCount: number;
  priorChapterTailChars: number;
  contextExcerptMaxChars: number;
  outlineMaxChars: number;
  personaProfileMaxChars: number;
  relationMemoMaxChars: number;
  /** 主生成链路采样温度 */
  generationTemperature: number;
  /** 项目级写作模型覆盖 */
  generationWritingModel?: string | null;
  /** 项目级工具模型覆盖 */
  generationUtilityModel?: string | null;
  /** 写作级温度覆盖 */
  writingGenerationTemperature?: number | null;
  /** 用户全局生成偏好（厂商/模型/温度，按 writing/utility 档） */
  userGenerationPreferences?: UserGenerationPreferences;
  /** 是否对 AI 正文执行内容安全硬规则扫描 */
  contentSafetyScanEnabled?: boolean;
  /** 项目自定义禁用词 */
  contentSafetyCustomRules?: ProjectContentSafetyRule[];
  /** 项目知识库文档全文列表，用于标题匹配后整文注入 */
  knowledgeDocuments?: KnowledgeDocumentPayload[];
  selectedRelationMemory?: string;
  identityRelationMemory?: string;
  usedRelationEvents?: Array<{
    id: string;
    protagonist: string;
    counterparty: string;
    summary: string;
    evidenceSnippet?: string;
    chapterNo?: number | null;
  }>;
  personas?: PersonaContextPayload[];
  /** 项目文风样本库（写作类任务注入 few-shot 参照） */
  writingStyleSamples?: WritingStyleSample[];
  updatedAt: string;
}

/** 按 projectId 缓存的项目快照；由 API 在生成前通过 POST /context 同步，重启后丢失 */
const projectContextStore = new Map<string, ProjectContext>();

function patchProjectContextDefaults(ctx: ProjectContext) {
  ctx.chapterSummaryPromptCount = clampChapterSummaryPromptCount(ctx.chapterSummaryPromptCount);
  ctx.chapterSummaryMemoryCount = clampChapterSummaryMemoryCount(ctx.chapterSummaryMemoryCount);
  ctx.priorChapterTailChars = clampPriorChapterTailChars(
    ctx.priorChapterTailChars ?? DEFAULT_PRIOR_CHAPTER_TAIL_CHARS
  );
  ctx.contextExcerptMaxChars = clampContextExcerptMaxChars(
    ctx.contextExcerptMaxChars ?? DEFAULT_CONTEXT_EXCERPT_MAX_CHARS
  );
  ctx.outlineMaxChars = clampOutlineMaxChars(ctx.outlineMaxChars ?? DEFAULT_OUTLINE_MAX_CHARS);
  ctx.personaProfileMaxChars = clampPersonaProfileMaxChars(
    ctx.personaProfileMaxChars ?? DEFAULT_PERSONA_PROFILE_MAX_CHARS
  );
  ctx.relationMemoMaxChars = clampRelationMemoMaxChars(
    ctx.relationMemoMaxChars ?? DEFAULT_RELATION_MEMO_MAX_CHARS
  );
  ctx.generationTemperature = clampGenerationTemperature(ctx.generationTemperature);
}

function getOrCreateContext(projectId: string) {
  if (!projectContextStore.has(projectId)) {
    projectContextStore.set(projectId, {
      systemPromptText: '你是一位专业的小说写作助手，请保持设定一致与剧情连贯。',
      personaProfile: '未配置人物设定',
      outlineSummary: '',
      chapters: [],
      chapterSummaryPromptCount: DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
      chapterSummaryMemoryCount: 3,
      priorChapterTailChars: DEFAULT_PRIOR_CHAPTER_TAIL_CHARS,
      contextExcerptMaxChars: DEFAULT_CONTEXT_EXCERPT_MAX_CHARS,
      outlineMaxChars: DEFAULT_OUTLINE_MAX_CHARS,
      personaProfileMaxChars: DEFAULT_PERSONA_PROFILE_MAX_CHARS,
      relationMemoMaxChars: DEFAULT_RELATION_MEMO_MAX_CHARS,
      generationTemperature: DEFAULT_GENERATION_TEMPERATURE,
      contentSafetyScanEnabled: true,
      contentSafetyCustomRules: [],
      updatedAt: new Date().toISOString(),
    });
  }
  const ctx = projectContextStore.get(projectId)!;
  patchProjectContextDefaults(ctx);
  return ctx;
}

function resolveGenerationCallProfileForProject(
  templateKey: string,
  projectCtx: ProjectContext,
  requestTemperature?: unknown
): ResolvedGenerationCallProfile {
  return resolveGenerationCallProfile({
    templateKey,
    projectOverrides: {
      generationWritingModel: projectCtx.generationWritingModel,
      generationUtilityModel: projectCtx.generationUtilityModel,
      generationTemperature: projectCtx.generationTemperature,
      writingGenerationTemperature: projectCtx.writingGenerationTemperature,
    },
    userPreferences: projectCtx.userGenerationPreferences,
    requestTemperature:
      typeof requestTemperature === 'number' && Number.isFinite(requestTemperature)
        ? requestTemperature
        : undefined,
  });
}

function applyWritingStyleSamplesToContext(
  generationContext: GenerationContext,
  projectCtx: ProjectContext,
  templateKey: string,
  chapterNo?: number
): string[] {
  if (!isWritingStyleInjectionTemplateKey(templateKey)) {
    return [];
  }
  const selected = selectWritingStyleSamplesForTask({
    samples: projectCtx.writingStyleSamples ?? [],
    templateKey,
    chapterNo,
  });
  if (selected.length === 0) {
    return [];
  }
  const styleSampleBlock = buildStyleSamplePromptBlock(selected).trim();
  if (styleSampleBlock) {
    generationContext.styleSampleBlock = styleSampleBlock;
  }
  return selected.map((sample) => sample.id);
}

async function getGenerationContext(
  projectId: string,
  currentChapterNo?: number,
  options?: {
    includeNextChapterHead?: boolean;
    appearingCharacters?: string[];
  }
): Promise<GenerationContext & { narrativeMeta?: NarrativeContextMeta }> {
  const ctx = getOrCreateContext(projectId);
  const chapter =
    currentChapterNo && currentChapterNo > 0
      ? ctx.chapters.find((c) => c.chapterNo === currentChapterNo)
      : undefined;
  const built = await buildNarrativeContextText({
    projectId,
    personaProfile: ctx.personaProfile,
    outlineSummary: ctx.outlineSummary,
    chapters: ctx.chapters,
    chapterSummaryPromptCount: ctx.chapterSummaryPromptCount,
    chapterSummaryMemoryCount: ctx.chapterSummaryMemoryCount,
    priorChapterTailChars: ctx.priorChapterTailChars,
    contextExcerptMaxChars: ctx.contextExcerptMaxChars,
    outlineMaxChars: ctx.outlineMaxChars,
    personaProfileMaxChars: ctx.personaProfileMaxChars,
    relationMemoMaxChars: ctx.relationMemoMaxChars,
    selectedRelationMemory: ctx.selectedRelationMemory,
    identityRelationMemory: ctx.identityRelationMemory,
    currentChapterNo,
    personas: ctx.personas,
    knowledgeDocuments: ctx.knowledgeDocuments,
    appearingCharacters: options?.appearingCharacters,
    outlineMatchingQuery: chapter?.structuredMatchingText,
    includeNextChapterHead: options?.includeNextChapterHead,
  });
  return {
    systemPromptText: ctx.systemPromptText,
    narrativeContext: built.text,
    narrativeMeta: built.meta,
  };
}

// ─── 健康检查 & 可观测性 ─────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'rag-orchestrator', timestamp: new Date().toISOString() });
});

app.get('/api/observability/metrics', (_req, res) => {
  const snapshot = metrics.getSnapshot(getActiveSpanCount(), generationService.getTraceCount());
  res.json(snapshot);
});

app.get('/api/observability/logs', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  res.json({ logs: logger.getRecentLogs(limit) });
});

app.get('/api/observability/traces/:traceId', (req, res) => {
  const spans = getSpansByTrace(req.params.traceId);
  if (spans.length === 0) {
    return res.status(404).json({ error: 'Trace not found', traceId: req.params.traceId });
  }
  res.json({ traceId: req.params.traceId, spans });
});

app.get('/', (_req, res) => {
  res.json({ message: 'RAG Orchestrator Service', version: '1.0.0' });
});

// ─── 项目上下文同步（API → 编排层内存快照）────────────────────────────

app.get('/api/projects/:projectId/context', (req, res) => {
  const projectId = req.params.projectId;
  const context = getOrCreateContext(projectId);
  res.json(context);
});

// ─── 章节工具：摘要 / 状态抽取 / 关系抽取 / 结构化解析（均直连 LLM，无 RAG）──

app.post('/api/summarize', async (req, res) => {
  const chapterNo = Number(req.body?.chapterNo || 0);
  const title = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '');

  if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
    res.status(400).json({ message: 'chapterNo 必须为正整数' });
    return;
  }

  if (!content.trim()) {
    res.status(400).json({ message: 'content 不能为空' });
    return;
  }

  try {
    const summary = await generationService.summarizeChapterContent({
      chapterNo,
      title,
      content,
    });
    res.json({ summary });
  } catch (error) {
    console.error('Chapter summarize failed:', error);
    res.status(502).json({ message: '章节摘要生成失败' });
  }
});

app.post('/api/extract/chapter-personas', async (req, res) => {
  const chapterNo = Number(req.body?.chapterNo || 0);
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  const personas = Array.isArray(req.body?.personas) ? req.body.personas : [];

  if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
    res.status(400).json({ message: 'chapterNo 必须为正整数' });
    return;
  }

  if (!content.trim()) {
    res.status(400).json({ message: 'content 不能为空' });
    return;
  }

  const normalizedPersonas = personas
    .map((item: unknown) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const profile = typeof record.profile === 'string' ? record.profile.trim() : '';
      const state = typeof record.state === 'string' ? record.state.trim() : '';
      const priorSnapshot =
        record.priorSnapshot && typeof record.priorSnapshot === 'object'
          ? (record.priorSnapshot as Record<string, unknown>)
          : undefined;
      if (!name) {
        return null;
      }
      return { name, profile, state, priorSnapshot };
    })
    .filter(
      (
        item: {
          name: string;
          profile: string;
          state: string;
          priorSnapshot?: Record<string, unknown>;
        } | null
      ): item is {
        name: string;
        profile: string;
        state: string;
        priorSnapshot?: Record<string, unknown>;
      } => Boolean(item)
    );

  if (normalizedPersonas.length === 0) {
    res.status(400).json({ message: 'personas 不能为空' });
    return;
  }

  try {
    const result = await generationService.extractChapterPersonaStates({
      chapterNo,
      title,
      content,
      personas: normalizedPersonas,
    });
    res.json({ personas: result });
  } catch (error) {
    console.error('Chapter persona state extraction failed:', error);
    res.status(502).json({ message: '章节角色状态批量抽取失败' });
  }
});

app.post('/api/extract/identity-relations', async (req, res) => {
  const chapterNo = Number(req.body?.chapterNo || 0);
  const title = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '');
  const personaNames = Array.isArray(req.body?.personaNames)
    ? req.body.personaNames
        .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : [];

  if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
    res.status(400).json({ message: 'chapterNo 必须为正整数' });
    return;
  }

  if (!content.trim()) {
    res.status(400).json({ message: 'content 不能为空' });
    return;
  }

  try {
    const relations = await generationService.extractChapterIdentityRelations({
      chapterNo,
      title,
      content,
      personaNames,
    });
    res.json({ relations });
  } catch (error) {
    console.error('Identity relation extraction failed:', error);
    res.status(502).json({ message: '身份关系抽取失败' });
  }
});

app.post('/api/extract/relation-events', async (req, res) => {
  const chapterNo = Number(req.body?.chapterNo || 0);
  const title = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '');
  const protagonist = String(req.body?.protagonist || '主角').trim() || '主角';
  const personaNames = Array.isArray(req.body?.personaNames)
    ? req.body.personaNames
        .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : [];

  if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
    res.status(400).json({ message: 'chapterNo 必须为正整数' });
    return;
  }

  if (!content.trim()) {
    res.status(400).json({ message: 'content 不能为空' });
    return;
  }

  try {
    const events = await generationService.extractChapterRelationEvents({
      chapterNo,
      title,
      content,
      protagonist,
      personaNames,
    });
    res.json({ events });
  } catch (error) {
    console.error('Relation event extraction failed:', error);
    res.status(502).json({ message: '关系事件抽取失败' });
  }
});

app.post('/api/parse/structured-info', async (req, res) => {
  const mode = req.body?.mode;
  const sourceText = typeof req.body?.sourceText === 'string' ? req.body.sourceText : '';

  if (mode !== 'workbench' && mode !== 'chapter') {
    res.status(400).json({ message: 'mode 必须为 workbench 或 chapter' });
    return;
  }

  if (!sourceText.trim()) {
    res.status(400).json({ message: 'sourceText 不能为空' });
    return;
  }

  try {
    const parsed = await generationService.extractStructuredInfo({
      mode,
      sourceText,
    });
    res.json(parsed);
  } catch (error) {
    console.error('Structured info parse failed:', error);
    res.status(502).json({ message: '结构化信息解析失败' });
  }
});

app.post('/api/projects/:projectId/context', (req, res) => {
  const projectId = req.params.projectId;
  const context = getOrCreateContext(projectId);
  const payload = req.body as Partial<ProjectContext>;

  if (typeof payload.systemPromptText === 'string') {
    context.systemPromptText = payload.systemPromptText;
  }
  if (payload.taskPrompts && typeof payload.taskPrompts === 'object' && !Array.isArray(payload.taskPrompts)) {
    const taskPrompts: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload.taskPrompts as Record<string, unknown>)) {
      if (typeof key === 'string' && key.trim() && typeof value === 'string' && value.trim()) {
        taskPrompts[key.trim()] = value.trim();
      }
    }
    context.taskPrompts = taskPrompts;
  }
  if (typeof payload.personaProfile === 'string') {
    context.personaProfile = payload.personaProfile;
  }
  if (typeof payload.outlineSummary === 'string') {
    context.outlineSummary = payload.outlineSummary;
  }
  if (Array.isArray(payload.chapters)) {
    context.chapters = payload.chapters;
  }
  if (typeof payload.selectedRelationMemory === 'string') {
    context.selectedRelationMemory = payload.selectedRelationMemory;
  }
  if (typeof payload.identityRelationMemory === 'string') {
    context.identityRelationMemory = payload.identityRelationMemory;
  }
  if (Array.isArray(payload.usedRelationEvents)) {
    context.usedRelationEvents = payload.usedRelationEvents;
  }
  if (Array.isArray(payload.knowledgeDocuments)) {
    const docs: KnowledgeDocumentPayload[] = [];
    for (const row of payload.knowledgeDocuments as unknown[]) {
      if (!row || typeof row !== 'object') {
        continue;
      }
      const r = row as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id.trim() : '';
      const title = typeof r.title === 'string' ? r.title : '';
      const content = typeof r.content === 'string' ? r.content : '';
      if (!id) {
        continue;
      }
      const docType = typeof r.docType === 'string' ? r.docType : undefined;
      const personaIdRaw = r.personaId;
      const personaId =
        typeof personaIdRaw === 'string' && personaIdRaw.trim()
          ? personaIdRaw.trim()
          : personaIdRaw === null
            ? null
            : undefined;
      docs.push({ id, title, content, docType, personaId });
    }
    context.knowledgeDocuments = docs;
  }

  if (payload.chapterSummaryPromptCount !== undefined) {
    context.chapterSummaryPromptCount = clampChapterSummaryPromptCount(
      payload.chapterSummaryPromptCount
    );
  }
  if (payload.chapterSummaryMemoryCount !== undefined) {
    context.chapterSummaryMemoryCount = clampChapterSummaryMemoryCount(
      payload.chapterSummaryMemoryCount
    );
  }
  if (payload.generationTemperature !== undefined) {
    context.generationTemperature = clampGenerationTemperature(payload.generationTemperature);
  }
  if (payload.generationWritingModel !== undefined) {
    context.generationWritingModel =
      payload.generationWritingModel === null
        ? null
        : normalizeGenerationModelId(payload.generationWritingModel);
  }
  if (payload.generationUtilityModel !== undefined) {
    context.generationUtilityModel =
      payload.generationUtilityModel === null
        ? null
        : normalizeGenerationModelId(payload.generationUtilityModel);
  }
  if (payload.writingGenerationTemperature !== undefined) {
    context.writingGenerationTemperature =
      payload.writingGenerationTemperature === null
        ? null
        : resolveWritingGenerationTemperatureOverride(payload.writingGenerationTemperature);
  }
  if (payload.userGenerationPreferences !== undefined) {
    try {
      context.userGenerationPreferences = normalizeUserGenerationPreferences(
        payload.userGenerationPreferences
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Invalid userGenerationPreferences';
      res.status(400).json({ error: message });
      return;
    }
  }
  if (payload.contentSafetyScanEnabled !== undefined) {
    context.contentSafetyScanEnabled = Boolean(payload.contentSafetyScanEnabled);
  }
  if (payload.contentSafetyCustomRules !== undefined) {
    context.contentSafetyCustomRules = sanitizeProjectContentSafetyRules(
      payload.contentSafetyCustomRules
    );
  }
  if (payload.priorChapterTailChars !== undefined) {
    context.priorChapterTailChars = clampPriorChapterTailChars(payload.priorChapterTailChars);
  }
  if (payload.contextExcerptMaxChars !== undefined) {
    context.contextExcerptMaxChars = clampContextExcerptMaxChars(payload.contextExcerptMaxChars);
  }
  if (payload.outlineMaxChars !== undefined) {
    context.outlineMaxChars = clampOutlineMaxChars(payload.outlineMaxChars);
  }
  if (payload.personaProfileMaxChars !== undefined) {
    context.personaProfileMaxChars = clampPersonaProfileMaxChars(payload.personaProfileMaxChars);
  }
  if (payload.relationMemoMaxChars !== undefined) {
    context.relationMemoMaxChars = clampRelationMemoMaxChars(payload.relationMemoMaxChars);
  }
  if (Array.isArray(payload.personas)) {
    context.personas = payload.personas
      .map((row: unknown): PersonaContextPayload | null => {
        if (!row || typeof row !== 'object') {
          return null;
        }
        const record = row as Record<string, unknown>;
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        if (!name) {
          return null;
        }
        const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined;
        const profile = typeof record.profile === 'string' ? record.profile : '';
        const state = typeof record.state === 'string' ? record.state : '';
        const status = record.status === 'published' ? 'published' : 'draft';
        const chapterStates = Array.isArray(record.chapterStates)
          ? record.chapterStates.flatMap((item: unknown) => {
              if (!item || typeof item !== 'object') {
                return [];
              }
              const cs = item as Record<string, unknown>;
              const chapterNo = Number(cs.chapterNo);
              if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
                return [];
              }
              const snapshotRaw =
                cs.snapshot && typeof cs.snapshot === 'object'
                  ? (cs.snapshot as Record<string, unknown>)
                  : {};
              return [
                {
                  chapterNo,
                  appeared: cs.appeared === true,
                  snapshot: {
                    clothing:
                      typeof snapshotRaw.clothing === 'string' ? snapshotRaw.clothing : undefined,
                    appearance:
                      typeof snapshotRaw.appearance === 'string'
                        ? snapshotRaw.appearance
                        : undefined,
                    status: typeof snapshotRaw.status === 'string' ? snapshotRaw.status : undefined,
                    location:
                      typeof snapshotRaw.location === 'string' ? snapshotRaw.location : undefined,
                    possessions:
                      typeof snapshotRaw.possessions === 'string'
                        ? snapshotRaw.possessions
                        : undefined,
                  },
                  summaryLine: typeof cs.summaryLine === 'string' ? cs.summaryLine : '',
                  updatedAt:
                    typeof cs.updatedAt === 'string' ? cs.updatedAt : new Date().toISOString(),
                },
              ];
            })
          : undefined;
        return { id, name, profile, state, status, chapterStates };
      })
      .filter((item): item is PersonaContextPayload => Boolean(item));
  }
  if (payload.writingStyleSamples !== undefined) {
    context.writingStyleSamples = sanitizeWritingStyleSamples(payload.writingStyleSamples);
  }

  context.updatedAt = new Date().toISOString();
  res.json(context);
});

// ─── 检索预览 & 章节摘要向量索引 ─────────────────────────────────────

app.post('/api/preview-retrieval', async (req, res) => {
  const body = req.body as {
    projectId?: string;
    prompt?: string;
    chapterNo?: number;
    useStructuredKb?: boolean;
    retrievalMode?: PreviewRetrievalRequest['retrievalMode'];
    projectCtx?: PreviewRetrievalRequest['projectCtx'];
    extraContext?: Record<string, unknown>;
  };

  if (!body.projectId || !body.projectCtx) {
    return res.status(400).json({ error: 'projectId and projectCtx are required' });
  }

  try {
    const result = await runPreviewRetrieval(vectorStore, reranker, API_BASE_URL, {
      projectId: body.projectId,
      prompt: body.prompt,
      chapterNo: body.chapterNo,
      useStructuredKb: body.useStructuredKb,
      retrievalMode: body.retrievalMode,
      projectCtx: body.projectCtx,
      extraContext: body.extraContext,
    });
    res.json(result);
  } catch (error) {
    console.error('Preview retrieval failed:', error);
    res.status(500).json({ error: 'Preview retrieval failed' });
  }
});

app.post('/api/projects/:projectId/chapters/:chapterNo/index-summary', async (req, res) => {
  const projectId = req.params.projectId;
  const chapterNo = Number(req.params.chapterNo);
  const { title, summary } = req.body as { title?: string; summary?: string };

  if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
    return res.status(400).json({ error: 'invalid chapterNo' });
  }
  if (!summary?.trim()) {
    return res.status(400).json({ error: 'summary is required' });
  }

  try {
    await indexChapterSummaryInQdrant({
      projectId,
      chapterNo,
      title: title?.trim() || `第${chapterNo}章`,
      summary: summary.trim(),
    });
    res.json({ ok: true, chapterNo });
  } catch (error) {
    console.error('Index chapter summary failed:', error);
    res.status(500).json({ error: 'Index chapter summary failed' });
  }
});

app.post('/api/consistency/check', (req, res) => {
  const { text, context: consistencyCtx } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const report = consistencyChecker.check(text, consistencyCtx || {});
    res.json(report);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Consistency check failed';
    res.status(500).json({ error: errorMsg });
  }
});

// ─── 主生成：检索 → 叙事上下文 → LLM（SSE 或 JSON）────────────────────

app.post('/api/generate', async (req, res) => {
  const {
    projectId,
    prompt,
    useSSE = true,
    context: extraContext,
    systemPromptOverride,
    templateKey,
  } = req.body;

  if (!projectId || !prompt) {
    return res.status(400).json({ error: 'projectId and prompt are required' });
  }

  const ragEnv = getResolvedRagInfrastructureEnv();
  const projectCtx = getOrCreateContext(projectId);
  const extra = extraContext as Record<string, unknown> | undefined;
  const tk = typeof templateKey === 'string' ? templateKey.trim() : '';
  const isComplianceTask =
    isComplianceTemplateKey(tk) || extra?.omitProjectSystemPrompt === true;
  const chapterNoRaw = extra?.chapterNo;
  const chapterNo =
    typeof chapterNoRaw === 'number' && Number.isFinite(chapterNoRaw)
      ? chapterNoRaw
      : Number(chapterNoRaw);

  // Step 1: 构造检索 query（章节优化用 instruction+摘要；其余用 prompt+任务字段）
  let retrievalQuery: string;
  if (
    (tk === CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY ||
      tk === CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY ||
      tk === WRITE_CHAPTER_OUTLINE_TEMPLATE_KEY) &&
    typeof extra?.retrievalInstruction === 'string' &&
    extra.retrievalInstruction.trim()
  ) {
    retrievalQuery = buildChapterOptimizeRetrievalQuery(projectCtx, {
      chapterNo: Number.isFinite(chapterNo) && chapterNo > 0 ? chapterNo : 0,
      title:
        typeof extra.retrievalChapterTitle === 'string' ? extra.retrievalChapterTitle.trim() : '',
      instruction: extra.retrievalInstruction.trim(),
      chapterSummary:
        typeof extra.retrievalChapterSummary === 'string' ? extra.retrievalChapterSummary : '',
    });
  } else {
    retrievalQuery = buildGenerationRetrievalQuery(String(prompt), projectCtx, extra);
  }

  const taskRecord =
    extra && typeof extra.task === 'object' && extra.task !== null && !Array.isArray(extra.task)
      ? (extra.task as Record<string, unknown>)
      : null;
  const draftChapterFromTask = taskRecord ? Number(taskRecord.chapterNo) : NaN;
  const extraChapterNo = Number.isFinite(chapterNo) && chapterNo > 0 ? chapterNo : 0;
  const structuredChapterNo =
    Number.isFinite(draftChapterFromTask) && draftChapterFromTask > 0
      ? draftChapterFromTask
      : extraChapterNo;
  const narrativeCurrentChapter = structuredChapterNo > 0 ? structuredChapterNo : undefined;
  /** 有章节号时走标题匹配 + 向量补足融合 */
  const useStructuredChapterKb = structuredChapterNo > 0;
  const chapterScopedEmbeddingQuery = resolveChapterScopedEmbeddingQuery(
    projectCtx,
    draftChapterFromTask,
    extraChapterNo
  );

  let structuredKbTrace: {
    titleMatchedDocumentIds: string[];
    evidenceDocumentIds: string[];
    vectorDocumentIds?: string[];
    dualHitDocumentIds?: string[];
    retrievalMode?: string;
    retrievalSkippedNoStructured?: boolean;
  } | null = null;

  let retrievedChunkIds: string[] = [];
  let retrievedEvidence = '';
  let retrievedFullDocuments: Array<Record<string, unknown>> = [];

  let sseHeadersOpened = false;
  const ensureSseHeaders = () => {
    if (!useSSE || sseHeadersOpened) {
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sseHeadersOpened = true;
  };
  const writeGenerateSse = (payload: Record<string, unknown>) => {
    ensureSseHeaders();
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Step 2: 检索证据 — 合规检验等任务跳过 RAG
  if (!isComplianceTask) {
    ensureSseHeaders();
    writeGenerateSse({ event: 'stage', stage: 'retrieving' });
    try {
      if (useStructuredChapterKb) {
      const optimizeInstruction =
        typeof extra?.retrievalInstruction === 'string' ? extra.retrievalInstruction.trim() : '';
      const appearingCharacters = parseAppearingCharactersFromExtra(extra);
      const personaCards = listPersonaCardsFromKnowledgeDocs(
        projectCtx.knowledgeDocuments ?? [],
        projectCtx.personas
      );
      const optimizeBoost = shouldApplyChapterOptimizeMatchingBoost({
        templateKey: tk,
        instruction: optimizeInstruction,
        appearingCharacters,
      })
        ? {
            instruction: optimizeInstruction,
            appearingCharacters,
            personaCards,
          }
        : undefined;

      const sr = buildStructuredKnowledgeEvidence(structuredChapterNo, {
        chapterNo: structuredChapterNo,
        chapters: mapChaptersForStructuredKnowledgeMatch(
          projectCtx.chapters.map((c) => ({
            chapterNo: c.chapterNo,
            structuredMatchingText: c.structuredMatchingText,
          })),
          structuredChapterNo,
          optimizeBoost
        ),
        knowledgeDocuments: projectCtx.knowledgeDocuments ?? [],
      });

      let vectorPart: Awaited<ReturnType<typeof retrieveKnowledgeForDraft>> | null = null;
      try {
        const vectorQuery =
          chapterScopedEmbeddingQuery !== undefined
            ? chapterScopedEmbeddingQuery
            : buildEmbeddingRetrievalQuery(String(prompt), projectCtx, extra);
        vectorPart = await retrieveKnowledgeForDraft(
          vectorStore,
          reranker,
          projectId,
          retrievalQuery,
          {
            topK: ragEnv.retrievalTopK,
            topN: ragEnv.rerankTopN,
            minScore: ragEnv.retrievalMinScore,
            apiBaseUrl: API_BASE_URL,
            enrichFullDocuments: true,
            embeddingQuery: vectorQuery,
          }
        );
      } catch (vectorError) {
        console.error('Generate vector supplement failed:', vectorError);
      }

      const merged = mergeTitleAndVectorEvidence(sr, vectorPart);
      structuredKbTrace = {
        titleMatchedDocumentIds: merged.titleMatchedDocumentIds,
        evidenceDocumentIds: merged.evidenceDocumentIds,
        vectorDocumentIds: merged.vectorDocumentIds,
        dualHitDocumentIds: merged.dualHitDocumentIds,
        retrievalMode: merged.retrievalMode,
        retrievalSkippedNoStructured: merged.retrievalSkippedNoStructured,
      };
      retrievalQuery = merged.query.trim() ? merged.query : retrievalQuery;
      retrievedEvidence = merged.evidenceText;
      retrievedChunkIds = merged.chunks
        .filter((c) => merged.evidenceDocumentIds.includes(c.documentId))
        .map((c) => c.id)
        .filter((id) => Boolean(id?.trim()));
      const evidenceDocSet = new Set(merged.evidenceDocumentIds);
      retrievedFullDocuments = (merged.fullDocuments ?? [])
        .filter((d) => evidenceDocSet.has(d.documentId))
        .map((d) => ({ ...d }));
    } else {
      const retrieval = await retrieveKnowledgeForDraft(
        vectorStore,
        reranker,
        projectId,
        retrievalQuery,
        {
          topK: ragEnv.retrievalTopK,
          topN: ragEnv.rerankTopN,
          minScore: ragEnv.retrievalMinScore,
          apiBaseUrl: API_BASE_URL,
          enrichFullDocuments: true,
          ...(chapterScopedEmbeddingQuery !== undefined
            ? { embeddingQuery: chapterScopedEmbeddingQuery }
            : {
                embeddingQuery: buildEmbeddingRetrievalQuery(String(prompt), projectCtx, extra),
              }),
        }
      );
      retrievedEvidence = retrieval.evidenceText;
      retrievedChunkIds = retrieval.chunks.map((c) => c.id).filter((id) => Boolean(id?.trim()));
      retrievedFullDocuments = (retrieval.fullDocuments ?? []).map((d) => ({ ...d }));
      structuredKbTrace = {
        titleMatchedDocumentIds: [],
        evidenceDocumentIds: retrievedFullDocuments
          .map((d) => String(d.documentId ?? ''))
          .filter(Boolean),
        vectorDocumentIds: retrievedFullDocuments
          .map((d) => String(d.documentId ?? ''))
          .filter(Boolean),
        retrievalMode: 'vector',
      };
    }
    } catch (error) {
      console.error('Generate retrieval failed:', error);
    }
  }

  // Step 3: 拼装叙事上下文（合规检验不注入叙事/RAG）
  let generationContext: GenerationContext & { narrativeMeta?: NarrativeContextMeta };
  if (isComplianceTask) {
    generationContext = {
      systemPromptText: projectCtx.systemPromptText ?? '',
      narrativeContext: '',
      omitProjectSystemPrompt: true,
    };
  } else {
    generationContext = await getGenerationContext(projectId, narrativeCurrentChapter, {
      includeNextChapterHead: isChapterOptimizeTemplateKey(tk),
      appearingCharacters: parseAppearingCharactersFromExtra(extra),
    });
  }
  const narrativeMeta = generationContext.narrativeMeta;

  const resolvedTaskSystemPrompt = resolveTaskSystemPromptFromContext({
    templateKey: tk,
    systemPromptOverride,
    taskPrompts: projectCtx.taskPrompts,
  });
  if (resolvedTaskSystemPrompt) {
    generationContext.taskSystemPrompt = resolvedTaskSystemPrompt;
  }

  if (extra?.omitProjectSystemPrompt === true && !isComplianceTask) {
    generationContext.omitProjectSystemPrompt = true;
  }

  generationContext.retrievedEvidence = isComplianceTask
    ? undefined
    : retrievedEvidence.trim() || undefined;

  const injectedStyleSampleIds = applyWritingStyleSamplesToContext(
    generationContext,
    projectCtx,
    tk,
    narrativeCurrentChapter
  );

  const resolvedProfile = resolveGenerationCallProfileForProject(tk, projectCtx, req.body?.temperature);
  const resolvedSystemPrompt = generationService.buildSystemMessage(generationContext);

  const traceContext: Record<string, unknown> = {
    retrieval_query: retrievalQuery,
    retrieved_chunk_ids: retrievedChunkIds,
    full_documents: retrievedFullDocuments,
    generation_tier: resolvedProfile.tier,
    generation_provider: resolvedProfile.provider,
    generation_temperature: resolvedProfile.temperature,
    ...(resolvedProfile.frequencyPenalty !== undefined
      ? { generation_frequency_penalty: resolvedProfile.frequencyPenalty }
      : {}),
    ...(structuredKbTrace
      ? {
          retrieval_mode: structuredKbTrace.retrievalMode ?? 'structured',
          title_matched_document_ids: structuredKbTrace.titleMatchedDocumentIds,
          vector_document_ids: structuredKbTrace.vectorDocumentIds ?? [],
          evidence_document_ids: structuredKbTrace.evidenceDocumentIds,
          dual_hit_document_ids: structuredKbTrace.dualHitDocumentIds ?? [],
          retrieval_skipped_no_structured: structuredKbTrace.retrievalSkippedNoStructured === true,
        }
      : {}),
    ...(extra || {}),
    ...(templateKey ? { templateKey } : {}),
    ...(injectedStyleSampleIds.length > 0
      ? { writing_style_sample_ids: injectedStyleSampleIds }
      : {}),
    ...(narrativeMeta || {}),
  };

  const trace = await generationService.createTrace({
    prompt,
    projectId,
    systemPrompt: resolvedSystemPrompt,
    context: traceContext,
    useSSE,
    model: resolvedProfile.model,
    temperature: resolvedProfile.temperature,
  });

  if (useSSE) {
    ensureSseHeaders();
    writeGenerateSse({ event: 'start', traceId: trace.id });
    writeGenerateSse({ event: 'stage', stage: 'waiting_llm' });

    try {
      for await (const chunk of generationService.generateStream(trace, generationContext)) {
        const escaped = chunk.replace(/\n/g, '\\n');
        writeGenerateSse({ event: 'content', data: escaped, traceId: trace.id });
      }

      writeGenerateSse({ event: 'end', traceId: trace.id });
      res.end();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Generation failed';
      writeGenerateSse({ event: 'error', data: errorMsg, traceId: trace.id });
      res.end();
    }
  } else {
    try {
      const result = await generationService.generateNonStream(trace, generationContext);
      res.json({
        traceId: trace.id,
        status: 'completed',
        content: result,
        usage: trace.usage,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Generation failed';
      res.status(500).json({ error: errorMsg, traceId: trace.id, status: 'failed' });
    }
  }
});

app.get('/api/projects/:projectId/generation-stats', (req, res) => {
  const projectId = req.params.projectId;
  const stats = generationService.getStats(projectId);
  res.json(stats);
});

const WRITE_CHAPTER_DRAFT_SYSTEM_PROMPT = [
  '你是一位专业小说写作助手，正在根据作者已确认的章节大纲撰写本章正文。',
  '硬约束：',
  '1) 必须严格遵循 <chapter-outline> 中已确认的章节大纲结构与节拍；',
  '2) 必须满足写作目标、视角、必须包含与避免项；',
  '3) 保持与【叙事上下文】及【检索证据】（如有）一致；',
  '4) 直接输出小说正文，不要输出大纲、说明或 Markdown 标题。',
].join('\n');

// ─── 写作工作台正文：结构化 KB + 确认大纲 + 多阶段 SSE ─────────────────

app.post('/api/generate/draft', async (req, res) => {
  const {
    projectId,
    task = {},
    citations = [],
    confirmedOutlineText: bodyOutline,
    outlineId,
    outlineTraceId,
  } = req.body;

  let confirmedOutlineText: string;
  try {
    confirmedOutlineText = assertConfirmedOutlineText(bodyOutline);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'confirmedOutlineText is required';
    return res.status(400).json({ error: errorMsg, code: 1321 });
  }

  const requestTraceId =
    (req as RequestWithObservability).traceId ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const context = getOrCreateContext(projectId);
  const chapterNo = Number(task.chapterNo || 1);
  const goal = task.goal || '推进主线并保持人物一致性';
  const pov = task.pov || '第三人称';

  const writeSse = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  writeSse({ event: 'retrieving' });

  const taskRecord = task as Record<string, unknown>;
  const fallbackQuery = buildRetrievalQuery(taskRecord);
  const kbCtx = {
    chapterNo,
    chapters: context.chapters.map((c) => ({
      chapterNo: c.chapterNo,
      structuredMatchingText: c.structuredMatchingText,
    })),
    knowledgeDocuments: context.knowledgeDocuments ?? [],
  };

  let structuredRetrieval: ReturnType<typeof buildStructuredKnowledgeEvidence>;
  try {
    structuredRetrieval = buildStructuredKnowledgeEvidence(chapterNo, kbCtx);
  } catch (error) {
    console.error('Knowledge retrieval failed:', error);
    const errorMsg = error instanceof Error ? error.message : 'Knowledge retrieval failed';
    writeSse({ event: 'error', data: errorMsg });
    res.end();
    return;
  }

  const retrievalQuery = structuredRetrieval.retrievalSkippedNoStructured
    ? fallbackQuery
    : structuredRetrieval.query.trim() || fallbackQuery;

  let resolvedCitations: DraftCitation[] = Array.isArray(citations) ? [...citations] : [];
  let retrievedEvidence = '';
  let retrievedChunkIds: string[] = [];
  let retrievedFullDocuments: Array<Record<string, unknown>> = [];
  let draftRetrievalMode = 'structured';
  let draftVectorIds: string[] = [];
  let draftDualHits: string[] = [];
  let draftEvidenceIds = structuredRetrieval.evidenceDocumentIds;

  try {
    let vectorPart: Awaited<ReturnType<typeof retrieveKnowledgeForDraft>> | null = null;
    try {
      const ragEnv = getResolvedRagInfrastructureEnv();
      vectorPart = await retrieveKnowledgeForDraft(vectorStore, reranker, projectId, retrievalQuery, {
        topK: ragEnv.retrievalTopK,
        topN: ragEnv.rerankTopN,
        minScore: ragEnv.retrievalMinScore,
        apiBaseUrl: API_BASE_URL,
        enrichFullDocuments: true,
        embeddingQuery: buildEmbeddingRetrievalQuery(fallbackQuery, context, { task: taskRecord }),
      });
    } catch (vectorError) {
      console.error('Draft vector supplement failed:', vectorError);
    }

    const merged = mergeTitleAndVectorEvidence(structuredRetrieval, vectorPart);
    draftRetrievalMode = merged.retrievalMode;
    draftVectorIds = merged.vectorDocumentIds;
    draftDualHits = merged.dualHitDocumentIds;
    draftEvidenceIds = merged.evidenceDocumentIds;
    retrievedEvidence = merged.evidenceText;
    retrievedChunkIds = merged.chunks
      .filter((c) => merged.evidenceDocumentIds.includes(c.documentId))
      .map((c) => c.id)
      .filter((id) => Boolean(id?.trim()));
    const evidenceDocSet = new Set(merged.evidenceDocumentIds);
    retrievedFullDocuments = (merged.fullDocuments ?? [])
      .filter((d) => evidenceDocSet.has(d.documentId))
      .map((d) => ({ ...d }));
    if (resolvedCitations.length === 0) {
      resolvedCitations = merged.citations;
    }
  } catch (error) {
    console.error('Knowledge retrieval assembly failed:', error);
  }

  writeSse({ event: 'building_prompt' });

  const resolvedProfile = resolveGenerationCallProfileForProject(
    WRITE_CHAPTER_DRAFT_TEMPLATE_KEY,
    context,
    req.body?.temperature
  );
  const generationContext = await getGenerationContext(
    projectId,
    chapterNo > 0 ? chapterNo : undefined,
    {
      appearingCharacters: Array.isArray(task.appearingCharacters)
        ? task.appearingCharacters.map(String).filter((n: string) => n.trim().length >= 2)
        : undefined,
    }
  );
  const draftNarrativeMeta = generationContext.narrativeMeta;
  generationContext.retrievedEvidence = retrievedEvidence.trim() || undefined;
  generationContext.taskSystemPrompt = WRITE_CHAPTER_DRAFT_SYSTEM_PROMPT;

  const injectedStyleSampleIds = applyWritingStyleSamplesToContext(
    generationContext,
    context,
    WRITE_CHAPTER_DRAFT_TEMPLATE_KEY,
    chapterNo > 0 ? chapterNo : undefined
  );

  const prompt = buildWorkbenchDraftUserPrompt(
    {
      chapterNo,
      goal,
      pov,
      mustInclude: Array.isArray(task.mustInclude) ? task.mustInclude : [],
      avoid: Array.isArray(task.avoid) ? task.avoid : [],
      targetWords: task.targetWords,
      appearingCharacters: Array.isArray(task.appearingCharacters) ? task.appearingCharacters : [],
    },
    confirmedOutlineText
  );

  const traceSpanId = startSpan(requestTraceId, 'generate.draft', {
    projectId,
    chapterNo,
    task,
    outlineId: typeof outlineId === 'string' ? outlineId : undefined,
    outlineTraceId: typeof outlineTraceId === 'string' ? outlineTraceId : undefined,
  });

  const trace = await generationService.createTrace({
    prompt,
    projectId,
    systemPrompt: assembleSystemMessageContent({
      systemPromptText: generationContext.systemPromptText,
      taskSystemPrompt: generationContext.taskSystemPrompt,
    }),
    context: {
      phase: 'write.chapter.draft',
      task,
      templateKey: WRITE_CHAPTER_DRAFT_TEMPLATE_KEY,
      outlineId: typeof outlineId === 'string' ? outlineId : null,
      outlineTraceId: typeof outlineTraceId === 'string' ? outlineTraceId : null,
      confirmedOutlineText,
      citations: resolvedCitations,
      retrieval_query: retrievalQuery,
      retrieved_chunk_ids: retrievedChunkIds,
      full_documents: retrievedFullDocuments,
      retrieval_mode: draftRetrievalMode,
      title_matched_document_ids: structuredRetrieval.titleMatchedDocumentIds,
      vector_document_ids: draftVectorIds,
      evidence_document_ids: draftEvidenceIds,
      dual_hit_document_ids: draftDualHits,
      retrieval_skipped_no_structured:
        structuredRetrieval.retrievalSkippedNoStructured === true && draftVectorIds.length === 0,
      generation_tier: resolvedProfile.tier,
      generation_provider: resolvedProfile.provider,
      generation_temperature: resolvedProfile.temperature,
      ...(resolvedProfile.frequencyPenalty !== undefined
        ? { generation_frequency_penalty: resolvedProfile.frequencyPenalty }
        : {}),
      ...(injectedStyleSampleIds.length > 0
        ? { writing_style_sample_ids: injectedStyleSampleIds }
        : {}),
      ...(draftNarrativeMeta || {}),
    },
    useSSE: true,
    model: resolvedProfile.model,
    temperature: resolvedProfile.temperature,
  });

  let fullDraftText = '';

  writeSse({ event: 'start', traceId: trace.id, chapterNo });
  writeSse({ event: 'waiting_llm', traceId: trace.id });

  const streamSpanId = startSpan(
    trace.id,
    'generate.stream',
    { projectId, chapterNo },
    traceSpanId
  );

  try {
    let generatingPhaseSent = false;
    for await (const chunk of generationService.generateStream(trace, generationContext)) {
      if (!generatingPhaseSent) {
        writeSse({ event: 'generating', traceId: trace.id });
        generatingPhaseSent = true;
      }
      fullDraftText += chunk;
      const escaped = chunk.replace(/\n/g, '\\n');
      writeSse({ event: 'content', data: escaped, traceId: trace.id });
    }

    endSpan(streamSpanId);

    writeSse({ event: 'checking', traceId: trace.id });

    let consistencyNotes: Array<{ level: string; message: string }> = [];

    if (structuredRetrieval.retrievalSkippedNoStructured) {
      consistencyNotes.push({
        level: 'warning',
        message:
          '未生成结构化信息，无法匹配知识库；请在工作台或章节模块点击「解析结构化信息」后再生成，以便注入知识库文档。',
      });
    }

    if (fullDraftText.trim()) {
      const consistencySpanId = startSpan(
        trace.id,
        'consistency.check',
        { projectId, textLength: fullDraftText.length },
        traceSpanId
      );

      const character = context.personaProfile
        ? {
            name: (task.personaName as string) || '角色',
            profile: context.personaProfile,
          }
        : undefined;

      const report = consistencyChecker.check(fullDraftText, {
        characters: character
          ? [
              {
                name: character.name,
                identity: character.profile.split('\n')[0] || undefined,
                traits: character.profile.split('\n').filter((l: string) => l.trim()),
              },
            ]
          : undefined,
        worldRules: [
          {
            domain: '叙事视角',
            rule: pov as string,
          },
        ],
      });

      consistencyNotes = report.results.map((r) => ({
        level: r.level === 'block' ? 'block' : r.level === 'warn' ? 'warning' : 'info',
        message: r.message,
      }));

      endSpan(consistencySpanId);
    }

    if (consistencyNotes.length === 0) {
      consistencyNotes = context.outlineSummary
        ? [{ level: 'info', message: '已检测到大纲总结，未检测到设定冲突。' }]
        : [{ level: 'warning', message: '未检测到大纲总结，请补充后再生成。' }];
    }

    writeSse({ event: 'content_safety_scan', traceId: trace.id });
    writeSse({
      event: 'progress',
      traceId: trace.id,
      taskKey: 'write.chapter.draft',
      stage: 'content_safety_scan',
      message: '正在执行内容安全扫描…',
    });

    const safetyEnabled = context.contentSafetyScanEnabled !== false;
    const safetyRules = mergeContentSafetyRules(context.contentSafetyCustomRules ?? []);
    const safety = await processContentSafety(fullDraftText, {
      enabled: safetyEnabled,
      rules: safetyRules,
      rewriteSentence: safetyEnabled
        ? async (sentence) => {
            writeSse({
              event: 'progress',
              traceId: trace.id,
              taskKey: 'write.chapter.draft',
              stage: 'content_safety_rewrite',
              message: '正在重写命中句子…',
            });
            const rewriteTrace = await generationService.createTrace({
              projectId,
              prompt: [
                '请改写以下小说句子，使其符合平台内容规范，保持原意、人物语气与叙事连贯。',
                '只输出改写后的单句，不要解释。',
                '',
                sentence,
              ].join('\n'),
              context: { task: 'content-safety.rewrite', traceId: trace.id },
            });
            return generationService.generateNonStream(rewriteTrace, generationContext);
          }
        : undefined,
      onRewriteAttempt: (progress) => {
        writeSse({
          event: 'progress',
          traceId: trace.id,
          taskKey: 'write.chapter.draft',
          stage: 'content_safety_rewrite',
          message: `正在批量重写命中句子（第 ${progress.batch} 轮，${progress.indexInBatch}/${progress.batchSize}）…`,
        });
      },
    });

    if (safety.blocked) {
      const errorMsg = formatContentSafetyBlockMessage(safety.blockReason, safety.hits);
      endSpan(streamSpanId, errorMsg);
      endSpan(traceSpanId, errorMsg);
      writeSse({ event: 'error', data: errorMsg, traceId: trace.id });
      res.end();
      return;
    }

    const finalDraftText = safety.text;
    if (finalDraftText !== fullDraftText) {
      writeSse({
        event: 'content_replace',
        data: finalDraftText.replace(/\n/g, '\\n'),
        traceId: trace.id,
      });
    }

    writeSse({
      event: 'end',
      traceId: trace.id,
      citations: resolvedCitations,
      consistencyNotes,
      usedRelationEvents: context.usedRelationEvents || [],
      ...(finalDraftText !== fullDraftText ? { finalText: finalDraftText } : {}),
      contentSafety: {
        hits: safety.hits,
        blocked: safety.blocked,
        blockReason: safety.blockReason,
        scanEnabled: safety.scanEnabled,
        rewriteAttempts: safety.rewriteAttempts,
        finalText: finalDraftText,
      },
    });
    res.end();
    endSpan(traceSpanId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Generation failed';
    endSpan(streamSpanId, errorMsg);
    endSpan(traceSpanId, errorMsg);
    writeSse({ event: 'error', data: errorMsg, traceId: trace.id });
    res.end();
  }
});

app.listen(PORT, () => {
  const providerKey =
    process.env.PROVIDER_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.SILICONFLOW_API_KEY ||
    '';
  const providerMode = providerKey ? 'live' : 'unconfigured';

  logger.info(`RAG Orchestrator service running on http://localhost:${PORT}`, { port: PORT });
  logger.info(`API Base URL: ${API_BASE_URL}`, { apiBaseUrl: API_BASE_URL });
  logger.info(`Generation provider mode: ${providerMode}`, { providerMode });
});

app.use(observabilityErrorHandler);
