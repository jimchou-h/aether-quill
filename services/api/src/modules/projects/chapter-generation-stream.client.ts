/**
 * 章节生成上游 SSE/JSON 客户端（文笔优化 / 自动循环等共用）
 */

import axios from 'axios';
import { resolveUpstreamFailureMessage } from './orchestrator-error.util';
import { createUtf8StreamDecoder } from '../../common/utf8-stream-decoder';

export interface PipelineOrchestratorStreamCallbacks {
  onStart?: (traceId: string) => void;
  onContent?: (piece: string) => void;
  onStage?: (stage: string, segmentIndex?: number, segmentTotal?: number) => void;
  onError?: (message: string) => void;
}

export function isUpstreamAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { code?: string; name?: string; message?: string };
  if (err.name === 'AbortError' || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
    return true;
  }
  return /aborted|canceled|cancelled/i.test(err.message ?? '');
}

function destroyReadableStream(stream: NodeJS.ReadableStream): void {
  const destroyable = stream as NodeJS.ReadableStream & {
    destroy?: (error?: Error) => void;
  };
  try {
    destroyable.destroy?.();
  } catch {
    // 断开时流可能已结束
  }
}

export async function streamPipelineGeneration(input: {
  orchestratorUrl: string;
  projectId: string;
  prompt: string;
  templateKey: string;
  maxTokens?: number;
  context: Record<string, unknown>;
  systemPromptOverride?: string;
  callbacks: PipelineOrchestratorStreamCallbacks;
  /** 前端 SSE 断开时传入，用于取消 axios 与销毁上游流 */
  signal?: AbortSignal;
}): Promise<{
  ok: boolean;
  text: string;
  traceId: string;
  errorMessage?: string;
  retrievedEvidence?: string;
  aborted?: boolean;
}> {
  if (input.signal?.aborted) {
    return { ok: false, text: '', traceId: '', errorMessage: 'aborted', aborted: true };
  }

  let response;
  try {
    response = await axios.post(
      `${input.orchestratorUrl}/api/generate`,
      {
        projectId: input.projectId,
        prompt: input.prompt,
        useSSE: true,
        templateKey: input.templateKey,
        maxTokens: input.maxTokens,
        context: input.context,
        ...(input.systemPromptOverride
          ? { systemPromptOverride: input.systemPromptOverride }
          : {}),
      },
      {
        responseType: 'stream',
        timeout: 300000,
        ...(input.signal ? { signal: input.signal } : {}),
      }
    );
  } catch (error) {
    if (input.signal?.aborted || isUpstreamAbortError(error)) {
      return { ok: false, text: '', traceId: '', errorMessage: 'aborted', aborted: true };
    }
    const message = await resolveUpstreamFailureMessage(error, '调用生成服务失败');
    input.callbacks.onError?.(message);
    return { ok: false, text: '', traceId: '', errorMessage: message };
  }

  let accumulated = '';
  let traceId = '';
  let errorMessage: string | undefined;
  let retrievedEvidence = '';

  await new Promise<void>((resolve, reject) => {
    const stream = response.data as NodeJS.ReadableStream;
    const utf8 = createUtf8StreamDecoder();
    let buffer = '';
    let settled = false;

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (input.signal) {
        input.signal.removeEventListener('abort', onAbort);
      }
      handler();
    };

    const onAbort = () => {
      destroyReadableStream(stream);
      finish(() => resolve());
    };

    if (input.signal) {
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener('abort', onAbort, { once: true });
    }

    stream.on('data', (chunk: Buffer) => {
      if (input.signal?.aborted) {
        onAbort();
        return;
      }
      buffer += utf8.decode(chunk);
      const segments = buffer.split('\n\n');
      buffer = segments.pop() || '';

      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const dataPart = trimmed.replace(/^data:\s*/, '');
        if (!dataPart) {
          continue;
        }
        let event: {
          event?: string;
          data?: string;
          traceId?: string;
          stage?: string;
          segmentIndex?: number;
          segmentTotal?: number;
          retrievedEvidence?: string;
        };
        try {
          event = JSON.parse(dataPart);
        } catch {
          continue;
        }

        switch (event.event) {
          case 'start':
            traceId = typeof event.traceId === 'string' ? event.traceId : '';
            input.callbacks.onStart?.(traceId);
            break;
          case 'content': {
            const raw = typeof event.data === 'string' ? event.data : '';
            const piece = raw.replace(/\\n/g, '\n');
            accumulated += piece;
            input.callbacks.onContent?.(piece);
            break;
          }
          case 'stage':
            input.callbacks.onStage?.(
              event.stage || '',
              event.segmentIndex,
              event.segmentTotal
            );
            break;
          case 'error':
            errorMessage = typeof event.data === 'string' ? event.data : '生成失败';
            input.callbacks.onError?.(errorMessage);
            break;
          case 'end':
            traceId = typeof event.traceId === 'string' ? event.traceId : traceId;
            if (typeof event.retrievedEvidence === 'string') {
              retrievedEvidence = event.retrievedEvidence;
            }
            break;
        }
      }
    });

    stream.on('end', () => finish(() => resolve()));
    stream.on('error', (err: unknown) => {
      if (input.signal?.aborted || isUpstreamAbortError(err)) {
        finish(() => resolve());
        return;
      }
      finish(() => reject(err));
    });
  });

  if (input.signal?.aborted) {
    return {
      ok: false,
      text: accumulated.trim(),
      traceId,
      errorMessage: 'aborted',
      retrievedEvidence,
      aborted: true,
    };
  }

  const text = accumulated.trim();
  if (errorMessage) {
    return { ok: false, text, traceId, errorMessage, retrievedEvidence };
  }
  if (!text) {
    return { ok: false, text: '', traceId, errorMessage: '未收到有效响应', retrievedEvidence };
  }
  return { ok: true, text, traceId, retrievedEvidence };
}

export async function generatePipelinePlainText(input: {
  orchestratorUrl: string;
  projectId: string;
  prompt: string;
  templateKey: string;
  context: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
  systemPromptOverride?: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (input.signal?.aborted) {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  }
  try {
    const { data } = await axios.post(
      `${input.orchestratorUrl}/api/generate`,
      {
        projectId: input.projectId,
        prompt: input.prompt,
        useSSE: false,
        templateKey: input.templateKey,
        maxTokens: input.maxTokens,
        context: input.context,
        ...(input.systemPromptOverride
          ? { systemPromptOverride: input.systemPromptOverride }
          : {}),
      },
      {
        timeout: input.timeoutMs ?? 180000,
        ...(input.signal ? { signal: input.signal } : {}),
      }
    );
    return typeof data?.content === 'string' ? data.content.trim() : '';
  } catch (error) {
    if (input.signal?.aborted || isUpstreamAbortError(error)) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    throw new Error(await resolveUpstreamFailureMessage(error, '调用生成服务失败'));
  }
}
