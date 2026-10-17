import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { isUpstreamAbortError, streamPipelineGeneration } from './chapter-generation-stream.client';

test('isUpstreamAbortError 识别 axios 取消与 AbortError', () => {
  assert.equal(
    isUpstreamAbortError(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })),
    true
  );
  assert.equal(
    isUpstreamAbortError(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    true
  );
  assert.equal(isUpstreamAbortError(new Error('调用生成服务失败')), false);
});

test('streamPipelineGeneration 在 signal 已中止时立即返回 aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await streamPipelineGeneration({
    orchestratorUrl: 'http://127.0.0.1:9',
    projectId: 'p1',
    prompt: 'test',
    templateKey: 'chapter.optimize.loop.plan',
    context: {},
    callbacks: {},
    signal: controller.signal,
  });
  assert.equal(result.aborted, true);
  assert.equal(result.ok, false);
  assert.equal(result.errorMessage, 'aborted');
});

const sse = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}\n\n`;

/** 起一个只发 SSE 的本地上游，避免测试依赖真实 orchestrator。 */
async function withSseServer(
  write: (res: http.ServerResponse) => void,
  run: (url: string) => Promise<void>
): Promise<void> {
  const server = http.createServer((_req, res) => {
    // 每次测试都监听随机端口；告知客户端不要复用连接，避免 Node 全局 agent 把
    // 上一个已关闭测试服务器的 keep-alive socket 复用给下一次请求（socket hang up）。
    res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' });
    write(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function callClient(url: string) {
  return streamPipelineGeneration({
    orchestratorUrl: url,
    projectId: 'p1',
    prompt: '改写这一段',
    templateKey: 'chapter.refinement.rewrite',
    context: {},
    callbacks: {},
  });
}

test('严格完成元数据：end 带 finishReason=stop 时透传完整完成状态', async () => {
  await withSseServer(
    (res) => {
      res.write(sse({ event: 'start', traceId: 't1' }));
      res.write(sse({ event: 'content', data: '夜幕降临。' }));
      res.write(sse({ event: 'end', traceId: 't1', completed: true, finishReason: 'stop' }));
      res.end();
    },
    async (url) => {
      const result = await callClient(url);
      assert.equal(result.ok, true);
      assert.equal(result.text, '夜幕降临。');
      assert.equal(result.completed, true);
      assert.equal(result.finishReason, 'stop');
    }
  );
});

test('严格完成元数据：length 与 content_filter 原样透传，交给网关判定不可应用', async () => {
  await withSseServer(
    (res) => {
      res.write(sse({ event: 'content', data: '半截正文' }));
      res.write(sse({ event: 'end', traceId: 't2', completed: true, finishReason: 'length' }));
      res.end();
    },
    async (url) => {
      const result = await callClient(url);
      assert.equal(result.ok, true);
      assert.equal(result.completed, true);
      assert.equal(result.finishReason, 'length');
    }
  );

  await withSseServer(
    (res) => {
      res.write(sse({ event: 'content', data: '正文' }));
      res.write(
        sse({ event: 'end', traceId: 't3', completed: true, finishReason: 'content_filter' })
      );
      res.end();
    },
    async (url) => {
      const result = await callClient(url);
      assert.equal(result.finishReason, 'content_filter');
    }
  );
});

test('严格完成元数据：流在 end 之前关闭视为断流，completed=false', async () => {
  await withSseServer(
    (res) => {
      res.write(sse({ event: 'start', traceId: 't4' }));
      res.write(sse({ event: 'content', data: '未收束的正文' }));
      res.end();
    },
    async (url) => {
      const result = await callClient(url);
      assert.equal(result.ok, true);
      assert.equal(result.completed, false);
      assert.equal(result.finishReason, null);
    }
  );
});

test('旧调用兼容：end 不带新增字段时不报错，completed=true / finishReason=null', async () => {
  await withSseServer(
    (res) => {
      res.write(sse({ event: 'content', data: '旧上游正文' }));
      res.write(sse({ event: 'end', traceId: 't5' }));
      res.end();
    },
    async (url) => {
      const result = await callClient(url);
      assert.equal(result.ok, true);
      assert.equal(result.text, '旧上游正文');
      assert.equal(result.completed, true);
      assert.equal(result.finishReason, null);
    }
  );
});
