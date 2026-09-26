import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyThinkingTokenReserve,
  CHAT_THINKING_TOKEN_RESERVE,
  formatEmptyChatContentError,
  isOfficialDeepSeekChatModel,
  isSiliconFlowHybridThinkingModel,
  shouldEnableChatThinking,
  shouldRetryChatWithoutThinking,
  withChatThinkingMode,
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

test('isSiliconFlowHybridThinkingModel matches V3.2 Pro and Qwen3 ids', () => {
  assert.equal(isSiliconFlowHybridThinkingModel('Pro/deepseek-ai/DeepSeek-V3.2'), true);
  assert.equal(isSiliconFlowHybridThinkingModel('deepseek-ai/DeepSeek-V3.2'), true);
  assert.equal(isSiliconFlowHybridThinkingModel('deepseek-ai/DeepSeek-V3.1-Terminus'), true);
  assert.equal(isSiliconFlowHybridThinkingModel('Qwen/Qwen3-8B'), true);
  assert.equal(isSiliconFlowHybridThinkingModel('Qwen/Qwen2.5-7B-Instruct'), false);
  assert.equal(isSiliconFlowHybridThinkingModel('deepseek-v4-flash'), false);
});

test('withDeepSeekNonThinkingChatBody disables thinking per vendor', () => {
  const disabled = withDeepSeekNonThinkingChatBody({
    model: 'deepseek-v4-flash',
    max_tokens: 4096,
    stream: true,
  });
  assert.deepEqual(disabled.thinking, { type: 'disabled' });
  assert.equal(disabled.max_tokens, 4096);
  assert.equal('enable_thinking' in disabled, false);

  const silicon = withDeepSeekNonThinkingChatBody({
    model: 'Pro/deepseek-ai/DeepSeek-V3.2',
    stream: true,
  });
  assert.equal(silicon.enable_thinking, false);
  assert.equal('thinking' in silicon, false);

  const qwen = withDeepSeekNonThinkingChatBody({
    model: 'Qwen/Qwen2.5-7B-Instruct',
    stream: true,
  });
  assert.equal('thinking' in qwen, false);
  assert.equal('enable_thinking' in qwen, false);
});

test('shouldEnableChatThinking only opens direct-draft', () => {
  assert.equal(shouldEnableChatThinking('chapter.optimize.direct-draft'), true);
  assert.equal(shouldEnableChatThinking('chapter.optimize.draft'), false);
  assert.equal(shouldEnableChatThinking('chapter.optimize.plan'), false);
  assert.equal(shouldEnableChatThinking(''), false);
});

test('applyThinkingTokenReserve only adds headroom when thinking is on', () => {
  assert.equal(applyThinkingTokenReserve(4096, false), 4096);
  assert.equal(applyThinkingTokenReserve(4096, true), 4096 + CHAT_THINKING_TOKEN_RESERVE);
  assert.equal(applyThinkingTokenReserve(60000, true), 65536);
  assert.equal(applyThinkingTokenReserve(0, true), 0);
});

test('shouldRetryChatWithoutThinking only retries empty thinking passes', () => {
  assert.equal(
    shouldRetryChatWithoutThinking({ thinkingEnabled: true, contentEmpty: true }),
    true
  );
  assert.equal(
    shouldRetryChatWithoutThinking({ thinkingEnabled: true, contentEmpty: false }),
    false
  );
  assert.equal(
    shouldRetryChatWithoutThinking({ thinkingEnabled: false, contentEmpty: true }),
    false
  );
  assert.equal(
    shouldRetryChatWithoutThinking({
      thinkingEnabled: true,
      contentEmpty: true,
      aborted: true,
    }),
    false
  );
});

test('formatEmptyChatContentError distinguishes thinking-starved empty answers', () => {
  assert.equal(formatEmptyChatContentError(), '模型未返回正文');
  assert.equal(
    formatEmptyChatContentError({ sawReasoning: true }),
    '模型思维链占满了输出额度，没有留下正文。请重试'
  );
  assert.equal(
    formatEmptyChatContentError({ finishReason: 'length' }),
    '模型思维链占满了输出额度，没有留下正文。请重试'
  );
});

test('withChatThinkingMode enables SiliconFlow DS 3.2 thinking', () => {
  const silicon = withChatThinkingMode(
    { model: 'Pro/deepseek-ai/DeepSeek-V3.2', stream: true },
    'enabled'
  );
  assert.equal(silicon.enable_thinking, true);
  assert.equal('thinking' in silicon, false);

  const official = withChatThinkingMode({ model: 'deepseek-v4-flash', stream: true }, 'enabled');
  assert.deepEqual(official.thinking, { type: 'enabled' });
});
