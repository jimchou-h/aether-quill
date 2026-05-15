/** AQ-133：按「当前章之前」选取最近 N 条有摘要的章节，用于叙事上下文拼接 */

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
