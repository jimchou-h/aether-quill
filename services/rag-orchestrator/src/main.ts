import { loadEnv } from './config/load-env';
import { assertRagInfrastructureEnv, getResolvedRagInfrastructureEnv } from '@aether-quill/config';
import express from 'express';
import { VectorStore } from './retrieval/vector-store';
import { Reranker } from './retrieval/reranker';
import { ChunkWithEmbedding } from './retrieval/types';
import {
  buildChapterOptimizeRetrievalQuery,
  buildGenerationRetrievalQuery,
  buildRetrievalQuery,
  CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
  DraftCitation,
  buildStructuredKnowledgeEvidence,
  resolveChapterScopedEmbeddingQuery,
  retrieveKnowledgeForDraft,
} from './retrieval/knowledge-retrieval';
import { GenerationService, GenerationContext } from './generation/generation.service';
import { indexChapterSummaryInQdrant } from './context/chapter-summary-memory';
import { retrieveMemoryChapterSummaries } from './context/chapter-summary-memory';
import { pickPriorChapterSummariesForPrompt } from './context/prior-chapter-summaries';
import { runPreviewRetrieval, type PreviewRetrievalRequest } from './retrieval/preview-retrieval';
import {
  clampChapterSummaryMemoryCount,
  clampChapterSummaryPromptCount,
  clampGenerationTemperature,
  DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
  DEFAULT_GENERATION_TEMPERATURE,
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
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(observabilityMiddleware);

const PORT = process.env.PORT || 3001;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

const vectorStore = new VectorStore();
const reranker = new Reranker();
const generationService = new GenerationService();
const consistencyChecker = new ConsistencyChecker();

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
  /** 由 API 同步：章节已解析的结构化匹配文本，用于知识库标题匹配 */
  structuredMatchingText?: string;
}

interface KnowledgeDocumentPayload {
  id: string;
  title: string;
  content: string;
  docType?: string;
}

interface ProjectContext {
  systemPromptText: string;
  personaProfile: string;
  outlineSummary: string;
  chapters: ContextChapter[];
  /** 叙事上下文注入：当前章之前最近 N 章摘要（0 不注入） */
  chapterSummaryPromptCount: number;
  /** 语义记忆池：向量检索历史章节摘要条数 */
  chapterSummaryMemoryCount: number;
  /** 主生成链路采样温度 */
  generationTemperature: number;
  /** 项目知识库文档全文列表，用于标题匹配后整文注入 */
  knowledgeDocuments?: KnowledgeDocumentPayload[];
  selectedRelationMemory?: string;
  usedRelationEvents?: Array<{
    id: string;
    protagonist: string;
    counterparty: string;
    summary: string;
    evidenceSnippet?: string;
    chapterNo?: number | null;
  }>;
  updatedAt: string;
}

const projectContextStore = new Map<string, ProjectContext>();

function getOrCreateContext(projectId: string) {
  if (!projectContextStore.has(projectId)) {
    projectContextStore.set(projectId, {
      systemPromptText: '你是一位专业的小说写作助手，请保持设定一致与剧情连贯。',
      personaProfile: '未配置人物设定',
      outlineSummary: '',
      chapters: [],
      chapterSummaryPromptCount: DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT,
      chapterSummaryMemoryCount: 3,
      generationTemperature: DEFAULT_GENERATION_TEMPERATURE,
      updatedAt: new Date().toISOString(),
    });
  }
  return projectContextStore.get(projectId)!;
}

async function buildNarrativeContext(
  projectId: string,
  ctx: ProjectContext,
  currentChapterNo?: number
): Promise<string> {
  const sections: string[] = [];
  if (ctx.personaProfile && ctx.personaProfile !== '未配置人物设定') {
    sections.push(`【人物设定】\n${ctx.personaProfile}`);
  }
  if (ctx.outlineSummary?.trim()) {
    sections.push(`【大纲总结】\n${ctx.outlineSummary.trim()}`);
  }
  const maxCount = clampChapterSummaryPromptCount(ctx.chapterSummaryPromptCount);
  const prior = pickPriorChapterSummariesForPrompt(ctx.chapters, {
    currentChapterNo,
    maxCount,
  });
  if (prior.length > 0) {
    sections.push(
      `【近期章节摘要】\n${prior
        .map((ch) => `第${ch.chapterNo}章 ${ch.title}: ${ch.summary}`)
        .join('\n')}`
    );
  }

  const memoryMax = clampChapterSummaryMemoryCount(ctx.chapterSummaryMemoryCount);
  if (memoryMax > 0) {
    const memoryQuery = [ctx.outlineSummary, prior.map((ch) => ch.summary).join(' ')]
      .filter(Boolean)
      .join('\n')
      .trim();
    if (memoryQuery) {
      const memory = await retrieveMemoryChapterSummaries(projectId, memoryQuery, {
        currentChapterNo,
        maxCount: memoryMax,
      });
      if (memory.length > 0) {
        sections.push(
          `【语义记忆章节】\n${memory
            .map((ch) => `第${ch.chapterNo}章 ${ch.title}: ${ch.summary}`)
            .join('\n')}`
        );
      }
    }
  }
  if (ctx.selectedRelationMemory?.trim()) {
    sections.push(`【已选关系事件备忘】\n${ctx.selectedRelationMemory.trim()}`);
  }
  return sections.join('\n\n');
}

function resolveGenerationTemperature(bodyTemp: unknown, ctx: ProjectContext): number {
  if (typeof bodyTemp === 'number' && Number.isFinite(bodyTemp)) {
    return clampGenerationTemperature(bodyTemp);
  }
  const env = Number(process.env.PROVIDER_TEMPERATURE || 0.7);
  if (typeof ctx.generationTemperature === 'number' && Number.isFinite(ctx.generationTemperature)) {
    return clampGenerationTemperature(ctx.generationTemperature);
  }
  return clampGenerationTemperature(env);
}

async function getGenerationContext(
  projectId: string,
  currentChapterNo?: number
): Promise<GenerationContext> {
  const ctx = getOrCreateContext(projectId);
  return {
    systemPromptText: ctx.systemPromptText,
    narrativeContext: await buildNarrativeContext(projectId, ctx, currentChapterNo),
  };
}

function keywordScore(query: string, text: string) {
  const words = query
    .trim()
    .split(/\s+/)
    .map((item) => item.toLowerCase())
    .filter(Boolean);
  if (words.length === 0) {
    return 0;
  }

  const loweredText = text.toLowerCase();
  return words.reduce((score, word) => score + (loweredText.includes(word) ? 1 : 0), 0);
}

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

app.get('/api/projects/:projectId/context', (req, res) => {
  const projectId = req.params.projectId;
  const context = getOrCreateContext(projectId);
  res.json(context);
});

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
      if (!name) {
        return null;
      }
      return { name, profile, state };
    })
    .filter((item): item is { name: string; profile: string; state: string } => Boolean(item));

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
  if (Array.isArray(payload.usedRelationEvents)) {
    context.usedRelationEvents = payload.usedRelationEvents;
  }
  if (Array.isArray(payload.knowledgeDocuments)) {
    context.knowledgeDocuments = payload.knowledgeDocuments
      .map((row: unknown) => {
        if (!row || typeof row !== 'object') {
          return null;
        }
        const r = row as Record<string, unknown>;
        const id = typeof r.id === 'string' ? r.id.trim() : '';
        const title = typeof r.title === 'string' ? r.title : '';
        const content = typeof r.content === 'string' ? r.content : '';
        if (!id) {
          return null;
        }
        const docType = typeof r.docType === 'string' ? r.docType : undefined;
        return { id, title, content, docType };
      })
      .filter((x): x is KnowledgeDocumentPayload => Boolean(x));
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

  context.updatedAt = new Date().toISOString();
  res.json(context);
});

app.post('/api/preview-retrieval', async (req, res) => {
  const body = req.body as {
    projectId?: string;
    prompt?: string;
    chapterNo?: number;
    useStructuredKb?: boolean;
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

app.post('/api/retrieve', async (req, res) => {
  const { query, projectId, topK = 30, minScore = 0 } = req.body;

  if (!query || !projectId) {
    return res.status(400).json({ error: 'query and projectId are required' });
  }

  try {
    const chunks = await vectorStore.retrieve({ query, projectId, topK, minScore });

    res.json({
      chunks,
      query,
      projectId,
      topK,
      totalRetrieved: chunks.length,
    });
  } catch (error) {
    console.error('Retrieval failed:', error);
    const context = getOrCreateContext(projectId);
    const ranked = context.chapters
      .map((chapter) => ({
        ...chapter,
        score: keywordScore(query, `${chapter.title} ${chapter.summary}`),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    res.json({
      chunks: ranked,
      query,
      projectId,
      topK,
      totalRetrieved: ranked.length,
      fallback: true,
    });
  }
});

app.post('/api/rerank', async (req, res) => {
  const { query, chunks, topN = 10 } = req.body;

  if (!query || !chunks) {
    return res.status(400).json({ error: 'query and chunks are required' });
  }

  const typedChunks: ChunkWithEmbedding[] = chunks.map((c: Partial<ChunkWithEmbedding>) => ({
    id: c.id || '',
    documentId: c.documentId || '',
    content: c.content || '',
    embedding: c.embedding || [],
    metadata: c.metadata || {},
    score: c.score,
  }));

  const rerankedChunks = reranker.rerank(query, typedChunks, topN);

  res.json({
    rerankedChunks,
    query,
    topN,
  });
});

app.post('/api/search', async (req, res) => {
  const { query, projectId, topK = 30, topN = 10, minScore = 0 } = req.body;

  if (!query || !projectId) {
    return res.status(400).json({ error: 'query and projectId are required' });
  }

  try {
    const retrieved = await vectorStore.retrieve({ query, projectId, topK, minScore });
    const reranked = reranker.rerank(query, retrieved, topN);

    res.json({
      results: reranked,
      query,
      projectId,
      topK,
      topN,
      totalRetrieved: retrieved.length,
    });
  } catch (error) {
    console.error('Search failed:', error);
    const context = getOrCreateContext(projectId);
    const ranked = context.chapters
      .map((chapter) => ({
        id: `chapter-${chapter.chapterNo}`,
        documentId: projectId,
        content: `${chapter.title}\n${chapter.summary}`,
        embedding: [] as number[],
        metadata: { chapterNo: chapter.chapterNo, title: chapter.title },
        score: keywordScore(query, `${chapter.title} ${chapter.summary}`),
      }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, topN);

    res.json({
      results: ranked,
      query,
      projectId,
      topK,
      topN,
      totalRetrieved: ranked.length,
      fallback: true,
    });
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
  const chapterNoRaw = extra?.chapterNo;
  const chapterNo =
    typeof chapterNoRaw === 'number' && Number.isFinite(chapterNoRaw)
      ? chapterNoRaw
      : Number(chapterNoRaw);

  let retrievalQuery: string;
  if (
    (tk === CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY || tk === CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY) &&
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
  const useStructuredChapterKb = structuredChapterNo > 0;
  const chapterScopedEmbeddingQuery = resolveChapterScopedEmbeddingQuery(
    projectCtx,
    draftChapterFromTask,
    extraChapterNo
  );

  let structuredKbTrace: {
    titleMatchedDocumentIds: string[];
    retrievalSkippedNoStructured?: boolean;
  } | null = null;

  let retrievedChunkIds: string[] = [];
  let retrievedEvidence = '';
  let retrievedFullDocuments: Array<Record<string, unknown>> = [];
  try {
    if (useStructuredChapterKb) {
      const sr = buildStructuredKnowledgeEvidence(structuredChapterNo, {
        chapterNo: structuredChapterNo,
        chapters: projectCtx.chapters.map((c) => ({
          chapterNo: c.chapterNo,
          structuredMatchingText: c.structuredMatchingText,
        })),
        knowledgeDocuments: projectCtx.knowledgeDocuments ?? [],
      });
      structuredKbTrace = {
        titleMatchedDocumentIds: sr.titleMatchedDocumentIds,
        retrievalSkippedNoStructured: sr.retrievalSkippedNoStructured,
      };
      retrievalQuery = sr.query.trim() ? sr.query : retrievalQuery;
      retrievedEvidence = sr.evidenceText;
      retrievedChunkIds = sr.chunks.map((c) => c.id).filter((id) => Boolean(id?.trim()));
      retrievedFullDocuments = (sr.fullDocuments ?? []).map((d) => ({ ...d }));
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
            : {}),
        }
      );
      retrievedEvidence = retrieval.evidenceText;
      retrievedChunkIds = retrieval.chunks.map((c) => c.id).filter((id) => Boolean(id?.trim()));
      retrievedFullDocuments = (retrieval.fullDocuments ?? []).map((d) => ({ ...d }));
    }
  } catch (error) {
    console.error('Generate retrieval failed:', error);
  }

  const generationContext = await getGenerationContext(projectId, narrativeCurrentChapter);

  if (typeof systemPromptOverride === 'string' && systemPromptOverride.trim()) {
    generationContext.systemPromptText = systemPromptOverride.trim();
  }

  generationContext.retrievedEvidence = retrievedEvidence.trim() || undefined;

  const resolvedTemperature = resolveGenerationTemperature(req.body?.temperature, projectCtx);

  const traceContext: Record<string, unknown> = {
    retrieval_query: retrievalQuery,
    retrieved_chunk_ids: retrievedChunkIds,
    full_documents: retrievedFullDocuments,
    generation_temperature: resolvedTemperature,
    ...(structuredKbTrace
      ? {
          title_matched_document_ids: structuredKbTrace.titleMatchedDocumentIds,
          retrieval_skipped_no_structured: structuredKbTrace.retrievalSkippedNoStructured === true,
        }
      : {}),
    ...(extra || {}),
    ...(templateKey ? { templateKey } : {}),
  };

  const trace = await generationService.createTrace({
    prompt,
    projectId,
    systemPrompt: generationContext.systemPromptText,
    context: traceContext,
    useSSE,
    temperature: resolvedTemperature,
  });

  if (useSSE) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`data: ${JSON.stringify({ event: 'start', traceId: trace.id })}\n\n`);

    try {
      for await (const chunk of generationService.generateStream(trace, generationContext)) {
        const escaped = chunk.replace(/\n/g, '\\n');
        res.write(
          `data: ${JSON.stringify({ event: 'content', data: escaped, traceId: trace.id })}\n\n`
        );
      }

      res.write(`data: ${JSON.stringify({ event: 'end', traceId: trace.id })}\n\n`);
      res.end();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Generation failed';
      res.write(
        `data: ${JSON.stringify({ event: 'error', data: errorMsg, traceId: trace.id })}\n\n`
      );
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

app.get('/api/projects/:projectId/generation-traces', (req, res) => {
  const projectId = req.params.projectId;
  const limit = Number(req.query.limit) || 20;
  const offset = Number(req.query.offset) || 0;
  const status = req.query.status as string | undefined;

  const { data, total } = generationService.queryTraces({ projectId, status, limit, offset });
  res.json({ data, total });
});

app.get('/api/traces/:traceId', (req, res) => {
  const trace = generationService.getTrace(req.params.traceId);
  if (!trace) {
    return res.status(404).json({ error: 'Trace not found' });
  }
  res.json(trace);
});

app.get('/api/traces', (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const offset = Number(req.query.offset) || 0;
  const status = req.query.status as string | undefined;

  const { data, total } = generationService.queryTraces({ status, limit, offset });
  res.json({ data, total });
});

app.get('/api/projects/:projectId/generation-stats', (req, res) => {
  const projectId = req.params.projectId;
  const stats = generationService.getStats(projectId);
  res.json(stats);
});

app.post('/api/generate/draft', async (req, res) => {
  const { projectId, task = {}, citations = [] } = req.body;

  const requestTraceId =
    (req as RequestWithObservability).traceId ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const context = getOrCreateContext(projectId);
  const chapterNo = Number(task.chapterNo || 1);
  const goal = task.goal || '推进主线并保持人物一致性';
  const pov = task.pov || '第三人称';

  const taskRecord = task as Record<string, unknown>;
  const fallbackQuery = buildRetrievalQuery(taskRecord, context);
  const kbCtx = {
    chapterNo,
    chapters: context.chapters.map((c) => ({
      chapterNo: c.chapterNo,
      structuredMatchingText: c.structuredMatchingText,
    })),
    knowledgeDocuments: context.knowledgeDocuments ?? [],
  };
  const structuredRetrieval = buildStructuredKnowledgeEvidence(chapterNo, kbCtx);
  const retrievalQuery = structuredRetrieval.retrievalSkippedNoStructured
    ? fallbackQuery
    : structuredRetrieval.query.trim() || fallbackQuery;

  let resolvedCitations: DraftCitation[] = Array.isArray(citations) ? [...citations] : [];
  let retrievedEvidence = '';
  let retrievedChunkIds: string[] = [];
  let retrievedFullDocuments: Array<Record<string, unknown>> = [];

  try {
    retrievedEvidence = structuredRetrieval.evidenceText;
    retrievedChunkIds = structuredRetrieval.chunks
      .map((c) => c.id)
      .filter((id) => Boolean(id?.trim()));
    retrievedFullDocuments = (structuredRetrieval.fullDocuments ?? []).map((d) => ({ ...d }));
    if (resolvedCitations.length === 0) {
      resolvedCitations = structuredRetrieval.citations;
    }
  } catch (error) {
    console.error('Knowledge retrieval failed:', error);
  }

  const resolvedTemperature = resolveGenerationTemperature(req.body?.temperature, context);
  const generationContext = await getGenerationContext(projectId, chapterNo > 0 ? chapterNo : undefined);
  generationContext.retrievedEvidence = retrievedEvidence.trim() || undefined;

  const prompt = [
    `请撰写第${chapterNo}章小说正文。`,
    `写作目标：${goal}`,
    `叙事视角：${pov}`,
    `要求：保持情节连贯、人物行为符合【叙事上下文】与【检索证据】（如有）；${buildTargetWordsRequirement(task.targetWords)}`,
  ].join('\n');

  const traceSpanId = startSpan(requestTraceId, 'generate.draft', {
    projectId,
    chapterNo,
    task,
  });

  const trace = await generationService.createTrace({
    prompt,
    projectId,
    systemPrompt: context.systemPromptText,
    context: {
      task,
      citations: resolvedCitations,
      retrieval_query: retrievalQuery,
      retrieved_chunk_ids: retrievedChunkIds,
      full_documents: retrievedFullDocuments,
      title_matched_document_ids: structuredRetrieval.titleMatchedDocumentIds,
      retrieval_skipped_no_structured: structuredRetrieval.retrievalSkippedNoStructured === true,
      generation_temperature: resolvedTemperature,
    },
    useSSE: true,
    temperature: resolvedTemperature,
  });

  let fullDraftText = '';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`data: ${JSON.stringify({ event: 'start', traceId: trace.id, chapterNo })}\n\n`);

  const streamSpanId = startSpan(
    trace.id,
    'generate.stream',
    { projectId, chapterNo },
    traceSpanId
  );

  try {
    for await (const chunk of generationService.generateStream(trace, generationContext)) {
      fullDraftText += chunk;
      const escaped = chunk.replace(/\n/g, '\\n');
      res.write(
        `data: ${JSON.stringify({ event: 'content', data: escaped, traceId: trace.id })}\n\n`
      );
    }

    endSpan(streamSpanId);

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
        ? [{ level: 'info', message: '已加载项目大纲与章节摘要，未检测到设定冲突。' }]
        : [{ level: 'warning', message: '未检测到大纲总结，请补充后再生成。' }];
    }

    res.write(
      `data: ${JSON.stringify({
        event: 'end',
        traceId: trace.id,
        citations: resolvedCitations,
        consistencyNotes,
        usedRelationEvents: context.usedRelationEvents || [],
      })}\n\n`
    );
    res.end();
    endSpan(traceSpanId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Generation failed';
    endSpan(streamSpanId, errorMsg);
    endSpan(traceSpanId, errorMsg);
    res.write(`data: ${JSON.stringify({ event: 'error', data: errorMsg, traceId: trace.id })}\n\n`);
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
