export type HitSource =
  | 'title_match'
  | 'full_document_by_title'
  | 'paragraph_crop_by_title'
  | 'paragraph_crop'
  | 'vector'
  | 'vector_full_document'
  | 'unknown'
  | 'skipped';

export interface GsRItemResult {
  id: string;
  rankedDocumentIds: string[];
  hitSources: HitSource[];
  skipped: boolean;
  expectedDocumentIds: string[];
  expectSkip: boolean;
  /** 各 K 是否命中至少一个期望文档 */
  recallAtK: Record<number, boolean>;
  /** skip 期望是否满足 */
  skipOk: boolean;
}

export interface GsRMetricsReport {
  datasetVersion: string;
  evaluatedAt: string;
  mode: 'offline-structured' | 'live-preview';
  itemCount: number;
  scoredItemCount: number;
  skipItemCount: number;
  skipPassRate: number;
  recallAtK: Record<number, number>;
  mrrAt10: number;
  hitSourceDistribution: Record<string, number>;
  failures: Array<{ id: string; reason: string; rankedDocumentIds: string[] }>;
  conclusion: 'PASS' | 'PASS_WITH_RISK' | 'FAIL';
  thresholds: {
    recallAt10: number;
    recallAt30: number;
    mrrAt10: number;
  };
}

export function computeRecallAtK(
  rankedDocumentIds: string[],
  expectedDocumentIds: string[],
  k: number
): boolean {
  if (expectedDocumentIds.length === 0) {
    return false;
  }
  const top = rankedDocumentIds.slice(0, Math.max(0, k));
  const expected = new Set(expectedDocumentIds);
  return top.some((id) => expected.has(id));
}

/** 首个正确证据的倒数排名；未命中返回 0 */
export function reciprocalRank(rankedDocumentIds: string[], expectedDocumentIds: string[]): number {
  if (expectedDocumentIds.length === 0) {
    return 0;
  }
  const expected = new Set(expectedDocumentIds);
  const idx = rankedDocumentIds.findIndex((id) => expected.has(id));
  if (idx < 0) {
    return 0;
  }
  return 1 / (idx + 1);
}

export function evaluateItem(input: {
  id: string;
  rankedDocumentIds: string[];
  hitSources: HitSource[];
  skipped: boolean;
  expectedDocumentIds: string[];
  expectSkip?: boolean;
  ks: number[];
}): GsRItemResult {
  const expectSkip = Boolean(input.expectSkip);
  const recallAtK: Record<number, boolean> = {};
  for (const k of input.ks) {
    recallAtK[k] = computeRecallAtK(input.rankedDocumentIds, input.expectedDocumentIds, k);
  }
  return {
    id: input.id,
    rankedDocumentIds: input.rankedDocumentIds,
    hitSources: input.hitSources,
    skipped: input.skipped,
    expectedDocumentIds: input.expectedDocumentIds,
    expectSkip,
    recallAtK,
    skipOk: expectSkip ? input.skipped && input.rankedDocumentIds.length === 0 : true,
  };
}

export function aggregateMetrics(input: {
  datasetVersion: string;
  mode: GsRMetricsReport['mode'];
  results: GsRItemResult[];
  ks: number[];
  thresholds?: Partial<GsRMetricsReport['thresholds']>;
  evaluatedAt?: string;
}): GsRMetricsReport {
  const thresholds = {
    recallAt10: input.thresholds?.recallAt10 ?? 0.78,
    recallAt30: input.thresholds?.recallAt30 ?? 0.9,
    mrrAt10: input.thresholds?.mrrAt10 ?? 0.62,
  };

  const skipItems = input.results.filter((r) => r.expectSkip);
  const scored = input.results.filter((r) => !r.expectSkip && r.expectedDocumentIds.length > 0);

  const recallAtK: Record<number, number> = {};
  for (const k of input.ks) {
    if (scored.length === 0) {
      recallAtK[k] = 0;
      continue;
    }
    const hits = scored.filter((r) => r.recallAtK[k]).length;
    recallAtK[k] = hits / scored.length;
  }

  const mrrSum = scored.reduce((sum, r) => {
    const top10 = r.rankedDocumentIds.slice(0, 10);
    return sum + reciprocalRank(top10, r.expectedDocumentIds);
  }, 0);
  const mrrAt10 = scored.length === 0 ? 0 : mrrSum / scored.length;

  const hitSourceDistribution: Record<string, number> = {};
  for (const r of input.results) {
    if (r.skipped || r.hitSources.length === 0) {
      hitSourceDistribution.skipped = (hitSourceDistribution.skipped ?? 0) + 1;
      continue;
    }
    for (const src of r.hitSources) {
      hitSourceDistribution[src] = (hitSourceDistribution[src] ?? 0) + 1;
    }
  }

  const failures: GsRMetricsReport['failures'] = [];
  for (const r of skipItems) {
    if (!r.skipOk) {
      failures.push({
        id: r.id,
        reason: '期望跳过检索但返回了命中',
        rankedDocumentIds: r.rankedDocumentIds,
      });
    }
  }
  for (const r of scored) {
    const k30 = Math.max(...input.ks.filter((k) => k <= 30), 30);
    if (!computeRecallAtK(r.rankedDocumentIds, r.expectedDocumentIds, k30)) {
      failures.push({
        id: r.id,
        reason: `Recall@${k30} 未命中期望文档 ${r.expectedDocumentIds.join(',')}`,
        rankedDocumentIds: r.rankedDocumentIds,
      });
    }
  }

  const r10 = recallAtK[10] ?? recallAtK[Math.max(...input.ks.filter((k) => k <= 10))] ?? 0;
  const r30 = recallAtK[30] ?? recallAtK[Math.max(...input.ks)] ?? 0;

  let conclusion: GsRMetricsReport['conclusion'] = 'PASS';
  if (r30 < thresholds.recallAt30 || r10 < thresholds.recallAt10 || mrrAt10 < thresholds.mrrAt10) {
    conclusion = 'FAIL';
  } else if (failures.length > 0) {
    conclusion = 'PASS_WITH_RISK';
  }

  const skipPassRate =
    skipItems.length === 0 ? 1 : skipItems.filter((r) => r.skipOk).length / skipItems.length;

  return {
    datasetVersion: input.datasetVersion,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    mode: input.mode,
    itemCount: input.results.length,
    scoredItemCount: scored.length,
    skipItemCount: skipItems.length,
    skipPassRate,
    recallAtK,
    mrrAt10,
    hitSourceDistribution,
    failures,
    conclusion,
    thresholds,
  };
}

export function formatMetricsReportMarkdown(report: GsRMetricsReport): string {
  const recallLines = Object.entries(report.recallAtK)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `- Recall@${k}: ${(v * 100).toFixed(1)}%`)
    .join('\n');
  const sourceLines = Object.entries(report.hitSourceDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const failLines =
    report.failures.length === 0
      ? '- （无）'
      : report.failures
          .slice(0, 20)
          .map((f) => `- ${f.id}: ${f.reason}；ranked=[${f.rankedDocumentIds.join(',')}]`)
          .join('\n');

  return [
    `# GS-R 评测报告`,
    ``,
    `- 数据集版本: ${report.datasetVersion}`,
    `- 评测时间: ${report.evaluatedAt}`,
    `- 模式: ${report.mode}`,
    `- 样本数: ${report.itemCount}（计分 ${report.scoredItemCount}，skip ${report.skipItemCount}）`,
    `- 结论: **${report.conclusion}**`,
    ``,
    `## 检索指标`,
    recallLines,
    `- MRR@10: ${report.mrrAt10.toFixed(4)}`,
    `- skip 通过率: ${(report.skipPassRate * 100).toFixed(1)}%`,
    ``,
    `## 阈值`,
    `- Recall@10 >= ${report.thresholds.recallAt10}`,
    `- Recall@30 >= ${report.thresholds.recallAt30}`,
    `- MRR@10 >= ${report.thresholds.mrrAt10}`,
    ``,
    `## 命中来源分布`,
    sourceLines || '- （无）',
    ``,
    `## 失败样本（最多 20）`,
    failLines,
    ``,
  ].join('\n');
}
