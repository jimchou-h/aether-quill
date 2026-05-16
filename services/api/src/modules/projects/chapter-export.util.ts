export interface ChapterExportItem {
  chapterNo: number;
  title: string;
  content: string;
}

const CHAPTER_PREFIX_REGEX = /^第\d+章|^第[一二三四五六七八九十百千万]+章/;

/**
 * 将章节列表格式化为可下载的纯文本（按 chapterNo 升序）。
 */
export function buildChaptersTxtExport(chapters: ChapterExportItem[]): string {
  const sorted = [...chapters].sort((a, b) => a.chapterNo - b.chapterNo);
  const blocks = sorted.map((chapter) => {
    const title = chapter.title?.trim() || `第${chapter.chapterNo}章`;
    const content = chapter.content?.trim() || '';
    const header = CHAPTER_PREFIX_REGEX.test(title) ? title : `第${chapter.chapterNo}章 ${title}`;
    return `${header}\n\n${content}`;
  });
  return blocks.join('\n\n\n');
}

export function buildChaptersExportFilename(projectId: string): string {
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  const date = new Date().toISOString().slice(0, 10);
  return `chapters-${safeId}-${date}.txt`;
}
