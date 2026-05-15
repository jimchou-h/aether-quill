import { createHash } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { getResolvedRagInfrastructureEnv } from '@aether-quill/config';
import type { ChunkResult } from '../jobs/ingestion.processor';

function projectChunksCollectionName(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `aq_${safe}_chunks`;
}

function stablePointId(documentId: string, chunkId: string): string {
  const hex = createHash('sha256').update(`${documentId}::${chunkId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function ensureCollection(client: QdrantClient, name: string, size: number): Promise<void> {
  try {
    await client.getCollection(name);
    return;
  } catch {
    // missing
  }
  await client.createCollection(name, {
    vectors: { size, distance: 'Cosine' },
  });
}

/**
 * 以文档为单位替换 Qdrant 向量：先删后插，保证与 API 侧 index 结果一致。
 */
export async function replaceDocumentVectorsInQdrant(input: {
  projectId: string;
  documentId: string;
  documentType: string;
  versionId: number;
  docTitle: string;
  language: string;
  chunks: ChunkResult['chunks'];
}): Promise<void> {
  const env = getResolvedRagInfrastructureEnv();
  const apiKey = (process.env.QDRANT_API_KEY || '').trim() || undefined;
  const client = new QdrantClient({
    url: env.qdrantUrl,
    apiKey,
    checkCompatibility: false,
  });
  const collection = projectChunksCollectionName(input.projectId);

  if (input.chunks.length === 0) {
    return;
  }

  const dim = input.chunks[0].embedding.length;
  if (!dim) {
    throw new Error('Chunk embedding dimension is zero');
  }

  await ensureCollection(client, collection, dim);

  await client.delete(collection, {
    filter: {
      must: [{ key: 'document_id', match: { value: input.documentId } }],
    },
  });

  const now = new Date().toISOString();
  const points = input.chunks.map((c) => ({
    id: stablePointId(input.documentId, c.id),
    vector: c.embedding,
    payload: {
      project_id: input.projectId,
      document_id: input.documentId,
      document_type: input.documentType,
      doc_type: typeof c.metadata?.doc_type === 'string' ? c.metadata.doc_type : input.documentType,
      version_id: input.versionId,
      chunk_id: c.id,
      section: typeof c.metadata?.section === 'string' ? c.metadata.section : 'general',
      section_title:
        typeof c.metadata?.section_title === 'string' ? c.metadata.section_title : input.docTitle,
      chapter_no: null,
      character_tags: [],
      timeline_tags: [],
      language: input.language,
      created_at: now,
      content: c.content,
      docTitle: input.docTitle,
      embedding: c.embedding,
    },
  }));

  await client.upsert(collection, {
    wait: true,
    points,
  });
}
