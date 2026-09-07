/**
 * 流式 UTF-8 解码：TCP 可能把一个汉字的 3 字节拆到两个 chunk。
 * `Buffer.toString('utf-8')` 会把残缺字节变成 U+FFFD，造成中文乱码。
 */
export function createUtf8StreamDecoder(): {
  decode(chunk: Buffer | Uint8Array | string): string;
  flush(): string;
} {
  const decoder = new TextDecoder('utf-8');
  return {
    decode(chunk) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      return decoder.decode(bytes, { stream: true });
    },
    flush() {
      return decoder.decode();
    },
  };
}
