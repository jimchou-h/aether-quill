import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isUpstreamAbortError,
  streamPipelineGeneration,
} from './chapter-pipeline-orchestrator.client';

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
