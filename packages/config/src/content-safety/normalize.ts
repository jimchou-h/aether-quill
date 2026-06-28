export interface NormalizedTextIndex {
  normalized: string;
  /** normalized[i] 对应原文下标 */
  indexMap: number[];
}

/** 全半角、大小写、空白归一化，并保留 offset 映射 */
export function buildNormalizedTextIndex(text: string): NormalizedTextIndex {
  const indexMap: number[] = [];
  let normalized = '';

  for (let i = 0; i < text.length; i += 1) {
    let ch = text[i] ?? '';
    const code = ch.charCodeAt(0);

    if (code >= 0xff01 && code <= 0xff5e) {
      ch = String.fromCharCode(code - 0xfee0);
    }
    if (ch >= 'A' && ch <= 'Z') {
      ch = ch.toLowerCase();
    }
    if (/\s/.test(ch)) {
      if (normalized.endsWith(' ')) {
        continue;
      }
      ch = ' ';
    }

    normalized += ch;
    indexMap.push(i);
  }

  return {
    normalized: normalized.trim(),
    indexMap,
  };
}
