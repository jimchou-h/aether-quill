import type { Request, Response } from 'express';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/** 防止代理/浏览器在首 token 前把空闲 SSE 掐断 */
const SSE_HEARTBEAT_MS = 15_000;

export interface SseStreamContext {
  writeEvent: (payload: Record<string, unknown>) => boolean;
  isAborted: () => boolean;
  /** 与 isAborted 同步；可交给 axios / fetch 真正取消上游 */
  abortSignal: AbortSignal;
  end: () => void;
}

export function createSseStreamContext(req: Request, res: Response): SseStreamContext {
  let aborted = false;
  const abortController = new AbortController();
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const markAborted = () => {
    // 正常 res.end() 也会触发 close；只有响应尚未结束时才算客户端断开
    if (res.writableEnded || res.destroyed) {
      return;
    }
    aborted = true;
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  };

  req.on('close', markAborted);
  res.on('close', markAborted);

  if (typeof req.socket?.setNoDelay === 'function') {
    req.socket.setNoDelay(true);
  }
  if (typeof req.setTimeout === 'function') {
    req.setTimeout(0);
  }
  if (typeof res.setTimeout === 'function') {
    res.setTimeout(0);
  }
  if (typeof req.socket?.setTimeout === 'function') {
    req.socket.setTimeout(0);
  }

  res.writeHead(200, SSE_HEADERS);
  res.write(': keep-alive\n\n');

  heartbeatTimer = setInterval(() => {
    if (aborted || res.writableEnded || res.destroyed) {
      return;
    }
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
      const flushable = res as Response & { flush?: () => void };
      if (typeof flushable.flush === 'function') {
        flushable.flush();
      }
    } catch {
      markAborted();
    }
  }, SSE_HEARTBEAT_MS);
  if (typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref();
  }

  const isAborted = () => aborted || res.writableEnded || res.destroyed;

  const writeEvent = (payload: Record<string, unknown>) => {
    if (isAborted()) {
      return false;
    }
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      const flushable = res as Response & { flush?: () => void };
      if (typeof flushable.flush === 'function') {
        flushable.flush();
      }
      return !isAborted();
    } catch {
      markAborted();
      return false;
    }
  };

  const end = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    if (!res.writableEnded) {
      res.end();
    }
  };

  return { writeEvent, isAborted, abortSignal: abortController.signal, end };
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
