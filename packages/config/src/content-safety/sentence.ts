const SENTENCE_END_RE = /[。！？!?；;\n]/;

/** 提取命中 offset 所在句子（含边界标点） */
export function extractSentenceAtOffset(text: string, offset: number): {
  sentence: string;
  start: number;
  end: number;
} {
  const safeOffset = Math.min(Math.max(0, offset), Math.max(0, text.length - 1));

  let start = safeOffset;
  while (start > 0) {
    const prev = text[start - 1] ?? '';
    if (SENTENCE_END_RE.test(prev)) {
      break;
    }
    start -= 1;
  }

  let end = safeOffset;
  while (end < text.length) {
    const current = text[end] ?? '';
    if (SENTENCE_END_RE.test(current)) {
      end += 1;
      break;
    }
    end += 1;
  }

  return {
    sentence: text.slice(start, end).trim(),
    start,
    end,
  };
}

/** 用改写句替换原句 */
export function replaceSentenceInText(
  text: string,
  range: { start: number; end: number },
  rewritten: string
): string {
  const trimmed = rewritten.trim();
  if (!trimmed) {
    return text;
  }
  return `${text.slice(0, range.start)}${trimmed}${text.slice(range.end)}`;
}

export interface SentenceRange {
  sentence: string;
  start: number;
  end: number;
}

/** 收集中风险命中所在的唯一句子（同句去重），按 start 降序便于自后向前替换 */
export function collectUniqueSentenceRangesForHits(
  text: string,
  hitOffsets: number[]
): SentenceRange[] {
  const seen = new Set<string>();
  const ranges: SentenceRange[] = [];

  for (const offset of hitOffsets) {
    const extracted = extractSentenceAtOffset(text, offset);
    if (!extracted.sentence) {
      continue;
    }
    const key = `${extracted.start}:${extracted.end}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ranges.push(extracted);
  }

  return ranges.sort((a, b) => b.start - a.start);
}
