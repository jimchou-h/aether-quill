import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTextBuffer } from './read-text-file';

test('decodeTextBuffer prefers valid UTF-8', () => {
  const text = '第一章 开端\n这是 UTF-8 正文。';
  const buffer = new TextEncoder().encode(text).buffer;
  assert.equal(decodeTextBuffer(buffer), text);
});

test('decodeTextBuffer falls back to GB18030 for GBK bytes', () => {
  // 「第一章」的 GBK 字节序列
  const bytes = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]);
  assert.equal(decodeTextBuffer(bytes.buffer), '第一章');
});
