/**
 * Tab label for a chapter: avoid "第1章 第1章" when the title already names the chapter.
 */
export function formatChapterTabTitle(chapterNo: number, title: string): string {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return '';
  }
  const chapterLabel = `第${chapterNo}章`;
  if (normalizedTitle === chapterLabel || normalizedTitle === `第 ${chapterNo} 章`) {
    return '';
  }
  if (
    normalizedTitle.startsWith(`${chapterLabel} `) ||
    normalizedTitle.startsWith(`${chapterLabel}·`)
  ) {
    return normalizedTitle
      .slice(chapterLabel.length)
      .trim()
      .replace(/^[·\-\s]+/, '');
  }
  return normalizedTitle;
}
