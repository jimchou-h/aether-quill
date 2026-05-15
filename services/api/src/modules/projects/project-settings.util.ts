/** AQ-133：项目级摘要数 / 温度默认值与校验（与需求文档 §5 对齐） */

export const DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT = 3;
export const DEFAULT_GENERATION_TEMPERATURE = 0.7;

export function clampChapterSummaryPromptCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_CHAPTER_SUMMARY_PROMPT_COUNT;
  }
  return Math.min(20, Math.max(0, Math.trunc(n)));
}

export function clampGenerationTemperature(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_GENERATION_TEMPERATURE;
  }
  return Math.min(2, Math.max(0, n));
}
