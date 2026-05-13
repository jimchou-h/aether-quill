/**
 * Embedding 供应商抽象（真 RAG：AQ-117 Contract）
 * LLM 生成适配仍使用 {@link ModelProvider}；Embedding 独立接口，便于 SiliconFlow / OpenAI-compatible 切换。
 */

/** V1 生产路径仅启用 siliconflow；openai-compatible 仅占位（见 AQ-118） */
export type EmbeddingProviderKind = 'siliconflow' | 'openai-compatible';

export interface EmbeddingBatchResult {
  embeddings: number[][];
  /** Provider 返回的输入 token 用量（若可得），用于 trace 计费字段 */
  inputTokens?: number;
}

/** 文本向量化（批量）；实现须保证返回向量维度与当前配置的 EMBEDDING_MODEL 一致。 */
export interface EmbeddingProvider {
  readonly kind: EmbeddingProviderKind;

  /**
   * @param texts 非空字符串列表；空串由实现方决定是否过滤或报错
   */
  embed(texts: string[]): Promise<EmbeddingBatchResult>;
}
