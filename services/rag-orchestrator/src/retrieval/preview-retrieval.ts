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
import {
  buildStructuredKnowledgeEvidence,
  retrieveKnowledgeForDraft,
  buildGenerationRetrievalQuery,
  resolveMemoryChapterSummaryEmbeddingQuery,
  type KnowledgeDocumentForMatch,
} from './knowledge-retrieval';
import { extractPersonaDisplayName } from './persona-card-evidence';
import { countEvidenceTokens, resolveEvidenceTokenBudget } from './token-budget';
import type { ChunkWithEmbedding } from './types';
import { Reranker } from './reranker';
import { VectorStore } from './vector-store';

export interface PreviewRetrievalRequest {
  projectId: string;
  prompt?: string;
  chapterNo?: number;
  useStructuredKb?: boolean;
  projectCtx: {
    outlineSummary: string;
    personaProfile: string;
    chapters: Array<ChapterSummaryInput & { structuredMatchingText?: string }>;
    knowledgeDocuments?: KnowledgeDocumentForMatch[];
    chapterSummaryPromptCount?: number;
    chapterSummaryMemoryCount?: number;
    priorChapterTailChars?: number;
    contextExcerptMaxChars?: number;
  };
  extraContext?: Record<string, unknown>;
}

export interface PreviewRetrievalItem {
  id: string;
  pool: 'prior_chapter_tail' | 'persona_card' | 'other_docs' | 'recent_chapters' | 'memory_chapters';
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

  const useStructured =
    input.useStructuredKb !== false && chapterNo > 0 && projectCtx.chapters.length > 0;

  if (useStructured) {
    const sr = buildStructuredKnowledgeEvidence(chapterNo, {
      chapterNo,
      chapters: projectCtx.chapters.map((c) => ({
        chapterNo: c.chapterNo,
        structuredMatchingText: c.structuredMatchingText,
      })),
      knowledgeDocuments: projectCtx.knowledgeDocuments ?? [],
    }, { personaTopN: personaQuota, otherTopN: otherQuota });
    structuredEvidenceText = sr.evidenceText;

    const evidenceIds = new Set(sr.evidenceDocumentIds ?? []);
    for (const doc of sr.fullDocuments ?? []) {
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
          canonicalCharacter:
            doc.docType === 'persona_card' ? extractPersonaDisplayName(doc.title) : undefined,
        },
      });
    }
  } else if (query.trim()) {
    const retrieval = await retrieveKnowledgeForDraft(vectorStore, reranker, projectId, query, {
      apiBaseUrl,
      enrichFullDocuments: true,
    });
    for (const doc of retrieval.fullDocuments ?? []) {
      const pool = doc.docType === 'persona_card' ? 'persona_card' : 'other_docs';
      items.push({
        id: doc.documentId,
        pool,
        title: doc.title,
        preview: doc.content.trim().slice(0, 400),
        selected: true,
        meta: { docType: doc.docType },
      });
    }
    const personaIds = new Set(
      (retrieval.fullDocuments ?? [])
        .filter((d) => d.docType === 'persona_card')
        .map((d) => d.documentId)
    );
    const chunkGroups = new Map<string, ChunkWithEmbedding[]>();
    for (const chunk of retrieval.chunks) {
      if (personaIds.has(chunk.documentId)) {
        continue;
      }
      const list = chunkGroups.get(chunk.documentId) ?? [];
      list.push(chunk);
      chunkGroups.set(chunk.documentId, list);
    }
    for (const [docId, chunks] of chunkGroups) {
      if (items.some((i) => i.id === docId)) {
        continue;
      }
      const title =
        typeof chunks[0]?.metadata?.docTitle === 'string'
          ? String(chunks[0].metadata.docTitle)
          : docId;
      items.push({
        id: docId,
        pool: 'other_docs',
        title,
        preview: chunks
          .slice(0, 3)
          .map((c) => c.content.trim())
          .join('\n')
          .slice(0, 400),
        selected: true,
        meta: { chunkIds: chunks.map((c) => c.id) },
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
    query: query || prompt,
  };
}
