/**
 * 检索预览 — 前端调试「本次生成会注入哪些上下文/证据」
 *
 * 汇总各证据池（前章衔接、人物快照、角色卡、其他文档、近期章、语义记忆）的候选条目，
 * 并计算 token 预算占用，不实际调用 LLM。
 */

import { retrieveMemoryChapterSummaries } from '../context/chapter-summary-memory';
import {
  clampChapterSummaryMemoryCount,
  clampChapterSummaryPromptCount,
  clampContextExcerptMaxChars,
  clampKnowledgeDocQuota,
  clampPriorChapterTailChars,
} from '../context/generation-preferences';
import {
  pickPriorChapterSummariesForPrompt,
  type ChapterSummaryInput,
} from '../context/prior-chapter-summaries';
import { resolvePriorChapterTail } from '../context/prior-chapter-tail';
import { buildPersonaSnapshotSection } from '../context/persona-snapshot';
import {
  buildStructuredKnowledgeEvidence,
  retrieveKnowledgeForDraft,
  buildEmbeddingRetrievalQuery,
  buildGenerationRetrievalQuery,
  resolveChapterScopedEmbeddingQuery,
  resolveMemoryChapterSummaryEmbeddingQuery,
  type KnowledgeDocumentForMatch,
  type StructuredKnowledgeRetrievalResult,
  type KnowledgeRetrievalResult,
} from './knowledge-retrieval';
import { extractPersonaDisplayName } from './persona-card-evidence';
import {
  listPersonaCardsFromKnowledgeDocs,
  mapChaptersForStructuredKnowledgeMatch,
  parseAppearingCharactersFromExtra,
  shouldApplyChapterOptimizeMatchingBoost,
} from './optimize-matching-text';
import { mergeTitleAndVectorEvidence, type RetrievalMode } from './hybrid-knowledge-merge';
import { countEvidenceTokens, resolveEvidenceTokenBudget } from './token-budget';
import { Reranker } from './reranker';
import { VectorStore } from './vector-store';

/** 请求侧检索策略：auto 由是否有 structuredMatchingText 决定，其余为强制指定 */
export type PreviewRetrievalModeParam = 'auto' | 'structured_only' | 'vector_only' | 'hybrid';

export interface PreviewRetrievalRequest {
  projectId: string;
  prompt?: string;
  chapterNo?: number;
  useStructuredKb?: boolean;
  /** AQ-360：默认 auto（标题匹配为主 + 向量补足），可强制 structured_only/vector_only/hybrid */
  retrievalMode?: PreviewRetrievalModeParam;
  projectCtx: {
    outlineSummary: string;
    personaProfile: string;
    chapters: Array<ChapterSummaryInput & { structuredMatchingText?: string }>;
    knowledgeDocuments?: KnowledgeDocumentForMatch[];
    chapterSummaryPromptCount?: number;
    chapterSummaryMemoryCount?: number;
    priorChapterTailChars?: number;
    contextExcerptMaxChars?: number;
    personas?: import('../context/persona-snapshot').PersonaContextPayload[];
  };
  extraContext?: Record<string, unknown>;
}

export interface PreviewRetrievalItem {
  id: string;
  pool:
    | 'prior_chapter_tail'
    | 'persona_snapshots'
    | 'persona_card'
    | 'other_docs'
    | 'recent_chapters'
    | 'memory_chapters';
  title: string;
  preview: string;
  score?: number;
  selected: boolean;
  meta?: Record<string, unknown>;
}

export interface PreviewRetrievalResult {
  items: PreviewRetrievalItem[];
  tokenBudget: number;
  tokenUsed: number;
  query: string;
  /** AQ-360：本次实际生效的检索模式（auto 已按数据情况归一为具体值） */
  retrievalMode: RetrievalMode;
  titleMatchedDocumentIds: string[];
  vectorDocumentIds: string[];
  mergedDocumentIds: string[];
  dualHitDocumentIds: string[];
}

export async function runPreviewRetrieval(
  vectorStore: VectorStore,
  reranker: Reranker,
  apiBaseUrl: string,
  input: PreviewRetrievalRequest
): Promise<PreviewRetrievalResult> {
  const { projectId, projectCtx } = input;
  const chapterNo = Number(input.chapterNo) || 0;
  const prompt = String(input.prompt ?? '').trim();
  const query = buildGenerationRetrievalQuery(prompt, projectCtx, input.extraContext);

  const personaQuota = clampKnowledgeDocQuota(process.env.PERSONA_CARD_DOC_QUOTA);
  const otherQuota = clampKnowledgeDocQuota(process.env.OTHER_DOC_QUOTA);
  const items: PreviewRetrievalItem[] = [];
  let structuredEvidenceText = '';

  const tailChars = clampPriorChapterTailChars(projectCtx.priorChapterTailChars);
  const excerptMax = clampContextExcerptMaxChars(projectCtx.contextExcerptMaxChars);

  if (chapterNo > 1 && tailChars > 0) {
    const priorTail = resolvePriorChapterTail(projectCtx.chapters, chapterNo, tailChars);
    if (!priorTail.skipped && priorTail.text) {
      items.push({
        id: `prior_tail:${priorTail.chapterNo ?? chapterNo - 1}`,
        pool: 'prior_chapter_tail',
        title: `第${priorTail.chapterNo ?? chapterNo - 1}章 末尾衔接`,
        preview: priorTail.text.slice(0, 400),
        selected: true,
        meta: {
          chapterNo: priorTail.chapterNo,
          prior_chapter_tail_chars: priorTail.chars,
        },
      });
    }
  }

  const snapshotSection = buildPersonaSnapshotSection({
    personas: projectCtx.personas ?? [],
    currentChapterNo: chapterNo > 0 ? chapterNo : undefined,
  });
  if (snapshotSection.text) {
    items.push({
      id: 'persona_snapshots:all',
      pool: 'persona_snapshots',
      title: '人物当前快照（着装 + 状态）',
      preview: snapshotSection.text.slice(0, 400),
      selected: true,
      meta: {
        persona_snapshot_injected_count: snapshotSection.injectedCount,
        persona_snapshot_as_of_chapter: snapshotSection.asOfChapterNo,
      },
    });
  }

  const requestedMode = input.retrievalMode ?? 'auto';
  const canStructured =
    input.useStructuredKb !== false && chapterNo > 0 && projectCtx.chapters.length > 0;
  const wantStructured = canStructured && requestedMode !== 'vector_only';
  const wantVector = requestedMode !== 'structured_only';

  let structuredMatchingQuery = '';
  let sr: StructuredKnowledgeRetrievalResult | null = null;

  if (wantStructured) {
    const extra = input.extraContext;
    const optimizeInstruction = (
      typeof extra?.retrievalInstruction === 'string' ? extra.retrievalInstruction : prompt
    ).trim();
    const appearingCharacters = parseAppearingCharactersFromExtra(extra);
    const personaCards = listPersonaCardsFromKnowledgeDocs(
      projectCtx.knowledgeDocuments ?? [],
      projectCtx.personas
    );
    const optimizeBoost = shouldApplyChapterOptimizeMatchingBoost({
      instruction: optimizeInstruction,
      appearingCharacters,
    })
      ? {
          instruction: optimizeInstruction,
          appearingCharacters,
          personaCards,
        }
      : undefined;

    sr = buildStructuredKnowledgeEvidence(
      chapterNo,
      {
        chapterNo,
        chapters: mapChaptersForStructuredKnowledgeMatch(
          projectCtx.chapters.map((c) => ({
            chapterNo: c.chapterNo,
            structuredMatchingText: c.structuredMatchingText,
          })),
          chapterNo,
          optimizeBoost
        ),
        knowledgeDocuments: projectCtx.knowledgeDocuments ?? [],
      },
      { personaTopN: personaQuota, otherTopN: otherQuota }
    );
    structuredMatchingQuery = sr.query.trim();
  }

  // AQ-360：标题匹配（A）保留命中，向量检索（B）作为补足；无 structuredMatchingText 时 B 兜底，不再空证据
  let vectorPart: KnowledgeRetrievalResult | null = null;
  if (wantVector) {
    const chapterScopedEmbeddingQuery =
      chapterNo > 0
        ? resolveChapterScopedEmbeddingQuery(
            { chapters: projectCtx.chapters },
            chapterNo,
            chapterNo
          )
        : undefined;
    const embeddingQuery =
      chapterScopedEmbeddingQuery !== undefined && chapterScopedEmbeddingQuery.trim()
        ? chapterScopedEmbeddingQuery
        : buildEmbeddingRetrievalQuery(prompt, projectCtx, input.extraContext);
    const vectorQueryText = (sr?.query?.trim() || query || prompt).trim();

    if (vectorQueryText) {
      try {
        vectorPart = await retrieveKnowledgeForDraft(
          vectorStore,
          reranker,
          projectId,
          vectorQueryText,
          { apiBaseUrl, enrichFullDocuments: true, embeddingQuery }
        );
      } catch (error) {
        console.error('Preview retrieval vector supplement failed:', error);
      }
    }
  }

  let retrievalMode: RetrievalMode = 'skipped';
  let titleMatchedDocumentIds: string[] = [];
  let vectorDocumentIds: string[] = [];
  let dualHitDocumentIds: string[] = [];
  let mergedDocumentIds: string[] = [];

  if (sr || vectorPart) {
    const merged = mergeTitleAndVectorEvidence(sr, vectorPart, {
      personaTopN: personaQuota,
      otherTopN: otherQuota,
    });
    structuredEvidenceText = merged.evidenceText;
    retrievalMode = merged.retrievalMode;
    titleMatchedDocumentIds = merged.titleMatchedDocumentIds;
    vectorDocumentIds = merged.vectorDocumentIds;
    dualHitDocumentIds = merged.dualHitDocumentIds;
    mergedDocumentIds = (merged.fullDocuments ?? []).map((d) => d.documentId);

    const evidenceIds = new Set(merged.evidenceDocumentIds ?? []);
    for (const doc of merged.fullDocuments ?? []) {
      const pool = doc.docType === 'persona_card' ? 'persona_card' : 'other_docs';
      const included = evidenceIds.has(doc.documentId);
      items.push({
        id: doc.documentId,
        pool,
        title: doc.title,
        preview: doc.content.trim().slice(0, 400),
        score: doc.docScore,
        selected: included,
        meta: {
          docType: doc.docType,
          reason: doc.reason,
          excludedByTokenBudget: !included,
          evidenceSource: doc.evidenceSource,
          dualHit: doc.dualHit === true,
          canonicalCharacter:
            doc.docType === 'persona_card' ? extractPersonaDisplayName(doc.title) : undefined,
        },
      });
    }
  }

  const recentMax = clampChapterSummaryPromptCount(projectCtx.chapterSummaryPromptCount);
  const recent = pickPriorChapterSummariesForPrompt(projectCtx.chapters, {
    currentChapterNo: chapterNo > 0 ? chapterNo : undefined,
    maxCount: recentMax,
    excerptMaxChars: excerptMax,
  });
  for (const ch of recent) {
    items.push({
      id: `recent:${ch.chapterNo}`,
      pool: 'recent_chapters',
      title: `第${ch.chapterNo}章 ${ch.title}${ch.usedExcerptFallback ? '（正文摘录）' : ''}`,
      preview: ch.summary.trim().slice(0, 400),
      selected: true,
      meta: {
        chapterNo: ch.chapterNo,
        excerptFallback: ch.usedExcerptFallback === true,
      },
    });
  }

  const memoryMax = clampChapterSummaryMemoryCount(projectCtx.chapterSummaryMemoryCount);
  const memoryEmbedQuery = resolveMemoryChapterSummaryEmbeddingQuery({
    currentChapterNo: chapterNo > 0 ? chapterNo : undefined,
    chapters: projectCtx.chapters,
    fallbackPrompt: prompt,
  });
  const memory = await retrieveMemoryChapterSummaries(projectId, memoryEmbedQuery, {
    currentChapterNo: chapterNo > 0 ? chapterNo : undefined,
    maxCount: memoryMax,
    excludeChapterNos: recent.map((ch) => ch.chapterNo),
  });
  for (const ch of memory) {
    items.push({
      id: `memory:${ch.chapterNo}`,
      pool: 'memory_chapters',
      title: `第${ch.chapterNo}章 ${ch.title}`,
      preview: ch.summary.trim().slice(0, 400),
      selected: true,
      meta: { chapterNo: ch.chapterNo },
    });
  }

  const tokenBudget = resolveEvidenceTokenBudget();
  const tokenUsed = structuredEvidenceText
    ? countEvidenceTokens(structuredEvidenceText)
    : countEvidenceTokens(
        items
          .filter((i) => i.selected)
          .map((i) => i.preview)
          .join('\n')
      );

  return {
    items,
    tokenBudget,
    tokenUsed,
    query: structuredMatchingQuery || query || prompt,
    retrievalMode,
    titleMatchedDocumentIds,
    vectorDocumentIds,
    mergedDocumentIds,
    dualHitDocumentIds,
  };
}
