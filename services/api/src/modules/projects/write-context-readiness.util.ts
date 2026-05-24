/** AQ-225：写作前上下文就绪检查 */

export type WriteContextReadiness = {
  chapterNo: number;
  priorChapterExists: boolean;
  priorChaptersMissingSummary: number[];
  recommendedActions: Array<'batch_summarize'>;
};

export function buildWriteContextReadiness(
  chapterNo: number,
  chapters: Array<{ chapterNo: number; summary?: string; content?: string }>
): WriteContextReadiness {
  const normalized = Number.isFinite(chapterNo) ? Math.trunc(chapterNo) : 0;
  if (normalized <= 0) {
    return {
      chapterNo: normalized,
      priorChapterExists: false,
      priorChaptersMissingSummary: [],
      recommendedActions: [],
    };
  }

  const prior = chapters.filter((ch) => ch.chapterNo < normalized);
  const priorChapterExists =
    normalized > 1 && prior.some((ch) => ch.chapterNo === normalized - 1 && Boolean(ch.content?.trim()));

  const missingSummary = prior
    .filter((ch) => !ch.summary?.trim() && Boolean(ch.content?.trim()))
    .map((ch) => ch.chapterNo)
    .sort((a, b) => a - b);

  const recommendedActions: WriteContextReadiness['recommendedActions'] =
    missingSummary.length > 0 ? ['batch_summarize'] : [];

  return {
    chapterNo: normalized,
    priorChapterExists,
    priorChaptersMissingSummary: missingSummary,
    recommendedActions,
  };
}
