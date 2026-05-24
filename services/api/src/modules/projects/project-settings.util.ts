/** AQ-133：项目级摘要数 / 温度默认值与校验（与需求文档 §5 对齐） */

export const DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT = 3;
export const DEFAULT_CHAPTER_SUMMARY_MEMORY_COUNT = 3;
export const DEFAULT_GENERATION_TEMPERATURE = 0.7;
export const DEFAULT_PRIOR_CHAPTER_TAIL_CHARS = 800;
export const DEFAULT_CONTEXT_EXCERPT_MAX_CHARS = 400;

export function clampChapterSummaryPromptCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT;
  }
  return Math.min(10, Math.max(0, Math.trunc(n)));
}

export function clampChapterSummaryMemoryCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_CHAPTER_SUMMARY_MEMORY_COUNT;
  }
  return Math.min(10, Math.max(0, Math.trunc(n)));
}

export function clampGenerationTemperature(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_GENERATION_TEMPERATURE;
  }
  return Math.min(2, Math.max(0, n));
}

export function clampPriorChapterTailChars(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_PRIOR_CHAPTER_TAIL_CHARS;
  }
  return Math.min(2000, Math.max(0, Math.trunc(n)));
}

export function clampContextExcerptMaxChars(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_CONTEXT_EXCERPT_MAX_CHARS;
  }
  return Math.min(800, Math.max(200, Math.trunc(n)));
}

export function sliceContentTail(content: string, maxChars: number): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '';
  }
  const limit = clampPriorChapterTailChars(maxChars);
  if (limit <= 0) {
    return '';
  }
  return trimmed.length <= limit ? trimmed : trimmed.slice(-limit);
}
