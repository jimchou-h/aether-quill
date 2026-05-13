import type { EmbeddingBatchResult, EmbeddingProvider } from './types';

/**
 * OpenAI-compatible Embedding 占位（V1.5 实装；当前不得在生产 ENV 中启用）。
 */
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'openai-compatible' as const;

  async embed(_texts: string[]): Promise<EmbeddingBatchResult> {
    void _texts;
    throw new Error('OpenAI-compatible embedding provider is not implemented (planned V1.5)');
  }
}
