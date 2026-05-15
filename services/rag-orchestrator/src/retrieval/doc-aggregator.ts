import type { ChunkWithEmbedding } from './types';

export interface AggregatedDocumentHit {
  documentId: string;
  docType: string;
  docScore: number;
  matchedSections: string[];
  hitChunkIds: string[];
  topChunks: ChunkWithEmbedding[];
}

function readDocType(chunk: ChunkWithEmbedding): string {
  const meta = chunk.metadata ?? {};
  const raw = meta.doc_type ?? meta.document_type ?? meta.docType ?? 'document';
  return String(raw).trim() || 'document';
}

function readSection(chunk: ChunkWithEmbedding): string | undefined {
  const meta = chunk.metadata ?? {};
  const raw = meta.section ?? meta.section_key;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return undefined;
}

/**
 * TopK chunk 按 document_id 聚合：docScore 取 chunk 最高分，sections 去重，排序稳定。
 */
export function aggregateChunksByDocument(
  chunks: ChunkWithEmbedding[],
  options?: { maxDocs?: number }
): AggregatedDocumentHit[] {
  const maxDocs = options?.maxDocs ?? 10;
  const byDoc = new Map<string, AggregatedDocumentHit>();

  for (const chunk of chunks) {
    const documentId = chunk.documentId?.trim();
    if (!documentId) {
      continue;
    }
    const score = typeof chunk.score === 'number' ? chunk.score : 0;
    const section = readSection(chunk);
    const docType = readDocType(chunk);

    let row = byDoc.get(documentId);
    if (!row) {
      row = {
        documentId,
        docType,
        docScore: score,
        matchedSections: [],
        hitChunkIds: [],
        topChunks: [],
      };
      byDoc.set(documentId, row);
    }

    row.docScore = Math.max(row.docScore, score);
    if (section && !row.matchedSections.includes(section)) {
      row.matchedSections.push(section);
    }
    if (chunk.id && !row.hitChunkIds.includes(chunk.id)) {
      row.hitChunkIds.push(chunk.id);
    }
    row.topChunks.push(chunk);
    if (docType !== 'document') {
      row.docType = docType;
    }
  }

  const sorted = [...byDoc.values()].sort((a, b) => {
    if (b.docScore !== a.docScore) {
      return b.docScore - a.docScore;
    }
    return a.documentId.localeCompare(b.documentId);
  });

  for (const row of sorted) {
    row.matchedSections.sort();
    row.hitChunkIds.sort();
    row.topChunks.sort((a, c) => (c.score ?? 0) - (a.score ?? 0));
  }

  return sorted.slice(0, maxDocs);
}

export function buildDocumentHitReason(query: string, hit: AggregatedDocumentHit): string {
  const q = query.trim();
  const sectionPart =
    hit.matchedSections.length > 0
      ? `命中段落：${hit.matchedSections.join('、')}`
      : '命中段落：general';
  const chunkPart = `关联片段 ${hit.hitChunkIds.length} 条`;
  const scorePart = `最高相关分 ${hit.docScore.toFixed(3)}`;

  let keywordPart = '';
  if (q) {
    const tokens = q
      .split(/[\s\n，。、；：,.;:!?《》「」"'“”]+/)
      .filter((t) => t.length >= 2)
      .slice(0, 6);
    const hits = tokens.filter((t) =>
      hit.topChunks.some(
        (c) => c.content.includes(t) || String(c.metadata?.docTitle ?? '').includes(t)
      )
    );
    if (hits.length > 0) {
      keywordPart = `；关键词覆盖：${hits.join('、')}`;
    }
  }

  return `${sectionPart}；${chunkPart}；${scorePart}${keywordPart}`;
}
