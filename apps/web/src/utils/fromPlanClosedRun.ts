export type FromPlanClosedPhase = 'draft1' | 'review' | 'draft2' | 'closed';

export function formatFromPlanClosedRunStatus(input: {
  phase: FromPlanClosedPhase;
  hasMaterialGaps?: boolean;
}): string {
  if (input.phase === 'draft1') {
    return '正在按方案改写正文…';
  }
  if (input.phase === 'review') {
    return '正在对照冻结合同验收…';
  }
  if (input.phase === 'draft2') {
    return '正在按验收缺口补写一刀…';
  }
  return input.hasMaterialGaps ? '本轮已收口：已按验收缺口补写一刀' : '本轮已收口：对照合同无实质缺口';
}

export function shouldRunFromPlanRefinePass(hasMaterialGaps: boolean): boolean {
  return hasMaterialGaps;
}
