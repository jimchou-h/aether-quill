export type ChapterSummarySource = 'llm' | 'fallback';

export function buildFallbackChapterSummary(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '暂无摘要（章节内容为空）';
  }
  return compact.length > 160 ? `${compact.slice(0, 160)}...` : compact;
}

/** 正文变更写入时：保留已有 LLM 语义摘要，仅对规则摘要或空摘要回退为正文截取 */
export function resolveChapterSummaryOnContentWrite(input: {
  content: string;
  existing?: {
    summary?: string;
    summarySource?: ChapterSummarySource;
    summaryUpdatedAt?: Date;
  } | null;
  now?: Date;
}): {
  summary: string;
  summarySource: ChapterSummarySource;
  summaryUpdatedAt: Date;
} {
  const now = input.now ?? new Date();
  const fallback = buildFallbackChapterSummary(input.content);
  const existing = input.existing;

  if (
    existing?.summarySource === 'llm' &&
    typeof existing.summary === 'string' &&
    existing.summary.trim()
  ) {
    return {
      summary: existing.summary.trim(),
      summarySource: 'llm',
      summaryUpdatedAt: existing.summaryUpdatedAt ?? now,
    };
  }

  return {
    summary: fallback,
    summarySource: 'fallback',
    summaryUpdatedAt: now,
  };
}
