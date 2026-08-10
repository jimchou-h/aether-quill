import type { LlmChatProviderId } from './user-generation-preferences';

export interface LlmChatProviderEndpoint {
  provider: LlmChatProviderId;
  providerUrl: string;
  apiKey: string;
}

/**
 * Resolve chat completions URL + API key for a vendor.
 * Keys still come from env; PROVIDER_API_KEY is a generic override for either vendor.
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
    const providerUrl =
      (env.SILICONFLOW_API_URL ?? '').trim() ||
      (env.PROVIDER_API_URL ?? '').trim() ||
      'https://api.siliconflow.cn/v1/chat/completions';
    return { provider, providerUrl, apiKey };
  }

  const apiKey = genericKey || (env.DEEPSEEK_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('未配置 DeepSeek API Key，请设置 DEEPSEEK_API_KEY 或 PROVIDER_API_KEY');
  }
  const providerUrl =
    (env.DEEPSEEK_API_URL ?? '').trim() ||
    (env.PROVIDER_API_URL ?? '').trim() ||
    'https://api.deepseek.com/v1/chat/completions';
  return { provider, providerUrl, apiKey };
}
