/** AQ-224：第 N-1 章正文末尾衔接段 */

import type { ChapterSummaryInput } from './prior-chapter-summaries';

export type PriorChapterTailResult = {
  text: string;
  skipped: boolean;
  chars: number;
  chapterNo?: number;
};

export function resolvePriorChapterTail(
  chapters: ChapterSummaryInput[],
  currentChapterNo: number,
  tailChars: number
): PriorChapterTailResult {
  const maxChars = Number.isFinite(tailChars) ? Math.trunc(tailChars) : 0;
  if (maxChars <= 0 || !Number.isFinite(currentChapterNo) || currentChapterNo <= 1) {
    return { text: '', skipped: true, chars: 0 };
  }

  const priorNo = currentChapterNo - 1;
  const prior = chapters.find((ch) => ch.chapterNo === priorNo);
  if (!prior) {
    return { text: '', skipped: true, chars: 0 };
  }

  const source = (prior.contentTail?.trim() || prior.content?.trim() || '').trim();
  if (!source) {
    return { text: '', skipped: true, chars: 0, chapterNo: priorNo };
  }

  const text = source.length <= maxChars ? source : source.slice(-maxChars);
  return { text, skipped: false, chars: text.length, chapterNo: priorNo };
}
