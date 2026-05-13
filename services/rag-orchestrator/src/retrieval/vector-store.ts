import { getEmbeddingProvider } from '@aether-quill/model-providers';
import { getResolvedRagInfrastructureEnv } from '@aether-quill/config';
import { ChunkWithEmbedding } from './types';
import {
  createQdrantClientFromEnv,
  ensureProjectChunkCollection,
  projectChunksCollectionName,
} from './qdrant-client';

type QdrantSearchHit = {
  id: string | number;
  score?: number;
  payload?: Record<string, unknown> | null;
};

function extractSearchPoints(raw: unknown): QdrantSearchHit[] {
  if (Array.isArray(raw)) {
    return raw as QdrantSearchHit[];
  }
  if (raw && typeof raw === 'object' && 'points' in raw) {
    const pts = (raw as { points?: unknown }).points;
    if (Array.isArray(pts)) {
      return pts as QdrantSearchHit[];
    }
  }
  return [];
}

export class VectorStore {
  private readonly env = getResolvedRagInfrastructureEnv();
  private readonly qdrant = createQdrantClientFromEnv(this.env);

  /**
   * @deprecated 真检索走 Qdrant，不再从 API 预拉全量 chunks；保留空实现以兼容旧调用。
   */
  async ensureProjectChunks(_projectId: string): Promise<ChunkWithEmbedding[]> {
    void _projectId;
    return [];
  }

  async retrieve(request: {
    query: string;
    projectId: string;
    topK?: number;
    minScore?: number;
  }): Promise<ChunkWithEmbedding[]> {
    const topK = request.topK ?? this.env.retrievalTopK;
    const minScore = request.minScore ?? this.env.retrievalMinScore;
    const collection = projectChunksCollectionName(request.projectId);

    const query = request.query.trim();
    if (!query) {
      return [];
    }

    try {
      const provider = getEmbeddingProvider();
      const { embeddings } = await provider.embed([query]);
      const vector = embeddings[0];
      if (!vector?.length) {
        return [];
      }

      await ensureProjectChunkCollection(this.qdrant, collection, vector.length);

      const res = await this.qdrant.search(collection, {
        vector,
        limit: topK,
        with_payload: true,
        score_threshold: minScore,
      });

      const rows = extractSearchPoints(res);
      return rows.map((p) => {
        const payload = (p.payload ?? {}) as Record<string, unknown>;
        const content = String(payload.content ?? '');
        const embedding = Array.isArray(payload.embedding) ? (payload.embedding as number[]) : [];
        return {
          id: String(payload.chunk_id ?? p.id),
          documentId: String(payload.document_id ?? ''),
          content,
          embedding,
          metadata: {
            ...payload,
            docTitle: payload.docTitle ?? payload.doc_title,
            score: p.score,
          },
          score: typeof p.score === 'number' ? p.score : undefined,
        };
      });
    } catch (error) {
      console.error(`Qdrant retrieve failed for project ${request.projectId}:`, error);
      return [];
    }
  }

  invalidateProject(_projectId: string): void {
    void _projectId;
  }
}
