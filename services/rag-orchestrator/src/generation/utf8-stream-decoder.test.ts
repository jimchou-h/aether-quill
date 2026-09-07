import assert from 'node:assert/strict';
import test from 'node:test';
import { createUtf8StreamDecoder } from './utf8-stream-decoder';

test('createUtf8StreamDecoder reassembles a Chinese character split across chunks', () => {
  const bytes = Buffer.from('优化方案', 'utf8');
  const decoder = createUtf8StreamDecoder();
  const text = decoder.decode(bytes.subarray(0, 4)) + decoder.decode(bytes.subarray(4)) + decoder.flush();
  assert.equal(text, '优化方案');
  assert.equal(text.includes('\uFFFD'), false);
});
