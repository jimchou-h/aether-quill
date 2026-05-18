import {
  aggregateChunksByDocument,
  buildDocumentHitReason,
  type AggregatedDocumentHit,
} from './doc-aggregator';
import { fetchDocumentsBatch, type BatchDocumentRecord } from './document-batch-client';
import {
  formatKnowledgeEvidenceBlock,
  formatPersonaCardEvidenceBlock,
  prependMultiPersonaPreamble,
} from './persona-card-evidence';
import type { ChunkWithEmbedding } from './types';

export interface RetrievalFullDocument {
  documentId: string;
  title: string;
  content: string;
  docType: string;
  matchedSections: string[];
  reason: string;
  docScore: number;
  hitChunkIds: string[];
}

export interface EnrichedKnowledgeRetrieval {
  chunks: ChunkWithEmbedding[];
  fullDocuments: RetrievalFullDocument[];
  evidenceText: string;
}

const PERSONA_CARD_TYPE = 'persona_card';

function formatChunkEvidence(chunks: ChunkWithEmbedding[]): string {
  if (chunks.length === 0) {
    return '';
  }
  return chunks
    .map((chunk, index) => {
      const title =
        typeof chunk.metadata?.docTitle === 'string' ? chunk.metadata.docTitle : '未命名文档';
      const cid = chunk.id?.trim() || `chunk-${index + 1}`;
      const section =
        typeof chunk.metadata?.section === 'string' ? chunk.metadata.section : 'general';
      return `[证据${index + 1}] chunk_id=${cid} doc=${title} section=${section}\n${chunk.content.trim()}`;
    })
    .join('\n\n');
}

function formatFullDocumentEvidence(docs: RetrievalFullDocument[]): string {
  if (docs.length === 0) {
    return '';
  }
  const personaDocs = docs.filter((d) => d.docType === PERSONA_CARD_TYPE);
  const otherDocs = docs.filter((d) => d.docType !== PERSONA_CARD_TYPE);
  const personaBlocks = personaDocs.map((d) =>
    formatPersonaCardEvidenceBlock({
      documentId: d.documentId,
      title: d.title,
      content: d.content,
      reason: d.reason,
    })
  );
  const otherBlocks = otherDocs.map((d, index) => formatKnowledgeEvidenceBlock(d, index));
  const body = [...personaBlocks, ...otherBlocks].join('\n\n');
  return prependMultiPersonaPreamble(body, personaBlocks.length);
}

function pickChunksForEvidence(
  aggregated: AggregatedDocumentHit[],
  personaCardIds: Set<string>
): ChunkWithEmbedding[] {
  const out: ChunkWithEmbedding[] = [];
  for (const row of aggregated) {
    if (personaCardIds.has(row.documentId)) {
      continue;
    }
    out.push(...row.topChunks.slice(0, 3));
  }
  return out;
}

/**
 * 向量检索结果增强：doc 聚合 → 角色卡批量回表 → 拼装 evidence。
 */
export async function enrichVectorRetrieval(
  apiBaseUrl: string,
  projectId: string,
  query: string,
  chunks: ChunkWithEmbedding[],
  options?: { maxDocs?: number }
): Promise<EnrichedKnowledgeRetrieval> {
  const aggregated = aggregateChunksByDocument(chunks, options);
  const personaHits = aggregated.filter((a) => a.docType === PERSONA_CARD_TYPE);
  const personaIds = personaHits.map((h) => h.documentId);

  let batchDocs: BatchDocumentRecord[] = [];
  if (personaIds.length > 0) {
    try {
      batchDocs = await fetchDocumentsBatch(apiBaseUrl, projectId, personaIds);
    } catch (error) {
      console.error('fetchDocumentsBatch failed:', error);
    }
  }

  const batchById = new Map(batchDocs.map((d) => [d.id, d]));
  const fullDocuments: RetrievalFullDocument[] = [];

  for (const hit of personaHits) {
    const doc = batchById.get(hit.documentId);
    const title =
      doc?.title ||
      (typeof hit.topChunks[0]?.metadata?.docTitle === 'string'
        ? String(hit.topChunks[0].metadata.docTitle)
        : '未命名文档');
    const content = doc?.content?.trim()
      ? doc.content
      : hit.topChunks.map((c) => c.content).join('\n\n');
    fullDocuments.push({
      documentId: hit.documentId,
      title,
      content,
      docType: PERSONA_CARD_TYPE,
      matchedSections: hit.matchedSections,
      reason: buildDocumentHitReason(query, hit),
      docScore: hit.docScore,
      hitChunkIds: hit.hitChunkIds,
    });
  }

  const personaCardIds = new Set(personaIds);
  const chunkEvidence = formatChunkEvidence(pickChunksForEvidence(aggregated, personaCardIds));
  const fullEvidence = formatFullDocumentEvidence(fullDocuments);
  const evidenceText = [fullEvidence, chunkEvidence].filter(Boolean).join('\n\n');

  return {
    chunks,
    fullDocuments,
    evidenceText,
  };
}

export function buildFullDocumentsFromTitleMatches(
  query: string,
  docs: Array<{ id: string; title: string; content: string }>,
  docType = PERSONA_CARD_TYPE
): RetrievalFullDocument[] {
  return docs.map((d, index) => ({
    documentId: d.id,
    title: d.title,
    content: d.content,
    docType,
    matchedSections: ['title_match'],
    reason: `标题与结构化匹配文本相关（排名第 ${index + 1}）`,
    docScore: 1 - index * 0.001,
    hitChunkIds: [`doc-full:${d.id}`],
  }));
}
