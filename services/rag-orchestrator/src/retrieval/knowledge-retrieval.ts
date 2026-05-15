import { Reranker } from './reranker';
import { ChunkWithEmbedding } from './types';
import { VectorStore } from './vector-store';

export interface DraftCitation {
  sourceType: string;
  sourceId: string;
  snippet: string;
}

export interface KnowledgeRetrievalResult {
  chunks: ChunkWithEmbedding[];
  citations: DraftCitation[];
  evidenceText: string;
  query: string;
}

/** 供 /api/generate 检索：用户 prompt +（可选）任务字段 + 项目侧摘要，单次拼接即 V1「query rewrite」 */
export function buildGenerationRetrievalQuery(
  userPrompt: string,
  projectCtx: { outlineSummary: string; personaProfile: string },
  extraContext?: Record<string, unknown>
): string {
  const parts: string[] = [];
  const trimmed = userPrompt.trim();
  if (trimmed) {
    parts.push(trimmed);
  }

  const task = extraContext?.task;
  const isTaskObject = typeof task === 'object' && task !== null && !Array.isArray(task);

  if (isTaskObject) {
    const tail = buildRetrievalQuery(task as Record<string, unknown>, projectCtx);
    if (tail.trim()) {
      parts.push(tail.trim());
    }
  } else {
    if (projectCtx.outlineSummary.trim()) {
      parts.push(projectCtx.outlineSummary.trim().slice(0, 800));
    }
    if (projectCtx.personaProfile.trim() && projectCtx.personaProfile !== '未配置人物设定') {
      parts.push(projectCtx.personaProfile.trim().slice(0, 500));
    }
  }

  return parts.join('\n\n');
}

/** 与 API `chapter-optimize.util` 及 prompt-templates 模板 key 保持一致 */
export const CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY = 'chapter.optimize.plan';
export const CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY = 'chapter.optimize.draft';

export interface ChapterOptimizeRetrievalInput {
  chapterNo: number;
  title: string;
  instruction: string;
  /** 有摘要用摘要；无则由 API 传入正文前缀，勿含整章 */
  chapterSummary: string;
}

/**
 * 章节优化（plan/draft）向量检索：避免把 `<chapter-original>` 全文送进 embedding。
 */
export function buildChapterOptimizeRetrievalQuery(
  projectCtx: { outlineSummary: string; personaProfile: string },
  input: ChapterOptimizeRetrievalInput
): string {
  const title =
    input.title.trim() || (input.chapterNo > 0 ? `第${input.chapterNo}章` : '未命名章节');
  const parts: string[] = [
    `【章节优化检索】第${input.chapterNo}章「${title}」`,
    `【用户优化要求】\n${input.instruction.trim()}`,
  ];

  const sum = input.chapterSummary.trim();
  if (sum) {
    parts.push(`【本章摘要】\n${sum}`);
  }

  if (projectCtx.outlineSummary.trim()) {
    parts.push(projectCtx.outlineSummary.trim().slice(0, 800));
  }
  if (projectCtx.personaProfile.trim() && projectCtx.personaProfile !== '未配置人物设定') {
    parts.push(projectCtx.personaProfile.trim().slice(0, 500));
  }

  return parts.join('\n\n');
}

/**
 * 章节锚定（task 或 extra 的 chapterNo）时：向量 embedding 只用该章 `structuredMatchingText`，
 * 不把大纲/摘要/优化说明等拼进向量。无结构化则返回空串（跳过向量检索）。
 * 无章节锚点时返回 `undefined`，由调用方对向量使用完整 `retrievalQuery`。
 */
export function resolveChapterScopedEmbeddingQuery(
  projectCtx: { chapters: Array<{ chapterNo: number; structuredMatchingText?: string }> },
  taskChapterNo: number,
  extraChapterNo: number
): string | undefined {
  const ch =
    Number.isFinite(taskChapterNo) && taskChapterNo > 0
      ? taskChapterNo
      : Number.isFinite(extraChapterNo) && extraChapterNo > 0
        ? extraChapterNo
        : 0;
  if (ch <= 0) {
    return undefined;
  }
  const st = projectCtx.chapters.find((c) => c.chapterNo === ch)?.structuredMatchingText?.trim();
  return st ?? '';
}

export function buildRetrievalQuery(
  task: Record<string, unknown>,
  context: { outlineSummary: string; personaProfile: string }
): string {
  const parts: string[] = [];
  const goal = typeof task.goal === 'string' ? task.goal.replace(/\\n/g, '\n') : '';
  if (goal.trim()) {
    parts.push(goal.trim());
  }

  if (Array.isArray(task.mustInclude)) {
    const includes = task.mustInclude.map(String).filter(Boolean);
    if (includes.length > 0) {
      parts.push(includes.join(' '));
    }
  }

  if (Array.isArray(task.avoid)) {
    const avoid = task.avoid.map(String).filter(Boolean);
    if (avoid.length > 0) {
      parts.push(`避免: ${avoid.join(' ')}`);
    }
  }

  if (typeof task.pov === 'string' && task.pov.trim()) {
    parts.push(task.pov.trim());
  }

  if (context.outlineSummary.trim()) {
    parts.push(context.outlineSummary.trim());
  }

  if (context.personaProfile.trim() && context.personaProfile !== '未配置人物设定') {
    parts.push(context.personaProfile.trim());
  }

  return parts.join('\n');
}

export function formatEvidence(chunks: ChunkWithEmbedding[]): string {
  if (chunks.length === 0) {
    return '';
  }

  return chunks
    .map((chunk, index) => {
      const title =
        typeof chunk.metadata?.docTitle === 'string' ? chunk.metadata.docTitle : '未命名文档';
      const cid = chunk.id?.trim() || `chunk-${index + 1}`;
      return `[证据${index + 1}] chunk_id=${cid} doc=${title}\n${chunk.content.trim()}`;
    })
    .join('\n\n');
}

export function chunksToCitations(chunks: ChunkWithEmbedding[]): DraftCitation[] {
  return chunks.map((chunk) => ({
    sourceType: 'document',
    sourceId: chunk.documentId,
    snippet: chunk.content.trim().slice(0, 200),
  }));
}

export async function retrieveKnowledgeForDraft(
  vectorStore: VectorStore,
  reranker: Reranker,
  projectId: string,
  query: string,
  options?: {
    topK?: number;
    topN?: number;
    minScore?: number;
    /** 仅用于向量 embedding；未传则与 `query` 相同 */
    embeddingQuery?: string;
  }
): Promise<KnowledgeRetrievalResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { chunks: [], citations: [], evidenceText: '', query: trimmed };
  }

  const topK = options?.topK ?? 30;
  const topN = options?.topN ?? 10;
  vectorStore.invalidateProject(projectId);

  const embedOpt = options?.embeddingQuery;
  const retrieved = await vectorStore.retrieve({
    query: trimmed,
    projectId,
    topK,
    minScore: options?.minScore ?? 0,
    ...(embedOpt !== undefined ? { embeddingQuery: embedOpt } : {}),
  });
  const reranked = reranker.rerank(trimmed, retrieved, topN);

  return {
    chunks: reranked,
    citations: chunksToCitations(reranked),
    evidenceText: formatEvidence(reranked),
    query: trimmed,
  };
}

/** 知识库文档（用于标题匹配后整文注入） */
export interface KnowledgeDocumentForMatch {
  id: string;
  title: string;
  content: string;
}

/** 标题匹配后默认注入的文档篇数（本期固定 Top10） */
export const TITLE_MATCHED_FULL_DOC_TOP_N = 10;

export function scoreTitleAgainstMatchingText(matchingText: string, title: string): number {
  const m = matchingText.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  if (!m || !t) {
    return 0;
  }

  let score = 0;
  const segments = m.split(/[\s\n，。、；：,.;:!?《》「」"'“”]+/).filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg.length >= 2 && t.includes(seg)) {
      score += seg.length >= 4 ? 4 : 2;
    }
  }
  const prefix = m.slice(0, Math.min(32, m.length));
  if (prefix.length >= 2 && t.includes(prefix)) {
    score += 8;
  }
  return score;
}

export function pickTopTitleMatchedDocuments(
  matchingText: string,
  docs: KnowledgeDocumentForMatch[],
  topN = TITLE_MATCHED_FULL_DOC_TOP_N
): KnowledgeDocumentForMatch[] {
  if (!matchingText.trim() || docs.length === 0) {
    return [];
  }

  const ranked = [...docs]
    .map((doc) => ({
      doc,
      score: scoreTitleAgainstMatchingText(matchingText, doc.title),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title));

  const seen = new Set<string>();
  const out: KnowledgeDocumentForMatch[] = [];
  for (const row of ranked) {
    if (seen.has(row.doc.id)) {
      continue;
    }
    seen.add(row.doc.id);
    out.push(row.doc);
    if (out.length >= topN) {
      break;
    }
  }
  return out;
}

export function formatFullDocumentKnowledgeEvidence(docs: KnowledgeDocumentForMatch[]): string {
  if (docs.length === 0) {
    return '';
  }
  return docs
    .map((d, index) => {
      return `[知识全文${index + 1}] document_id=${d.id} title=${d.title}\n${d.content.trim()}`;
    })
    .join('\n\n');
}

export interface ChapterKbContextInput {
  chapterNo: number;
  chapters: Array<{
    chapterNo: number;
    structuredMatchingText?: string;
  }>;
  knowledgeDocuments: KnowledgeDocumentForMatch[];
}

export type StructuredKnowledgeRetrievalResult = KnowledgeRetrievalResult & {
  retrievalSkippedNoStructured?: boolean;
  titleMatchedDocumentIds: string[];
};

/**
 * 章节草稿：依赖章节已解析的 `structuredMatchingText`；无则跳过知识库证据。
 * 有则按标题匹配取 TopN 篇文档**全文**作为证据（不走向量 chunk）。
 */
export function buildStructuredKnowledgeEvidence(
  chapterNo: number,
  kbCtx: ChapterKbContextInput,
  topN = TITLE_MATCHED_FULL_DOC_TOP_N
): StructuredKnowledgeRetrievalResult {
  const ch = kbCtx.chapters.find((c) => c.chapterNo === chapterNo);
  const matchingText = ch?.structuredMatchingText?.trim() ?? '';

  if (!matchingText) {
    return {
      chunks: [],
      citations: [],
      evidenceText: '',
      query: '',
      retrievalSkippedNoStructured: true,
      titleMatchedDocumentIds: [],
    };
  }

  const picked = pickTopTitleMatchedDocuments(matchingText, kbCtx.knowledgeDocuments, topN);
  const evidenceText = formatFullDocumentKnowledgeEvidence(picked);
  const chunks: ChunkWithEmbedding[] = picked.map((d, i) => ({
    id: `doc-full:${d.id}`,
    documentId: d.id,
    content: d.content,
    embedding: [],
    metadata: { docTitle: d.title, evidenceKind: 'full_document_by_title' },
    score: 1 - i * 0.001,
  }));

  return {
    chunks,
    citations: chunksToCitations(chunks),
    evidenceText,
    query: matchingText,
    titleMatchedDocumentIds: picked.map((d) => d.id),
  };
}
