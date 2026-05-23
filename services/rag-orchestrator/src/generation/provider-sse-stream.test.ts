import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumeProviderSseStreamChunk,
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

test('parseProviderSseLine handles DONE and empty deltas', () => {
  assert.equal(parseProviderSseLine('data: [DONE]').type, 'done');
  assert.equal(parseProviderSseLine('data: {"choices":[{"delta":{}}]}').type, 'skip');
  assert.equal(parseProviderSseLine(': keep-alive').type, 'skip');
});

test('parseProviderSseLine reports malformed only for invalid complete lines', () => {
  const result = parseProviderSseLine('data: {not-json');
  assert.equal(result.type, 'malformed');
  if (result.type === 'malformed') {
    assert.match(result.error, /JSON/i);
  }
});
