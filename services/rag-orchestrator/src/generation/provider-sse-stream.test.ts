import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumeProviderSseStreamChunk,
  extractProviderChatText,
  flushProviderSseStreamBuffer,
  parseProviderSseLine,
  splitProviderSseBuffer,
} from './provider-sse-stream';

test('splitProviderSseBuffer keeps incomplete line in remainder', () => {
  const { completeLines, remainder } = splitProviderSseBuffer(
    'data: {"choices":[{"delta":{"content":"x"}}]}\ndata: {"id":'
  );
  assert.equal(completeLines.length, 1);
  assert.equal(remainder, 'data: {"id":');
});

test('consumeProviderSseStreamChunk reassembles JSON split across chunks', () => {
  const fullLine =
    'data: {"id":"x","object":"chat.completion.chunk","choices":[{"delta":{"content":"你好"}}]}';
  const part1 = fullLine.slice(0, 60);
  const part2 = fullLine.slice(60) + '\n\n';

  let buffer = '';
  const contents: string[] = [];

  for (const chunk of [part1, part2]) {
    const consumed = consumeProviderSseStreamChunk(buffer, chunk);
    buffer = consumed.nextBuffer;
    for (const event of consumed.events) {
      if (event.type === 'content') {
        contents.push(event.content);
      }
    }
  }

  const flushed = flushProviderSseStreamBuffer(buffer);
  for (const event of flushed.events) {
    if (event.type === 'content') {
      contents.push(event.content);
    }
  }

  assert.equal(contents.join(''), '你好');
});

test('parseProviderSseLine ignores reasoning_content and only yields answer content', () => {
  assert.equal(parseProviderSseLine('data: [DONE]').type, 'done');
  assert.equal(parseProviderSseLine('data: {"choices":[{"delta":{}}]}').type, 'skip');
  assert.equal(parseProviderSseLine(': keep-alive').type, 'skip');
  assert.equal(
    parseProviderSseLine(
      'data: {"choices":[{"delta":{"reasoning_content":"先分析方案再写正文"}}]}'
    ).type,
    'reasoning'
  );
  const contentLine = parseProviderSseLine(
    'data: {"choices":[{"delta":{"content":"夜风很凉。"}}]}'
  );
  assert.equal(contentLine.type, 'content');
  if (contentLine.type === 'content') {
    assert.equal(contentLine.content, '夜风很凉。');
  }
});

test('parseProviderSseLine reads message.content and finish_reason', () => {
  const trailing = parseProviderSseLine(
    'data: {"choices":[{"message":{"content":"整章正文"},"finish_reason":"stop"}]}'
  );
  assert.equal(trailing.type, 'content');
  if (trailing.type === 'content') {
    assert.equal(trailing.content, '整章正文');
    assert.equal(trailing.finishReason, 'stop');
  }

  const lengthOnly = parseProviderSseLine(
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}'
  );
  assert.equal(lengthOnly.type, 'skip');
  if (lengthOnly.type === 'skip') {
    assert.equal(lengthOnly.finishReason, 'length');
  }
});

test('extractProviderChatText flattens text parts', () => {
  assert.equal(extractProviderChatText('夜风'), '夜风');
  assert.equal(extractProviderChatText([{ text: '夜' }, { text: '风' }]), '夜风');
  assert.equal(extractProviderChatText({ text: '夜风' }), '夜风');
});

test('parseProviderSseLine reports malformed only for invalid complete lines', () => {
  const result = parseProviderSseLine('data: {not-json');
  assert.equal(result.type, 'malformed');
  if (result.type === 'malformed') {
    assert.match(result.error, /JSON/i);
  }
});
