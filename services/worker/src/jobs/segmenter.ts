import { countTokens, decode, encode } from 'gpt-tokenizer';

export type IngestSegmenterMode = 'paragraph-first';

export interface IngestSegmenterOptions {
  maxTokensPerChunk: number;
  tokenOverlap: number;
  mode: IngestSegmenterMode;
}

/** 「」嵌套深度：左引号 +1，右引号 -1，避免未闭合时整篇被吞并 */
export function mergeNewlinesInsideDialogue(raw: string): string {
  let out = '';
  let depth = 0;
  let lastOpenIndex = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (ch === '「') {
      depth += 1;
      lastOpenIndex = i;
    } else if (ch === '」') {
      depth = Math.max(0, depth - 1);
    }

    if (depth > 0 && lastOpenIndex >= 0 && i - lastOpenIndex > 8000) {
      depth = 0;
    }

    if (depth > 0 && ch === '\n') {
      const prev = out[out.length - 1];
      if (prev !== ' ' && prev !== '\n' && prev !== undefined) {
        out += ' ';
      }
      continue;
    }

    out += ch;
  }

  return out;
}

function findLastStrongBreak(s: string): number {
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ('。！？；\n'.includes(ch)) {
      last = i;
    }
  }
  return last;
}

/**
 * 对超长段落按 token 滑窗切分；优先在句末标点处截断，overlap 为 token 级重叠。
 */
export function splitParagraphByTokens(
  paragraph: string,
  maxTokens: number,
  overlapTokens: number
): string[] {
  const trimmed = paragraph.trim();
  if (!trimmed) {
    return [];
  }

  const tokens = encode(trimmed);
  if (tokens.length <= maxTokens) {
    return [trimmed];
  }

  const pieces: string[] = [];
  let start = 0;

  while (start < tokens.length) {
    let end = Math.min(start + maxTokens, tokens.length);
    let text = decode(tokens.slice(start, end));

    if (end < tokens.length) {
      const br = findLastStrongBreak(text);
      const minKeep = Math.max(32, Math.floor(text.length * 0.15));
      if (br >= minKeep) {
        const head = text.slice(0, br + 1).trimEnd();
        const headTokens = encode(head);
        if (headTokens.length >= 16 && headTokens.length <= maxTokens) {
          end = start + headTokens.length;
          text = head;
        }
      }
    }

    const chunk = text.trim();
    if (chunk.length > 0) {
      pieces.push(chunk);
    }

    if (end >= tokens.length) {
      break;
    }

    let nextStart = end - overlapTokens;
    if (nextStart <= start) {
      nextStart = start + Math.max(1, Math.floor(maxTokens / 2));
    }
    start = nextStart;
  }

  return pieces;
}

function splitIntoParagraphs(merged: string): string[] {
  return merged
    .split(/\n{2,}/)
    .map((p) => p.replace(/\r\n/g, '\n').trim())
    .filter((p) => p.length > 0);
}

/**
 * paragraph-first：空行分段 → 超长段按 token 窗口 + overlap 切；对话块内换行已合并为空格，避免「跨切」。
 */
export function segmentForIngestion(content: string, options: IngestSegmenterOptions): string[] {
  if (options.mode !== 'paragraph-first') {
    throw new Error(`Unsupported INGEST_SEGMENTER: ${options.mode}`);
  }

  const max = options.maxTokensPerChunk;
  const overlap = Math.min(options.tokenOverlap, Math.max(0, max - 1));

  const merged = mergeNewlinesInsideDialogue(content);
  const paragraphs = splitIntoParagraphs(merged.length > 0 ? merged : content);

  const flat: string[] = [];
  for (const p of paragraphs) {
    if (countTokens(p) <= max) {
      flat.push(p);
    } else {
      flat.push(...splitParagraphByTokens(p, max, overlap));
    }
  }

  if (flat.length === 0) {
    const fallback = content.trim();
    if (fallback) {
      flat.push(...splitParagraphByTokens(fallback, max, overlap));
    }
  }

  return flat;
}

export function countChunkTokens(text: string): number {
  return countTokens(text);
}
