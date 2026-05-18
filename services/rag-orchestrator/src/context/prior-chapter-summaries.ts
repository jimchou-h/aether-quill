/** AQ-133 / AQ-206：近期连续性池 + 语义记忆池 */

export type ChapterSummaryInput = {
  chapterNo: number;
  title: string;
  summary: string;
};

export function pickPriorChapterSummariesForPrompt(
  chapters: ChapterSummaryInput[],
  opts: { currentChapterNo?: number; maxCount: number }
): ChapterSummaryInput[] {
  const maxCount = Number.isFinite(opts.maxCount) ? Math.trunc(opts.maxCount) : 0;
  if (maxCount <= 0) {
    return [];
  }

  const withSummary = chapters.filter((ch) => ch.summary?.trim());
  let current = opts.currentChapterNo;
  if (!current || current <= 0 || !Number.isFinite(current)) {
    const maxNo = withSummary.reduce((m, ch) => Math.max(m, ch.chapterNo), 0);
    current = maxNo + 1;
  }

  return withSummary
    .filter((ch) => ch.chapterNo < current!)
    .sort((a, b) => b.chapterNo - a.chapterNo)
    .slice(0, maxCount);
}
