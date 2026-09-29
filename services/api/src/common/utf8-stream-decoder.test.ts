import assert from 'node:assert/strict';
import test from 'node:test';
import { createUtf8StreamDecoder } from './utf8-stream-decoder';

test('naive Buffer.toString corrupts a Chinese character split across chunks', () => {
  const bytes = Buffer.from('你好', 'utf8');
  const naive = bytes.subarray(0, 2).toString('utf-8') + bytes.subarray(2).toString('utf-8');
  assert.ok(naive.includes('\uFFFD'));
  assert.notEqual(naive, '你好');
});

test('createUtf8StreamDecoder reassembles a Chinese character split across chunks', () => {
  const bytes = Buffer.from('你好世界', 'utf8');
  const decoder = createUtf8StreamDecoder();
  const text =
    decoder.decode(bytes.subarray(0, 2)) + decoder.decode(bytes.subarray(2)) + decoder.flush();
  assert.equal(text, '你好世界');
  assert.equal(text.includes('\uFFFD'), false);
});
