/** AQ-133 / AQ-206 / AQ-224：近期连续性池 + 语义记忆池 + 无摘要 excerpt 降级 */

export type ChapterSummaryInput = {
  chapterNo: number;
  title: string;
  summary: string;
  /** 完整正文（无摘要降级 excerpt 来源） */
  content?: string;
  /** API 同步的正文末尾片段 */
  contentTail?: string;
};

export type PriorChapterPickResult = ChapterSummaryInput & {
  usedExcerptFallback?: boolean;
};

function hasPriorContent(ch: ChapterSummaryInput): boolean {
  return Boolean(ch.summary?.trim() || ch.content?.trim() || ch.contentTail?.trim());
}

export function buildChapterExcerpt(ch: ChapterSummaryInput, maxChars: number): string {
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.trunc(maxChars)) : 0;
  if (limit <= 0) {
    return '';
  }
  const source = (ch.contentTail?.trim() || ch.content?.trim() || '').trim();
  if (!source) {
    return '';
  }
  return source.length <= limit ? source : source.slice(-limit);
}

export function pickPriorChapterSummariesForPrompt(
  chapters: ChapterSummaryInput[],
  opts: { currentChapterNo?: number; maxCount: number; excerptMaxChars?: number }
): PriorChapterPickResult[] {
  const maxCount = Number.isFinite(opts.maxCount) ? Math.trunc(opts.maxCount) : 0;
  if (maxCount <= 0) {
    return [];
  }

  const excerptMax =
    opts.excerptMaxChars !== undefined && Number.isFinite(opts.excerptMaxChars)
      ? Math.trunc(opts.excerptMaxChars)
      : 400;

  const eligible = chapters.filter(hasPriorContent);
  let current = opts.currentChapterNo;
  if (!current || current <= 0 || !Number.isFinite(current)) {
    const maxNo = eligible.reduce((m, ch) => Math.max(m, ch.chapterNo), 0);
    current = maxNo + 1;
  }

  const picked = eligible
    .filter((ch) => ch.chapterNo < current!)
    .sort((a, b) => b.chapterNo - a.chapterNo)
    .slice(0, maxCount);

  return picked.map((ch) => {
    const summaryText = ch.summary?.trim();
    if (summaryText) {
      return { ...ch, summary: summaryText, usedExcerptFallback: false };
    }
    const excerpt = buildChapterExcerpt(ch, excerptMax);
    return { ...ch, summary: excerpt, usedExcerptFallback: Boolean(excerpt) };
  }).filter((ch) => ch.summary?.trim());
}
