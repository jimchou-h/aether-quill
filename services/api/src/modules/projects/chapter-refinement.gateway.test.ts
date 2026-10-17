import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { OrchestratorRefinementGateway } from './chapter-refinement.gateway';

const sse = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}\n\n`;

/**
 * F4：起一个只发 SSE 的本地上游，捕获 POST body，验证网关确实把冻结模型路由
 * 下发到 orchestrator（真实调用参数），而不是只把路由存进 run 记录。
 */
async function withCapturingServer(
  run: (url: string, captured: () => Record<string, unknown> | null) => Promise<void>
): Promise<void> {
  let bodyText = '';
  const server = http.createServer((req, res) => {
    req.on('data', (chunk: Buffer) => {
      bodyText += chunk.toString('utf8');
    });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' });
      res.write(sse({ event: 'content', data: '改写结果正文。' }));
      res.write(sse({ event: 'end', traceId: 't1', completed: true, finishReason: 'stop' }));
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`, () => (bodyText ? JSON.parse(bodyText) : null));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('F4 网关把冻结模型路由随请求下发到 orchestrator', async () => {
  await withCapturingServer(async (url, captured) => {
    const gateway = new OrchestratorRefinementGateway(() => url);
    const result = await gateway.generate({
      projectId: 'p1',
      chapterNo: 3,
      templateKey: 'chapter.refinement.rewrite',
      systemPromptText: '冻结指导',
      projectSystemPromptText: '项目提示',
      prompt: '改写这一段',
      signal: new AbortController().signal,
      modelRoute: {
        tier: 'writing',
        provider: 'siliconflow',
        model: 'Qwen/Qwen2.5-7B-Instruct',
        temperature: 0.85,
      },
    });

    assert.equal(result.ok, true);
    const body = captured();
    assert.ok(body, '应捕获到上游请求体');
    const context = body?.context as Record<string, unknown>;
    assert.deepEqual(
      context.generationRouteOverride,
      {
        provider: 'siliconflow',
        model: 'Qwen/Qwen2.5-7B-Instruct',
        temperature: 0.85,
      },
      '冻结路由须随 context 下发，供 orchestrator 采用为实际生成参数'
    );
  });
});

test('F4 未冻结路由时不发送覆盖字段（不伪造路由）', async () => {
  await withCapturingServer(async (url, captured) => {
    const gateway = new OrchestratorRefinementGateway(() => url);
    await gateway.generate({
      projectId: 'p1',
      chapterNo: 3,
      templateKey: 'chapter.refinement.rewrite',
      systemPromptText: '冻结指导',
      projectSystemPromptText: '项目提示',
      prompt: '改写这一段',
      signal: new AbortController().signal,
    });

    const context = captured()?.context as Record<string, unknown>;
    assert.equal('generationRouteOverride' in (context ?? {}), false);
  });
});
