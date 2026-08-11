import type { LlmChatProviderId } from './user-generation-preferences';

export interface LlmChatProviderEndpoint {
  provider: LlmChatProviderId;
  providerUrl: string;
  apiKey: string;
}

const DEFAULT_SILICONFLOW_CHAT_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const DEFAULT_DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/v1/chat/completions';

/** SiliconFlow 兼容 chat 默认模型（含 org/ 前缀） */
export const DEFAULT_SILICONFLOW_CHAT_MODEL = 'deepseek-ai/DeepSeek-V3.2';

function joinChatCompletionsUrl(baseOrUrl: string): string {
  const trimmed = baseOrUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

/**
 * Resolve chat completions URL + API key for a vendor.
 * Keys still come from env; PROVIDER_API_KEY is a generic override for either vendor.
 * Vendor-specific URL/base wins; do not reuse the other vendor's PROVIDER_API_URL.
 */
export function resolveLlmChatProviderEndpoint(
  provider: LlmChatProviderId,
  env: NodeJS.ProcessEnv = process.env
): LlmChatProviderEndpoint {
  const genericKey = (env.PROVIDER_API_KEY ?? '').trim();
  if (provider === 'siliconflow') {
    const apiKey = genericKey || (env.SILICONFLOW_API_KEY ?? '').trim();
    if (!apiKey) {
      throw new Error(
        '未配置 SiliconFlow API Key，请设置 SILICONFLOW_API_KEY 或 PROVIDER_API_KEY'
      );
    }
    const fromVendor =
      joinChatCompletionsUrl(env.SILICONFLOW_API_URL ?? '') ||
      joinChatCompletionsUrl(env.SILICONFLOW_API_BASE ?? '');
    const providerUrl = fromVendor || DEFAULT_SILICONFLOW_CHAT_URL;
    return { provider, providerUrl, apiKey };
  }

  const apiKey = genericKey || (env.DEEPSEEK_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('未配置 DeepSeek API Key，请设置 DEEPSEEK_API_KEY 或 PROVIDER_API_KEY');
  }
  const fromVendor = joinChatCompletionsUrl(env.DEEPSEEK_API_URL ?? '');
  const providerUrl = fromVendor || DEFAULT_DEEPSEEK_CHAT_URL;
  return { provider, providerUrl, apiKey };
}

/** DeepSeek 官方 chat 模型名通常不含 `/`；SiliconFlow 模型 id 含 org/name */
export function looksLikeSiliconFlowModelId(model: string): boolean {
  return model.includes('/');
}
