import axios from 'axios';
import { Readable } from 'node:stream';

async function readStreamText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function messageFromPayload(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed || null;
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  for (const key of ['message', 'error', 'msg', 'data'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (value && typeof value === 'object') {
      const nested = messageFromPayload(value);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

/**
 * Turn axios / orchestrator failures into a user-readable Chinese (or upstream) message.
 * Handles responseType:'stream' error bodies that arrive as Readable streams.
 */
export async function resolveUpstreamFailureMessage(
  error: unknown,
  fallback: string
): Promise<string> {
  if (!axios.isAxiosError(error)) {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    return fallback;
  }

  const status = error.response?.status;
  let payload: unknown = error.response?.data;

  if (payload && typeof payload === 'object' && typeof (payload as Readable).pipe === 'function') {
    try {
      const raw = await readStreamText(payload as Readable);
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    } catch {
      payload = undefined;
    }
  }

  const fromBody = messageFromPayload(payload);
  if (fromBody) {
    if (status != null && !/HTTP\s+\d+/i.test(fromBody)) {
      return `${fromBody}（HTTP ${status}）`;
    }
    return fromBody;
  }

  const generic = error.message?.trim() || '';
  if (generic && !/^Request failed with status code \d+$/i.test(generic)) {
    return generic;
  }

  if (status != null) {
    return `${fallback}（HTTP ${status}）`;
  }
  return fallback;
}

export function isMissingLlmProviderKeyMessage(message: string): boolean {
  return /API Key|未配置.*(DeepSeek|SiliconFlow|密钥)/i.test(message);
}
