import type { PipelineOutlineItem } from '../services/api';

/** 大纲 required+suggested 均无有效 text 时视为空 */
export function isPipelineOutlineEmpty(
  required: PipelineOutlineItem[],
  suggested: PipelineOutlineItem[]
): boolean {
  return ![...required, ...suggested].some((item) => Boolean(item.text?.trim()));
}
