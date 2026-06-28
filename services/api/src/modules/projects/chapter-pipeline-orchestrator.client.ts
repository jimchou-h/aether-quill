/**
 * Orchestrator SSE/JSON client for chapter pipeline (AQ-275~277)
 */

import axios from 'axios';

export interface PipelineOrchestratorStreamCallbacks {
  onStart?: (traceId: string) => void;
  onContent?: (piece: string) => void;
  onStage?: (stage: string, segmentIndex?: number, segmentTotal?: number) => void;
  onError?: (message: string) => void;
}

export async function streamPipelineGeneration(input: {
  orchestratorUrl: string;
  projectId: string;
  prompt: string;
  templateKey: string;
  maxTokens?: number;
  context: Record<string, unknown>;
  callbacks: PipelineOrchestratorStreamCallbacks;
}): Promise<{ ok: boolean; text: string; traceId: string; errorMessage?: string }> {
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
      },
      { responseType: 'stream', timeout: 300000 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '调用生成服务失败';
    input.callbacks.onError?.(message);
    return { ok: false, text: '', traceId: '', errorMessage: message };
  }

  let accumulated = '';
  let traceId = '';
  let errorMessage: string | undefined;

  await new Promise<void>((resolve, reject) => {
    const stream = response.data as NodeJS.ReadableStream;
    let buffer = '';

    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
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
            break;
        }
      }
    });

    stream.on('end', () => resolve());
    stream.on('error', (err: unknown) => reject(err));
  });

  const text = accumulated.trim();
  if (errorMessage) {
    return { ok: false, text, traceId, errorMessage };
  }
  if (!text) {
    return { ok: false, text: '', traceId, errorMessage: '未收到有效响应' };
  }
  return { ok: true, text, traceId };
}

export async function generatePipelinePlainText(input: {
  orchestratorUrl: string;
  projectId: string;
  prompt: string;
  templateKey: string;
  context: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<string> {
  const { data } = await axios.post(
    `${input.orchestratorUrl}/api/generate`,
    {
      projectId: input.projectId,
      prompt: input.prompt,
      useSSE: false,
      templateKey: input.templateKey,
      maxTokens: input.maxTokens,
      context: input.context,
    },
    { timeout: input.timeoutMs ?? 180000 }
  );
  return typeof data?.content === 'string' ? data.content.trim() : '';
}
