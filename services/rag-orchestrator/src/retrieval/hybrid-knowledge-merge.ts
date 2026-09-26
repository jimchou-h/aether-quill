import type { RetrievalFullDocument } from './retrieval-enrichment';
import type {
  KnowledgeRetrievalResult,
  StructuredKnowledgeRetrievalResult,
} from './knowledge-retrieval';
import {
  PERSONA_CARD_DOC_TYPE,
  TITLE_MATCHED_OTHER_DOC_TOP_N,
} from './knowledge-retrieval';
import { aggregateChunksByDocument, buildDocumentHitReason } from './doc-aggregator';
import { resolveEvidenceTokenBudget, trimEvidencePreferPersonaCards } from './token-budget';
import {
  assembleStructuredEvidenceText,
  formatKnowledgeEvidenceBlock,
} from './persona-card-evidence';

export type EvidenceSource =
  | 'title_match'
  | 'paragraph_crop_by_title'
  | 'full_document_by_title'
  | 'vector'
  | 'vector_full_document';

export type RetrievalMode = 'structured' | 'vector' | 'hybrid' | 'skipped';

export interface HybridMergeResult extends KnowledgeRetrievalResult {
  retrievalMode: RetrievalMode;
  titleMatchedDocumentIds: string[];
  vectorDocumentIds: string[];
  evidenceDocumentIds: string[];
  dualHitDocumentIds: string[];
  retrievalSkippedNoStructured?: boolean;
}

function isPersona(docType: string | undefined): boolean {
  return (docType || '').trim() === PERSONA_CARD_DOC_TYPE;
}

function inferEvidenceSource(doc: RetrievalFullDocument): EvidenceSource {
  if (doc.evidenceSource) {
    return doc.evidenceSource;
  }
  const sections = doc.matchedSections ?? [];
  if (sections.includes('title_match') || sections.includes('full_document_by_title')) {
    return isPersona(doc.docType) ? 'full_document_by_title' : 'title_match';
  }
  if (sections.includes('paragraph_crop') || sections.includes('paragraph_crop_by_title')) {
    return 'paragraph_crop_by_title';
  }
  return isPersona(doc.docType) ? 'vector_full_document' : 'vector';
}

/**
 * `retrieveKnowledgeForDraft` 的 `fullDocuments` 仅回表角色卡（`enrichVectorRetrieval` 只对
 * persona_card 命中拉全文），其余文档只以 chunk 形式存在。这里从 `vector.chunks` 按
 * documentId 聚合出非角色卡文档，使其也能作为 B 路径证据参与合并，而不是被静默丢弃。
 */
function buildVectorOtherDocuments(
  vector: KnowledgeRetrievalResult | null,
  excludeDocumentIds: Set<string>,
  maxDocs: number
): RetrievalFullDocument[] {
  if (!vector || vector.chunks.length === 0) {
    return [];
  }
  const aggregated = aggregateChunksByDocument(vector.chunks, { maxDocs: maxDocs + 20 });
  const out: RetrievalFullDocument[] = [];
  for (const hit of aggregated) {
    if (isPersona(hit.docType) || excludeDocumentIds.has(hit.documentId)) {
      continue;
    }
    const title =
      typeof hit.topChunks[0]?.metadata?.docTitle === 'string'
        ? String(hit.topChunks[0].metadata.docTitle)
        : hit.documentId;
    const content = hit.topChunks
      .slice(0, 3)
      .map((c) => c.content.trim())
      .join('\n\n');
    out.push({
      documentId: hit.documentId,
      title,
      content,
      docType: hit.docType,
      matchedSections: hit.matchedSections.length > 0 ? hit.matchedSections : ['vector'],
      reason: buildDocumentHitReason(vector.query, hit),
      docScore: hit.docScore,
      hitChunkIds: hit.hitChunkIds,
      evidenceSource: 'vector',
    });
    if (out.length >= maxDocs) {
      break;
    }
  }
  return out;
}

function withSource(
  doc: RetrievalFullDocument,
  source: EvidenceSource,
  dualHit = false
): RetrievalFullDocument {
  return {
    ...doc,
    evidenceSource: source,
    dualHit: dualHit || doc.dualHit,
    matchedSections: Array.from(new Set([...(doc.matchedSections ?? []), source])),
    reason: dualHit && !doc.reason.includes('双通道') ? `${doc.reason}；双通道命中` : doc.reason,
  };
}

/**
 * 标题匹配 A 优先 + 向量 B 补足，按 documentId 去重。
 * AQ-360：章节路径融合检索。
 */
export function mergeTitleAndVectorEvidence(
  structured: StructuredKnowledgeRetrievalResult | null,
  vector: KnowledgeRetrievalResult | null,
  quotas?: { personaTopN?: number; otherTopN?: number }
): HybridMergeResult {
  const otherTopN = quotas?.otherTopN ?? TITLE_MATCHED_OTHER_DOC_TOP_N;

  const titleDocs = structured?.fullDocuments ?? [];
  const titleIds = new Set(titleDocs.map((d) => d.documentId));
  const vectorOtherDocs = buildVectorOtherDocuments(vector, titleIds, otherTopN);
  const seenVectorIds = new Set<string>();
  const vectorDocs: RetrievalFullDocument[] = [];
  for (const d of [...(vector?.fullDocuments ?? []), ...vectorOtherDocs]) {
    if (seenVectorIds.has(d.documentId)) {
      continue;
    }
    seenVectorIds.add(d.documentId);
    vectorDocs.push(withSource(d, isPersona(d.docType) ? 'vector_full_document' : 'vector'));
  }

  const vectorIds = vectorDocs.map((d) => d.documentId);
  const dualHitDocumentIds = vectorIds.filter((id) => titleIds.has(id));

  const titled = titleDocs.map((d) => {
    const dual = dualHitDocumentIds.includes(d.documentId);
    const source = inferEvidenceSource(d);
    const normalized =
      source === 'vector' || source === 'vector_full_document'
        ? isPersona(d.docType)
          ? 'full_document_by_title'
          : 'title_match'
        : source;
    return withSource(d, normalized, dual);
  });

  const vectorOnly = vectorDocs.filter((d) => !titleIds.has(d.documentId));

  const personaFromTitle = titled.filter((d) => isPersona(d.docType));
  const otherFromTitle = titled.filter((d) => !isPersona(d.docType));
  const personaFromVector = vectorOnly.filter((d) => isPersona(d.docType));
  const otherFromVector = vectorOnly.filter((d) => !isPersona(d.docType));

  const personas = [...personaFromTitle, ...personaFromVector];
  const others = [
    ...otherFromTitle,
    ...otherFromVector.slice(0, Math.max(0, otherTopN - otherFromTitle.length)),
  ].slice(0, otherTopN);

  const fullDocuments = [...personas, ...others];
  const evidenceBlocks = fullDocuments.map((d, index) => formatKnowledgeEvidenceBlock(d, index));
  const budget = resolveEvidenceTokenBudget();
  const { texts: trimmedBlocks, includedIndices } = trimEvidencePreferPersonaCards(
    fullDocuments,
    evidenceBlocks,
    budget
  );
  const evidenceText = assembleStructuredEvidenceText(
    fullDocuments,
    includedIndices,
    trimmedBlocks
  );
  const evidenceDocumentIds = includedIndices
    .map((i) => fullDocuments[i]?.documentId)
    .filter(Boolean) as string[];

  const titleMatchedDocumentIds =
    structured?.titleMatchedDocumentIds ?? titled.map((d) => d.documentId);
  const hasTitle = titleMatchedDocumentIds.length > 0 || Boolean(structured?.evidenceText?.trim());
  const hasVectorOnly = vectorOnly.length > 0;
  const hasVectorSignal = hasVectorOnly || Boolean(vector?.chunks?.length);

  let retrievalMode: RetrievalMode = 'skipped';
  if (hasTitle && hasVectorSignal) retrievalMode = 'hybrid';
  else if (hasTitle) retrievalMode = 'structured';
  else if (hasVectorSignal) retrievalMode = 'vector';
  else if (structured?.retrievalSkippedNoStructured) retrievalMode = 'skipped';

  const keptIdSet = new Set(fullDocuments.map((d) => d.documentId));
  const chunks = [...(structured?.chunks ?? []), ...(vector?.chunks ?? [])].filter((c) =>
    keptIdSet.has(c.documentId)
  );
  const citations = [...(structured?.citations ?? []), ...(vector?.citations ?? [])].filter((c) =>
    keptIdSet.has(c.sourceId)
  );

  return {
    chunks,
    citations,
    evidenceText,
    query: structured?.query?.trim() || vector?.query || '',
    fullDocuments,
    retrievalMode,
    titleMatchedDocumentIds,
    vectorDocumentIds: Array.from(new Set(vectorIds)),
    evidenceDocumentIds,
    dualHitDocumentIds,
    retrievalSkippedNoStructured:
      Boolean(structured?.retrievalSkippedNoStructured) && !hasVectorSignal,
  };
}
