/**
 * DeepSeek V4 默认开启 thinking：思维链走 `reasoning_content`，与最终 `content` 共享 max_tokens。
 * 本产品只消费 `content`（章节正文/方案），写作长输出时 thinking 会占满额度导致空正文。
 * SiliconFlow 模型 id 含 `/`，不要附加官方 thinking 字段。
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

export function withDeepSeekNonThinkingChatBody(
  body: Record<string, unknown>
): Record<string, unknown> {
  const model = typeof body.model === 'string' ? body.model : '';
  if (!isOfficialDeepSeekChatModel(model)) {
    return body;
  }
  return {
    ...body,
    thinking: { type: 'disabled' },
  };
}
