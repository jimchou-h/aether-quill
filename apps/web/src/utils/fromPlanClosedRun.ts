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
    return '正在按自检缺口自动修订一刀…';
  }
  if (input.phase === 'mark_fix') {
    return '正在按你标记的问题修复…';
  }
  return input.hasMaterialGaps
    ? '本轮已收口：已按方案验收缺口修订一刀，请核对终稿'
    : '本轮已收口：方案验收通过';
}

export function shouldRunFromPlanRefinePass(hasMaterialGaps: boolean): boolean {
  return hasMaterialGaps;
}

export function formatContinuitySelfCheckSummary(input: {
  reviewed: boolean;
  hadGaps: boolean;
  autoRefined: boolean;
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
  if (input.autoRefined) {
    return '方案验收：发现缺口并已自动修订一刀；若仍有问题可标记后修复';
  }
  return '方案验收：发现缺口（未自动修订）；可标记问题后修复';
}
