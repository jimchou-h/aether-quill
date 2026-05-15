/** 编排侧项目级生成偏好默认值与边界（与 API 校验语义一致） */

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
