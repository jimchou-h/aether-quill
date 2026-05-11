export type ChapterSummarySource = 'llm' | 'fallback';

export function buildFallbackChapterSummary(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '暂无摘要（章节内容为空）';
  }
  return compact.length > 160 ? `${compact.slice(0, 160)}...` : compact;
}
