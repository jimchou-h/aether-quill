import { scoreTitleAgainstMatchingText } from './title-match-score';

/** 将正文按空行或句号分段 */
export function splitDocumentParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}|(?<=[。！？!?])\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function scoreParagraphAgainstQuery(query: string, paragraph: string): number {
  return scoreTitleAgainstMatchingText(query, paragraph);
}

/** 非角色卡文档：按匹配度取 Top N 段落 */
export function pickTopParagraphs(content: string, query: string, topN = 3): string[] {
  const paragraphs = splitDocumentParagraphs(content);
  if (paragraphs.length === 0) {
    return [];
  }
  const ranked = paragraphs
    .map((paragraph) => ({
      paragraph,
      score: scoreParagraphAgainstQuery(query, paragraph),
    }))
    .sort((a, b) => b.score - a.score || a.paragraph.length - b.paragraph.length);

  const positive = ranked.filter((row) => row.score > 0);
  const source = positive.length > 0 ? positive : ranked;
  return source.slice(0, topN).map((row) => row.paragraph);
}

export function formatCroppedDocumentContent(
  title: string,
  paragraphs: string[],
  documentId: string
): string {
  if (paragraphs.length === 0) {
    return '';
  }
  const body = paragraphs.map((p, i) => `[段落${i + 1}]\n${p}`).join('\n\n');
  return `[知识裁剪] document_id=${documentId} title=${title}\n${body}`;
}
