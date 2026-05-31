const MOJIBAKE_HINTS = /[\uFFFD]|锟斤拷/;

function decodeUtf8(buffer: ArrayBuffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function decodeGb18030(buffer: ArrayBuffer): string {
  return new TextDecoder('gb18030').decode(buffer);
}

/** 粗略判断 UTF-8 误读 GBK 等宽字节编码后的乱码特征 */
function looksLikeGarbled(text: string): boolean {
  if (MOJIBAKE_HINTS.test(text)) {
    return true;
  }

  const sample = text.slice(0, 8000);
  const chineseCount = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latinExtendedCount = (sample.match(/[\u0080-\u00ff]/g) ?? []).length;

  return latinExtendedCount > 30 && latinExtendedCount > chineseCount * 2;
}

function stripUtf8Bom(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return buffer.slice(3);
  }
  return buffer;
}

/**
 * 读取本地文本文件，自动识别 UTF-8 / GB18030（含 GBK）。
 * 中文小说 txt 常见 GBK 编码，直接 readAsText('utf-8') 会乱码。
 */
export async function readTextFile(file: File): Promise<string> {
  return decodeTextBuffer(stripUtf8Bom(await file.arrayBuffer()));
}

export function decodeTextBuffer(buffer: ArrayBuffer): string {
  const utf8Text = decodeUtf8(buffer);

  if (utf8Text !== null && !looksLikeGarbled(utf8Text)) {
    return utf8Text;
  }

  return decodeGb18030(buffer);
}
