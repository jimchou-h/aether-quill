import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOfficialDeepSeekChatModel,
  withDeepSeekNonThinkingChatBody,
} from './deepseek-thinking';

test('isOfficialDeepSeekChatModel matches DeepSeek official chat ids only', () => {
  assert.equal(isOfficialDeepSeekChatModel('deepseek-v4-flash'), true);
  assert.equal(isOfficialDeepSeekChatModel('deepseek-v4-pro'), true);
  assert.equal(isOfficialDeepSeekChatModel('deepseek-chat'), true);
  assert.equal(isOfficialDeepSeekChatModel('deepseek-reasoner'), true);
  assert.equal(isOfficialDeepSeekChatModel('Pro/deepseek-ai/DeepSeek-V3.2'), false);
  assert.equal(isOfficialDeepSeekChatModel('Qwen/Qwen2.5-7B-Instruct'), false);
  assert.equal(isOfficialDeepSeekChatModel(''), false);
});

test('withDeepSeekNonThinkingChatBody disables thinking for official DeepSeek models', () => {
  const disabled = withDeepSeekNonThinkingChatBody({
    model: 'deepseek-v4-flash',
    max_tokens: 4096,
    stream: true,
  });
  assert.deepEqual(disabled.thinking, { type: 'disabled' });
  assert.equal(disabled.max_tokens, 4096);

  const silicon = withDeepSeekNonThinkingChatBody({
    model: 'Pro/deepseek-ai/DeepSeek-V3.2',
    stream: true,
  });
  assert.equal('thinking' in silicon, false);
});
