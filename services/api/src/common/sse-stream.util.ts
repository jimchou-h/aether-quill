import type { Request, Response } from 'express';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

export interface SseStreamContext {
  writeEvent: (payload: Record<string, unknown>) => boolean;
  isAborted: () => boolean;
  end: () => void;
}

export function createSseStreamContext(req: Request, res: Response): SseStreamContext {
  let aborted = false;

  const markAborted = () => {
    aborted = true;
  };

  req.on('close', markAborted);
  res.on('close', markAborted);

  res.writeHead(200, SSE_HEADERS);
  res.write(': keep-alive\n\n');

  const isAborted = () => aborted || res.writableEnded || res.destroyed;

  const writeEvent = (payload: Record<string, unknown>) => {
    if (isAborted()) {
      return false;
    }
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      return !isAborted();
    } catch {
      markAborted();
      return false;
    }
  };

  const end = () => {
    if (!res.writableEnded) {
      res.end();
    }
  };

  return { writeEvent, isAborted, end };
}

export async function runSseHandler(
  req: Request,
  res: Response,
  handler: (ctx: SseStreamContext) => Promise<void>
): Promise<void> {
  const ctx = createSseStreamContext(req, res);
  try {
    await handler(ctx);
  } finally {
    ctx.end();
  }
}
