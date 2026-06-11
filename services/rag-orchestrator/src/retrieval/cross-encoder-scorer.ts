import type { ChunkWithEmbedding } from './types';

/**
 * Cross-encoder 重排扩展点（如 bge-reranker-v2-m3）。
 * 下一批次可接入真实 HTTP 实现；本批次仅脚手架，默认不启用。
 */
export interface CrossEncoderScorer {
  score(query: string, chunks: ChunkWithEmbedding[]): number[];
}

/** `RERANK_PROVIDER=cross-encoder` 时视为启用；未配置或其它值走向量+词法融合。 */
export function isCrossEncoderRerankEnabled(): boolean {
  const provider = (process.env.RERANK_PROVIDER ?? '').trim().toLowerCase();
  return provider === 'cross-encoder' || provider === 'siliconflow-rerank';
}
