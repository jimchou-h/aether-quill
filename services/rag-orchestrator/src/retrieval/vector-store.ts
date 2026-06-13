/**
 * 向量检索 — Qdrant 封装
 *
 * 流程：embeddingQuery → EmbeddingProvider → Qdrant search（按 project 独立 collection）
 *
 * - `query`：用于上游 rerank 的完整文本
 * - `embeddingQuery`（可选）：仅该文本参与 embedding；传空串则跳过向量检索
 *
 * Worker 入库的 chunk payload 含 content / document_id / docTitle 等字段；
 * 检索失败时返回空数组（main 层对部分端点有关键词 fallback）。
 */

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
    /**
     * 若传入则仅该文本参与 embedding；未传则使用 `query`。
     * 传空字符串表示跳过向量检索（仍可将 `query` 用于上游 rerank 等）。
     */
    embeddingQuery?: string;
  }): Promise<ChunkWithEmbedding[]> {
    const topK = request.topK ?? this.env.retrievalTopK;
    const minScore = request.minScore ?? this.env.retrievalMinScore;
    const collection = projectChunksCollectionName(request.projectId);

    const embedText = (
      request.embeddingQuery !== undefined ? request.embeddingQuery : request.query
    ).trim();
    if (!embedText) {
      return [];
    }

    try {
      const provider = getEmbeddingProvider();
      const { embeddings } = await provider.embed([embedText]);
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
