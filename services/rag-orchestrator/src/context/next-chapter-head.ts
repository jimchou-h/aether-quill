/** AQ-229：第 N+1 章正文开头衔接段（章节优化只读锚点） */

import type { ChapterSummaryInput } from './prior-chapter-summaries';

export type NextChapterHeadResult = {
  text: string;
  skipped: boolean;
  chars: number;
  chapterNo?: number;
};

export function resolveNextChapterHead(
  chapters: ChapterSummaryInput[],
  currentChapterNo: number,
  headChars: number
): NextChapterHeadResult {
  const maxChars = Number.isFinite(headChars) ? Math.trunc(headChars) : 0;
  if (maxChars <= 0 || !Number.isFinite(currentChapterNo) || currentChapterNo <= 0) {
    return { text: '', skipped: true, chars: 0 };
  }

  const nextNo = currentChapterNo + 1;
  const next = chapters.find((ch) => ch.chapterNo === nextNo);
  if (!next) {
    return { text: '', skipped: true, chars: 0 };
  }

  const source = (next.content?.trim() || '').trim();
  if (!source) {
    return { text: '', skipped: true, chars: 0, chapterNo: nextNo };
  }

  const text = source.length <= maxChars ? source : source.slice(0, maxChars);
  return { text, skipped: false, chars: text.length, chapterNo: nextNo };
}
