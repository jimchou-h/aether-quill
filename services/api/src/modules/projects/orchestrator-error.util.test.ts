import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { AxiosError } from 'axios';
import {
  isMissingLlmProviderKeyMessage,
  resolveUpstreamFailureMessage,
} from './orchestrator-error.util';

test('resolveUpstreamFailureMessage reads stream JSON body from AxiosError', async () => {
  const stream = Readable.from([
    Buffer.from(
      JSON.stringify({
        error: 'siliconflow 调用失败 HTTP 400 (model=x): Model does not exist',
      })
    ),
  ]);
  const err = new AxiosError(
    'Request failed with status code 400',
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    {
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: {} as never,
      data: stream,
    }
  );
  const message = await resolveUpstreamFailureMessage(err, '调用失败');
  assert.match(message, /Model does not exist/);
  assert.match(message, /HTTP 400/);
});

test('resolveUpstreamFailureMessage uses JSON message field', async () => {
  const err = new AxiosError(
    'Request failed with status code 400',
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    {
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: {} as never,
      data: { message: 'Model does not exist. Please check it carefully.', code: 20012 },
    }
  );
  const message = await resolveUpstreamFailureMessage(err, '调用失败');
  assert.match(message, /Model does not exist/);
});

test('resolveUpstreamFailureMessage uses Error.message for non-axios errors', async () => {
  const message = await resolveUpstreamFailureMessage(
    new Error('未配置 DeepSeek API Key，请设置 DEEPSEEK_API_KEY'),
    'fallback'
  );
  assert.match(message, /DeepSeek API Key/);
  assert.equal(isMissingLlmProviderKeyMessage(message), true);
});

test('resolveUpstreamFailureMessage maps axios timeout to 请求超时', async () => {
  const err = new AxiosError('timeout of 120000ms exceeded', 'ECONNABORTED');
  const message = await resolveUpstreamFailureMessage(err, '同步项目上下文失败');
  assert.equal(message, '同步项目上下文失败：请求超时');
});

test('resolveUpstreamFailureMessage maps connection refused', async () => {
  const err = new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED');
  const message = await resolveUpstreamFailureMessage(err, '调用失败');
  assert.match(message, /编排服务不可用/);
});

test('isMissingLlmProviderKeyMessage detects Chinese and English key hints', () => {
  assert.equal(
    isMissingLlmProviderKeyMessage('未配置 SiliconFlow API Key，请设置 SILICONFLOW_API_KEY'),
    true
  );
  assert.equal(isMissingLlmProviderKeyMessage('Model does not exist'), false);
});
