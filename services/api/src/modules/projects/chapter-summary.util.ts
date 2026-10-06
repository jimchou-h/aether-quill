import {
  buildFallbackChapterSummary,
  normalizeChapterSummary,
} from '@aether-quill/config';

export type ChapterSummarySource = 'llm' | 'fallback';

export { buildFallbackChapterSummary };

/**
 * 正文变更写入时的摘要字段。
 * 已有非空 LLM 摘要时保留，避免手改保存冲掉语义摘要；
 * 无 LLM 摘要时回退为模板形规则摘要（fallback）。完整语义摘要仍需用户点击「生成摘要」。
 */
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
  const existingSummary = input.existing?.summary?.trim() ?? '';
  if (input.existing?.summarySource === 'llm' && existingSummary) {
    return {
      summary: input.existing.summary ?? existingSummary,
      summarySource: 'llm',
      summaryUpdatedAt: input.existing.summaryUpdatedAt ?? now,
    };
  }
  return {
    summary: buildFallbackChapterSummary(input.content),
    summarySource: 'fallback',
    summaryUpdatedAt: now,
  };
}

/**
 * 章节优化 apply 时的摘要策略（AQ-254）。
 * 默认保留既有摘要；preserveSummary=false 时与手工保存一致。
 */
export function resolveChapterSummaryOnOptimizeApply(input: {
  preserveSummary?: boolean;
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
  reindexSummaryVector: boolean;
} {
  const now = input.now ?? new Date();
  const preserveSummary = input.preserveSummary !== false;

  if (preserveSummary) {
    return {
      summary: input.existing?.summary ?? '',
      summarySource: input.existing?.summarySource ?? 'fallback',
      summaryUpdatedAt: input.existing?.summaryUpdatedAt ?? now,
      reindexSummaryVector: false,
    };
  }

  const fields = {
    summary: buildFallbackChapterSummary(input.content),
    summarySource: 'fallback' as const,
    summaryUpdatedAt: now,
  };
  return { ...fields, reindexSummaryVector: true };
}

/** LLM 返回文本二次规范化；失败返回 null，由调用方走 fallback。 */
export function normalizeLlmChapterSummary(raw: string): string | null {
  return normalizeChapterSummary(raw);
}
