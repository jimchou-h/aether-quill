/**
 * OpenAI-compatible chat completion SSE 行解析（跨 TCP chunk 缓冲）。
 */

export type ProviderSseLineResult =
  | { type: 'content'; content: string }
  | { type: 'done' }
  | { type: 'skip' }
  | { type: 'malformed'; data: string; error: string };

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
      choices?: Array<{ delta?: { content?: string } }>;
    };
    const content = parsed.choices?.[0]?.delta?.content ?? '';
    if (content) {
      return { type: 'content', content };
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
