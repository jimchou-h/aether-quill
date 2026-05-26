import type { ChapterStructuredInfo } from '../services/api';

/** 与 API `resolveStructuredMatchingTextForSync` 对齐：规则补全名并入标题匹配 query */
export function resolveEffectiveStructuredMatchingText(
  info?: ChapterStructuredInfo
): string | undefined {
  const matchingText = info?.matchingText?.trim() ?? '';
  const supplements = (info?.personaKeywordSupplements ?? []).filter((k) => k.trim().length >= 2);
  if (!matchingText && supplements.length === 0) {
    return undefined;
  }
  if (supplements.length === 0) {
    return matchingText || undefined;
  }
  if (!matchingText) {
    return supplements.join(' ');
  }
  return `${matchingText} ${supplements.join(' ')}`.trim();
}

export function isPersonaKeywordSupplement(kw: string, info?: ChapterStructuredInfo): boolean {
  return Boolean(info?.personaKeywordSupplements?.includes(kw));
}

/** 是否已有可用于知识库标题匹配的结构化结果（与 PromptConsole / 生成前校验对齐） */
export function normalizeWorkbenchChapterNo(value: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function resolveWorkbenchStructuredInfo(
  chapterNo: number,
  chapters: Array<{ chapterNo: number; structuredInfo?: ChapterStructuredInfo }>,
  drafts?: Record<string, ChapterStructuredInfo> | Record<number, ChapterStructuredInfo>
): ChapterStructuredInfo | undefined {
  const n = normalizeWorkbenchChapterNo(chapterNo);
  const fromChapter = chapters.find((c) => c.chapterNo === n)?.structuredInfo;
  if (fromChapter) {
    return fromChapter;
  }
  if (!drafts) {
    return undefined;
  }
  const key = String(n);
  return (drafts as Record<string, ChapterStructuredInfo>)[key];
}

export function hasStructuredInfoForKnowledgeMatch(info?: ChapterStructuredInfo): boolean {
  if (!info) {
    return false;
  }
  if (info.matchingText?.trim()) {
    return true;
  }
  if (resolveEffectiveStructuredMatchingText(info)?.trim()) {
    return true;
  }
  if (info.keywords?.some((kw) => kw.trim().length >= 2)) {
    return true;
  }
  return false;
}
