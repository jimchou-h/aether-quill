/**
 * OpenAI-compatible chat completion SSE 行解析（跨 TCP chunk 缓冲）。
 */

export type ProviderSseLineResult =
  | { type: 'content'; content: string; finishReason?: string | null }
  | { type: 'reasoning'; finishReason?: string | null }
  | { type: 'done' }
  | { type: 'skip'; finishReason?: string | null }
  | { type: 'malformed'; data: string; error: string };

export function extractProviderChatText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((part) => extractProviderChatText(part)).join('');
  }
  if (value && typeof value === 'object') {
    const record = value as { text?: unknown; content?: unknown };
    if (typeof record.text === 'string') {
      return record.text;
    }
    if (record.content !== undefined && record.content !== value) {
      return extractProviderChatText(record.content);
    }
  }
  return '';
}

export function splitProviderSseBuffer(buffer: string): {
  completeLines: string[];
  remainder: string;
} {
  const parts = buffer.split('\n');
  const remainder = parts.pop() ?? '';
  return { completeLines: parts, remainder };
}

export function parseProviderSseLine(line: string): ProviderSseLineResult {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) {
    return { type: 'skip' };
  }
  if (!trimmed.startsWith('data:')) {
    return { type: 'skip' };
  }

  const data = trimmed.replace(/^data:\s*/, '');
  if (data === '[DONE]') {
    return { type: 'done' };
  }
  if (!data) {
    return { type: 'skip' };
  }

  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        finish_reason?: string | null;
        delta?: {
          content?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
          thinking?: unknown;
        };
        message?: { content?: unknown };
      }>;
    };
    const choice = parsed.choices?.[0];
    const finishReason =
      typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
    const deltaContent = extractProviderChatText(choice?.delta?.content);
    const messageContent = extractProviderChatText(choice?.message?.content);
    const content = deltaContent || messageContent;
    const reasoning = extractProviderChatText(
      choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? choice?.delta?.thinking
    );
    if (content) {
      return { type: 'content', content, finishReason };
    }
    if (reasoning) {
      return { type: 'reasoning', finishReason };
    }
    if (finishReason) {
      return { type: 'skip', finishReason };
    }
    return { type: 'skip' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { type: 'malformed', data, error: message };
  }
}

/**
 * 将新到达的流式字节并入缓冲，返回可消费的完整行解析结果。
 */
export function consumeProviderSseStreamChunk(
  buffer: string,
  chunk: string
): { nextBuffer: string; events: ProviderSseLineResult[] } {
  const combined = buffer + chunk;
  const { completeLines, remainder } = splitProviderSseBuffer(combined);
  const events: ProviderSseLineResult[] = [];

  for (const line of completeLines) {
    events.push(parseProviderSseLine(line));
  }

  return { nextBuffer: remainder, events };
}

export function flushProviderSseStreamBuffer(buffer: string): {
  events: ProviderSseLineResult[];
} {
  const trimmed = buffer.trim();
  if (!trimmed) {
    return { events: [] };
  }
  return { events: [parseProviderSseLine(trimmed)] };
}
