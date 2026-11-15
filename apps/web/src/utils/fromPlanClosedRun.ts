export type FromPlanClosedPhase = 'draft1' | 'review' | 'draft2' | 'closed' | 'mark_fix';

export function formatFromPlanClosedRunStatus(input: {
  phase: FromPlanClosedPhase;
  hasMaterialGaps?: boolean;
}): string {
  if (input.phase === 'draft1') {
    return '正在按方案改写正文…';
  }
  if (input.phase === 'review') {
    return '正在对照方案验收成稿…';
  }
  if (input.phase === 'draft2') {
    return '正在按自检缺口再改一刀…';
  }
  if (input.phase === 'mark_fix') {
    return '正在按你标记的问题修复…';
  }
  return input.hasMaterialGaps
    ? '本轮已收口：已按方案验收缺口修订一刀，请核对终稿'
    : '本轮已收口：方案验收通过';
}

export interface FromPlanReviewRefineInput {
  reviewGaps: string;
  reviewedDraft: string;
  reviewedPlan: string;
  currentDraft: string;
  currentPlan: string;
}

export function canRefineFromPlanReview(input: FromPlanReviewRefineInput): boolean {
  return (
    input.reviewGaps.trim().length > 0 &&
    input.currentDraft === input.reviewedDraft &&
    input.currentPlan === input.reviewedPlan
  );
}

export function formatContinuitySelfCheckSummary(input: {
  reviewed: boolean;
  hadGaps: boolean;
  refined: boolean;
  reviewText?: string;
  failed?: boolean;
}): string {
  if (input.failed) {
    return '方案验收未完成：请人工核对改写拍点、保留内容与连续性';
  }
  if (!input.reviewed) {
    return '';
  }
  if (!input.hadGaps) {
    return '方案验收：通过（改写拍点 / 保留内容 / 连续性）';
  }
  if (input.refined) {
    return '方案验收：已按验收缺口再改一刀，请核对终稿';
  }
  return '方案验收：发现缺口；可选择按验收缺口再改一刀，或自行标记修复';
}
