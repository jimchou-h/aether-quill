import type { PipelineOutlineItem } from '../services/api';

/** 大纲 required+suggested 均无有效 text 时视为空 */
export function isPipelineOutlineEmpty(
  required: PipelineOutlineItem[],
  suggested: PipelineOutlineItem[]
): boolean {
  return ![...required, ...suggested].some((item) => Boolean(item.text?.trim()));
}

/** 必需大纲项是否均已落实（done 或人工确认 manual） */
export function areRequiredOutlineItemsResolved(required: PipelineOutlineItem[]): boolean {
  if (required.length === 0) {
    return true;
  }
  return required.every(
    (item) => item.coverageStatus === 'done' || item.coverageStatus === 'manual'
  );
}

export function listFixableCoverageItemIds(
  required: PipelineOutlineItem[],
  suggested: PipelineOutlineItem[]
): string[] {
  return [...required, ...suggested]
    .filter((item) => item.coverageStatus === 'partial' || item.coverageStatus === 'missed')
    .map((item) => item.id);
}
