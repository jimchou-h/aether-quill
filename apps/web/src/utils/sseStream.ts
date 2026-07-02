export class SseAbortError extends Error {
  constructor(message = 'SSE stream aborted') {
    super(message);
    this.name = 'SseAbortError';
  }
}

export function isSseAbortError(error: unknown): boolean {
  if (error instanceof SseAbortError) {
    return true;
  }
  return error instanceof DOMException && error.name === 'AbortError';
}

function bindAbortToReader(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal) {
  if (!signal) {
    return () => {};
  }

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };

  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return () => signal.removeEventListener('abort', onAbort);
}

export async function readSseSegments(
  response: Response,
  onDataLine: (dataLine: string) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!response.body) {
    throw new Error('SSE response has no body');
  }

  if (signal?.aborted) {
    throw new SseAbortError();
  }

  const reader = response.body.getReader();
  const unbind = bindAbortToReader(reader, signal);
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        throw new SseAbortError();
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split('\n\n');
      buffer = segments.pop() || '';

      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const dataPart = trimmed.replace(/^data:\s*/, '');
        if (dataPart) {
          onDataLine(dataPart);
        }
      }
    }

    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const dataPart = tail.replace(/^data:\s*/, '');
      if (dataPart) {
        onDataLine(dataPart);
      }
    }
  } finally {
    unbind();
  }
}

export async function readSseLines(
  response: Response,
  onDataLine: (dataLine: string) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!response.body) {
    throw new Error('SSE response has no body');
  }

  if (signal?.aborted) {
    throw new SseAbortError();
  }

  const reader = response.body.getReader();
  const unbind = bindAbortToReader(reader, signal);
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        throw new SseAbortError();
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          continue;
        }
        const dataPart = line.slice(6);
        if (dataPart) {
          onDataLine(dataPart);
        }
      }
    }
  } finally {
    unbind();
  }
}

export type SseFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export async function fetchSse(
  url: string,
  init: SseFetchInit,
  onDataLine: (dataLine: string) => void,
  mode: 'segments' | 'lines' = 'segments'
): Promise<void> {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(errorBody || `SSE request failed: ${response.statusText}`);
  }

  if (mode === 'lines') {
    await readSseLines(response, onDataLine, init.signal);
    return;
  }

  await readSseSegments(response, onDataLine, init.signal);
}
