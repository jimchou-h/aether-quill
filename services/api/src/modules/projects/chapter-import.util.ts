/**
 * 章节导入工具（AQ-161~AQ-162）
 *
 * 提供小说原文文本的章节检测/切分，及预览/导入数据结构定义。
 *
 * 切分策略（首版）：
 * 1. 按显式章节标题优先匹配（支持多种常见格式）；
 * 2. 无标题匹配时按固定长度（5000 字符）兜底分段；
 * 3. 空章节（无有效正文）跳过。
 */

export interface ChapterImportSegment {
  chapterNo: number;
  title: string;
  content: string;
}

export interface ChapterImportPreviewItem {
  chapterNo: number;
  title: string;
  contentLength: number;
  contentPreview: string;
}

export interface ChapterImportPreviewResult {
  totalChars: number;
  detectedCount: number;
  chapters: ChapterImportPreviewItem[];
}

const MAX_IMPORT_CHARS = 5_242_880;
const FALLBACK_SEGMENT_CHARS = 5000;
const PREVIEW_CHARS = 200;

/**
 * 章节序号：阿拉伯数字或中文数字（含常见变体）。
 * 命中「第…章/节/话…」时，中间为任一形式均视为章节标题。
 */
const CHAPTER_NUMERAL = '(?:\\d+|[一二三四五六七八九十百千万零〇两]+)';
const CHAPTER_UNIT = '[章节话回部集卷]';
/** 章后：行尾，或标点/空白 + 副标题（避免正文「第一章使用…」误命中） */
const CHAPTER_TITLE_TAIL = '(?:[\\s，。、：]+.*|[\\s，。、：]*$)';

function buildDiChapterTitlePattern(markdownHeading: boolean): RegExp {
  const prefix = markdownHeading ? '^#{1,3}\\s*' : '^';
  return new RegExp(
    `${prefix}第\\s*${CHAPTER_NUMERAL}\\s*${CHAPTER_UNIT}${CHAPTER_TITLE_TAIL}$`,
    'm'
  );
}

/**
 * 常见的章节标题正则（按优先级）
 * 匹配规则：
 * - 「第X章」「第X节」「第X话」「第X回」（X 为阿拉伯或中文数字）
 * - 「Chapter X」「Chapter-X」
 * - Markdown 标题「## 第X章」
 * - 纯数字标题行如「1.」
 */
const CHAPTER_TITLE_PATTERNS: RegExp[] = [
  buildDiChapterTitlePattern(true),
  buildDiChapterTitlePattern(false),
  /^#{1,3}\s*[Cc]hapter\s*\d+[\s：:].*$/m,
  /^[Cc]hapter\s*\d+[\s：:].*$/m,
  /^#{1,3}\s*\d+[.、．]\s*.*$/m,
];

function extractTitleText(line: string): string {
  return line.replace(/^#{1,3}\s*/, '').trim();
}

function isMeaningfulContent(text: string): boolean {
  return text.replace(/\s/g, '').length > 20;
}

/**
 * 从纯文本中检测章节标题，返回所有匹配行及其行号。
 */
function detectChapterTitleLines(text: string): Array<{ lineIndex: number; title: string }> {
  const lines = text.split('\n');
  const results: Array<{ lineIndex: number; title: string }> = [];
  const seenTitles = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    for (const pattern of CHAPTER_TITLE_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        const title = extractTitleText(match[0]);
        if (!seenTitles.has(title)) {
          seenTitles.add(title);
          results.push({ lineIndex: i, title });
        }
        break;
      }
    }
  }

  return results;
}

/**
 * 生成兜底章节标题。
 */
function makeFallbackTitle(chapterNo: number): string {
  return `第${chapterNo}章`;
}

/**
 * 按标题行分割文本为章节块。
 */
function splitByTitleLines(
  text: string,
  titleLines: Array<{ lineIndex: number; title: string }>
): ChapterImportSegment[] {
  const lines = text.split('\n');
  const segments: ChapterImportSegment[] = [];

  for (let i = 0; i < titleLines.length; i++) {
    const current = titleLines[i]!;
    const next = titleLines[i + 1];
    const startLine = current.lineIndex + 1;
    const endLine = next ? next.lineIndex : lines.length;
    const contentLines = lines.slice(startLine, endLine);
    const content = contentLines.join('\n').trim();

    if (!isMeaningfulContent(content)) continue;

    segments.push({
      chapterNo: i + 1,
      title: current.title,
      content,
    });
  }

  return segments;
}

/**
 * 按固定长度做兜底分段。
 */
function splitByFallback(text: string, maxChars: number): ChapterImportSegment[] {
  const segments: ChapterImportSegment[] = [];
  let remaining = text.trim();
  let chapterNo = 1;

  while (remaining.length > 0) {
    const chunk = remaining.slice(0, maxChars);
    remaining = remaining.slice(maxChars);

    if (!isMeaningfulContent(chunk)) {
      break;
    }

    segments.push({
      chapterNo,
      title: makeFallbackTitle(chapterNo),
      content: chunk,
    });
    chapterNo++;
  }

  return segments;
}

/**
 * 主入口：解析小说原文，返回章节切分结果。
 *
 * @param content - 小说原文文本（纯文本或 Markdown）
 * @returns 按顺序排列的章节片段数组
 */
export function parseNovelContent(content: string): ChapterImportSegment[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const titleLines = detectChapterTitleLines(content);

  if (titleLines.length > 0) {
    const segments = splitByTitleLines(content, titleLines);
    if (segments.length > 0) {
      return segments;
    }
  }

  return splitByFallback(content, FALLBACK_SEGMENT_CHARS);
}

/**
 * 预览小说导入结果。
 */
export function previewChapterImport(content: string): ChapterImportPreviewResult {
  const totalChars = content.length;

  if (totalChars > MAX_IMPORT_CHARS) {
    throw Object.assign(new Error('Import content exceeds maximum size'), { code: 1317 });
  }

  const segments = parseNovelContent(content);

  const chapters: ChapterImportPreviewItem[] = segments.map((seg) => ({
    chapterNo: seg.chapterNo,
    title: seg.title,
    contentLength: seg.content.length,
    contentPreview: seg.content.slice(0, PREVIEW_CHARS),
  }));

  return {
    totalChars,
    detectedCount: chapters.length,
    chapters,
  };
}

/**
 * 校验导入的章节列表是否合法。
 */
export function validateImportChapters(chapters: ChapterImportSegment[]): void {
  if (!chapters || chapters.length === 0) {
    throw Object.assign(new Error('No valid chapters to import'), { code: 1318 });
  }

  for (const chapter of chapters) {
    if (!chapter.title?.trim()) {
      throw Object.assign(new Error('Chapter title is required'), { code: 1319 });
    }
    if (!chapter.content?.trim()) {
      throw Object.assign(new Error('Chapter content is required'), { code: 1319 });
    }
    if (!Number.isFinite(chapter.chapterNo) || chapter.chapterNo < 1) {
      throw Object.assign(new Error('Invalid chapter number'), { code: 1319 });
    }
  }
}
