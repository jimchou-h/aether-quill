import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateMetrics,
  computeRecallAtK,
  evaluateItem,
  reciprocalRank,
  type GsRItemResult,
} from './metrics';

describe('gs-r metrics', () => {
  it('computes Recall@K and MRR', () => {
    assert.equal(computeRecallAtK(['a', 'b', 'c'], ['c'], 2), false);
    assert.equal(computeRecallAtK(['a', 'b', 'c'], ['c'], 3), true);
    assert.equal(reciprocalRank(['x', 'c', 'y'], ['c']), 0.5);
    assert.equal(reciprocalRank(['a', 'b'], ['c']), 0);
  });

  it('aggregates report with hit-source histogram', () => {
    const ks = [1, 3, 10, 30];
    const results: GsRItemResult[] = [
      evaluateItem({
        id: '1',
        rankedDocumentIds: ['a', 'b'],
        hitSources: ['full_document_by_title', 'paragraph_crop_by_title'],
        skipped: false,
        expectedDocumentIds: ['a'],
        ks,
      }),
      evaluateItem({
        id: '2',
        rankedDocumentIds: ['z'],
        hitSources: ['paragraph_crop_by_title'],
        skipped: false,
        expectedDocumentIds: ['a'],
        ks,
      }),
      evaluateItem({
        id: '3',
        rankedDocumentIds: [],
        hitSources: [],
        skipped: true,
        expectedDocumentIds: [],
        expectSkip: true,
        ks,
      }),
    ];

    const report = aggregateMetrics({
      datasetVersion: 'gs-r-v1',
      mode: 'offline-structured',
      results,
      ks,
      evaluatedAt: '2026-08-07T00:00:00.000Z',
    });

    assert.equal(report.scoredItemCount, 2);
    assert.equal(report.skipItemCount, 1);
    assert.equal(report.skipPassRate, 1);
    assert.equal(report.recallAtK[1], 0.5);
    assert.equal(report.recallAtK[30], 0.5);
    assert.ok(report.hitSourceDistribution.full_document_by_title === 1);
    assert.ok(report.hitSourceDistribution.paragraph_crop_by_title === 2);
    assert.equal(report.conclusion, 'FAIL');
  });
});
