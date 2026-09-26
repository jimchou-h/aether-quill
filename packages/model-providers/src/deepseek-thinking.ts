/**
 * 思维链会走 `reasoning_content`，本产品只消费 `content`（章节正文 / 复诊 JSON）。
 * 官方 DeepSeek：V4 默认 thinking，与 content 共享 max_tokens，长输出会被想干。
 * SiliconFlow：DeepSeek-V3.1/V3.2 等默认 `enable_thinking=true`，复诊会空转数分钟才出 content。
 * 官方 `thinking` 字段不能打到带 `/` 的 SiliconFlow 模型 id 上。
 * 直接改写（无已确认方案）显式打开思维链；其余任务默认关闭。
 */
export function isOfficialDeepSeekChatModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized || normalized.includes('/')) {
    return false;
  }
  return (
    normalized.startsWith('deepseek-v4') ||
    normalized === 'deepseek-chat' ||
    normalized === 'deepseek-reasoner'
  );
}

/** SiliconFlow 文档里支持 enable_thinking、且默认 True 的混合推理模型 */
export function isSiliconFlowHybridThinkingModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized.includes('/')) {
    return false;
  }
  return (
    /deepseek-v3\.(1|2)/.test(normalized) ||
    normalized.includes('qwen3') ||
    normalized.includes('hunyuan-a13b') ||
    /glm-4\.[56]v/.test(normalized) ||
    normalized.includes('glm-5v')
  );
}

export function withDeepSeekNonThinkingChatBody(
  body: Record<string, unknown>
): Record<string, unknown> {
  return withChatThinkingMode(body, 'disabled');
}

/** 直接改写没有已确认方案，需要模型先想再写；其余任务默认关思维链。 */
export function shouldEnableChatThinking(templateKey?: string): boolean {
  return (templateKey ?? '').trim() === 'chapter.optimize.direct-draft';
}

/** 思维链与正文共享 max_tokens；开思考时预留一段，避免长改写被想干。 */
export const CHAT_THINKING_TOKEN_RESERVE = 8192;
export const CHAT_THINKING_MAX_TOKENS_CAP = 65536;

export function applyThinkingTokenReserve(
  maxTokens: number,
  thinkingEnabled: boolean
): number {
  if (!thinkingEnabled || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return maxTokens;
  }
  return Math.min(Math.trunc(maxTokens) + CHAT_THINKING_TOKEN_RESERVE, CHAT_THINKING_MAX_TOKENS_CAP);
}

export function shouldRetryChatWithoutThinking(input: {
  thinkingEnabled: boolean;
  contentEmpty: boolean;
  aborted?: boolean;
}): boolean {
  return input.thinkingEnabled && input.contentEmpty && input.aborted !== true;
}

export function formatEmptyChatContentError(input?: {
  sawReasoning?: boolean;
  finishReason?: string | null;
}): string {
  if (input?.sawReasoning || input?.finishReason === 'length') {
    return '模型思维链占满了输出额度，没有留下正文。请重试';
  }
  return '模型未返回正文';
}

export function withChatThinkingMode(
  body: Record<string, unknown>,
  mode: 'enabled' | 'disabled'
): Record<string, unknown> {
  const model = typeof body.model === 'string' ? body.model : '';
  if (isOfficialDeepSeekChatModel(model)) {
    return {
      ...body,
      thinking: { type: mode === 'enabled' ? 'enabled' : 'disabled' },
    };
  }
  if (isSiliconFlowHybridThinkingModel(model)) {
    return {
      ...body,
      enable_thinking: mode === 'enabled',
    };
  }
  return body;
}
