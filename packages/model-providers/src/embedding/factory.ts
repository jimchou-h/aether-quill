import { OpenAiCompatibleEmbeddingProvider } from './openai-compatible';
import { SiliconFlowEmbeddingProvider } from './siliconflow';
import type { EmbeddingProvider } from './types';

function trim(key: string): string {
  return (process.env[key] ?? '').trim();
}

function resolveSiliconflowApiKey(): string {
  return trim('SILICONFLOW_API_KEY') || trim('EMBEDDING_API_KEY') || trim('LLM_API_KEY');
}

function resolveSiliconflowApiBase(): string {
  return (
    trim('SILICONFLOW_API_BASE') || trim('EMBEDDING_API_BASE') || 'https://api.siliconflow.cn/v1'
  );
}

/**
 * 从环境变量构造 Embedding 供应商（须已由启动期 `assertRagInfrastructureEnv` 校验）。
 */
export function createEmbeddingProviderFromEnv(): EmbeddingProvider {
  const raw = trim('EMBEDDING_PROVIDER').toLowerCase();
  if (raw === 'openai-compatible') {
    return new OpenAiCompatibleEmbeddingProvider();
  }
  if (raw !== 'siliconflow') {
    throw new Error(`Unsupported EMBEDDING_PROVIDER: "${raw || '(empty)'}"`);
  }
  const model = trim('EMBEDDING_MODEL');
  const apiKey = resolveSiliconflowApiKey();
  const apiBaseUrl = resolveSiliconflowApiBase();
  if (!model || !apiKey) {
    throw new Error('EMBEDDING_MODEL and an API key are required for siliconflow embedding');
  }
  return new SiliconFlowEmbeddingProvider({ apiBaseUrl, apiKey, model });
}
