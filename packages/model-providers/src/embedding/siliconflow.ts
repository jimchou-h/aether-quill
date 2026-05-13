import type { AxiosInstance } from 'axios';
import axios from 'axios';
import type { EmbeddingBatchResult, EmbeddingProvider } from './types';

export interface SiliconFlowEmbeddingProviderConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

interface OpenAiEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

function resolveTimeoutMs(configMs?: number): number {
  if (configMs !== undefined && Number.isFinite(configMs)) {
    return configMs;
  }
  const fromEnv = Number.parseInt(process.env.LLM_TIMEOUT_MS || '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return 60_000;
}

/**
 * SiliconFlow OpenAI-compatible `/v1/embeddings` 客户端。
 */
export class SiliconFlowEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'siliconflow' as const;
  private readonly client: Pick<AxiosInstance, 'post'>;
  private readonly model: string;

  constructor(config: SiliconFlowEmbeddingProviderConfig, http?: Pick<AxiosInstance, 'post'>) {
    this.model = config.model;
    if (http) {
      this.client = http;
    } else {
      this.client = axios.create({
        baseURL: config.apiBaseUrl.replace(/\/$/, ''),
        timeout: resolveTimeoutMs(config.timeoutMs),
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    }
  }

  async embed(texts: string[]): Promise<EmbeddingBatchResult> {
    if (texts.length === 0) {
      return { embeddings: [] };
    }
    try {
      const { data } = await this.client.post<OpenAiEmbeddingResponse>('/embeddings', {
        model: this.model,
        input: texts,
      });
      const rows = data.data ?? [];
      rows.sort((a, b) => a.index - b.index);
      const embeddings = rows.map((r) => r.embedding);
      if (embeddings.length !== texts.length) {
        throw new Error(
          `embedding count mismatch: expected ${texts.length}, got ${embeddings.length}`
        );
      }
      return {
        embeddings,
        inputTokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens,
      };
    } catch (err) {
      const e = new Error(
        err instanceof Error ? err.message : 'SiliconFlow embedding request failed'
      );
      (e as NodeJS.ErrnoException).code = 'EMBEDDING_PROVIDER_UNAVAILABLE';
      throw e;
    }
  }
}
