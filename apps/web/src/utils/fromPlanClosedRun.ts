export type FromPlanClosedPhase = 'draft1' | 'review' | 'draft2' | 'closed' | 'mark_fix';

export function formatFromPlanClosedRunStatus(input: {
  phase: FromPlanClosedPhase;
  hasMaterialGaps?: boolean;
}): string {
  if (input.phase === 'draft1') {
    return '正在按方案改写正文…';
  }
  if (input.phase === 'review') {
    return '正在做连续性自检…';
  }
  if (input.phase === 'draft2') {
    return '正在按自检缺口自动修订一刀…';
  }
  if (input.phase === 'mark_fix') {
    return '正在按你标记的问题修复…';
  }
  return input.hasMaterialGaps
    ? '本轮已收口：已按连续性自检缺口修订一刀，请核对终稿'
    : '本轮已收口：连续性自检通过';
}

export function shouldRunFromPlanRefinePass(hasMaterialGaps: boolean): boolean {
  return hasMaterialGaps;
}

export function formatContinuitySelfCheckSummary(input: {
  reviewed: boolean;
  hadGaps: boolean;
  autoRefined: boolean;
  reviewText?: string;
}): string {
  if (!input.reviewed) {
    return '';
  }
  if (!input.hadGaps) {
    return '连续性自检：通过（情节点 / 场景状态 / 指代）';
  }
  if (input.autoRefined) {
    return '连续性自检：发现缺口并已自动修订一刀；若仍有问题可标记后修复';
  }
  return '连续性自检：发现缺口（未自动修订）；可标记问题后修复';
}
