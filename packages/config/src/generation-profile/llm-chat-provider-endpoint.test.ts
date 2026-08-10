import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLlmChatProviderEndpoint } from './llm-chat-provider-endpoint';

test('resolveLlmChatProviderEndpoint routes deepseek and siliconflow separately', () => {
  const env = {
    DEEPSEEK_API_KEY: 'ds-key',
    SILICONFLOW_API_KEY: 'sf-key',
  } as NodeJS.ProcessEnv;

  const deepseek = resolveLlmChatProviderEndpoint('deepseek', env);
  assert.equal(deepseek.apiKey, 'ds-key');
  assert.match(deepseek.providerUrl, /deepseek/);

  const silicon = resolveLlmChatProviderEndpoint('siliconflow', env);
  assert.equal(silicon.apiKey, 'sf-key');
  assert.match(silicon.providerUrl, /siliconflow/);
});

test('resolveLlmChatProviderEndpoint fails clearly when key missing', () => {
  assert.throws(
    () => resolveLlmChatProviderEndpoint('siliconflow', { DEEPSEEK_API_KEY: 'only-ds' } as NodeJS.ProcessEnv),
    /SiliconFlow/
  );
  assert.throws(
    () => resolveLlmChatProviderEndpoint('deepseek', { SILICONFLOW_API_KEY: 'only-sf' } as NodeJS.ProcessEnv),
    /DeepSeek/
  );
});
