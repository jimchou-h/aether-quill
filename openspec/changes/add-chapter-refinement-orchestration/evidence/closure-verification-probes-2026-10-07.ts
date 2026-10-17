/** Independent closure audit. Neutral text, fake gateway, no model/network.
 * Assertions document observed defects, NOT acceptance success.
 * Run from services/api: node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/closure-verification-probes-2026-10-07.ts
 */
import assert from 'node:assert/strict';
import { OrchestratedRefinementEngine } from '../../../../services/api/src/modules/projects/chapter-refinement.engine';
import { createInitialRefinementCheckpoint, resolveRefinementPolicy } from '../../../../services/api/src/modules/projects/chapter-refinement.types';
import { resolveRefinementCallBudget, resolveRefinementModelCapability, verifyRefinementStateFact } from '../../../../services/api/src/modules/projects/chapter-refinement.util';
import { ProjectsService } from '../../../../services/api/src/modules/projects/projects.service';
import { selectWritingStyleSamplesForTask } from '../../../../packages/config/src/writing-style-samples';

const base = '甲推开门，放下钥匙。\n\n乙走进院子，关好门。';
const first = '甲推门进屋，将钥匙放下。';
const second = '乙来到院中，将门关好。';
const repaired = '甲推门进屋，郑重地将钥匙放下。';
const inspect = JSON.stringify({ windowId: 'w0', sceneFragments: [0, 1].map(i => ({ startBlockId: `b${i}`, endBlockId: `b${i}`, startsNewScene: true, confidence: 'high', goal: '保持事件', entryFacts: [], exitFacts: [], proposedBeatEnds: [] })), issues: [] });
const plan = JSON.stringify({ chapterIntent: '改善表达', protectedFacts: [], sceneBriefs: [0, 1].map(i => ({ sceneId: `s${i + 1}`, sourceBlockIds: [`b${i}`], decision: 'rewrite', reason: '改善表达', editIntent: '改善表达', expectedChange: '改善表达', entryFacts: [], exitFacts: [], protectedSpanIds: [], targetLength: { direction: 'hold' }, checks: [] })) });
const cleanReview = JSON.stringify({ issues: [], exitStateFacts: [] });
const issue = (quote: string) => JSON.stringify({ issues: [{ kind: 'hard_constraint', severity: 'high', anchorQuote: quote, expectedFact: '前后接缝状态一致', sourceEvidence: '原文状态', fixIntent: '修复接缝状态冲突' }], exitStateFacts: [] });
function record(): any {
  const route = { tier: 'writing', provider: 'deepseek', model: 'frozen-model', temperature: 0.3 };
  return { runId: 'audit', projectId: 'p', chapterNo: 1, creatorId: 'u', clientRequestId: 'audit', payloadHash: 'h', status: 'running', phase: 'reading', revision: 2, attemptId: 'a', pauseReason: null, resumable: false, baseUpdatedAt: '2026-10-07T00:00:00.000Z', baseHash: 'h', rewritePolicy: 'preserve-plot', snapshot: { instruction: '改善表达，保留事件', baseTitle: '样章', baseText: base, systemPromptText: '风格指导', templateVersions: [], modelRoute: route, modelRoutes: { writing: route, utility: { ...route, tier: 'utility' } }, resolvedPolicy: resolveRefinementPolicy({}), frozenAt: '2026-10-07T00:00:00.000Z' }, checkpoint: createInitialRefinementCheckpoint(base), tombstone: false, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z' };
}
const response = (text: string, ok = true) => ({ text, ok, aborted: false, traceId: 'audit' });

async function finalPath(mode: 'repair' | 'revert' | 'reverted-conflict') {
  let reviews = 0;
  const checkpoints: any[] = [];
  const reviewPrompts: string[] = [];
  const result = await new OrchestratedRefinementEngine({ async generate(req: any) {
    const key = req.templateKey.split('.').at(-1);
    if (key === 'inspect') return response(inspect);
    if (key === 'plan') return response(plan);
    if (key === 'rewrite') return response(req.prompt.includes('甲推开门') ? first : second);
    if (key === 'repair') return mode === 'repair' ? response(repaired) : response('', false);
    if (key === 'review') {
      reviews++;
      reviewPrompts.push(req.prompt);
      if (reviews === 3) return response(issue('甲推门进屋'));
      if (mode === 'reverted-conflict' && reviews === 4) return response(issue('甲推开门，放下钥匙。'));
      return response(cleanReview);
    }
    throw new Error(key);
  } }).run({ record: record(), signal: new AbortController().signal, onStage() {}, onCheckpoint(cp) { checkpoints.push(structuredClone(cp)); } });
  return { result, reviews, checkpoints, reviewPrompts };
}

async function main() {
  const samples = [1, 2].map(n => ({ id: `sample-${n}`, sourceChapterNo: n, sceneType: 'dialogue' as const, text: `第${n}章的参照文字。`.repeat(10), createdAt: '2026-10-07', updatedAt: '2026-10-07' }));
  // Real material-selection method; no service constructor or business storage.
  const frozen = ProjectsService.prototype.getFrozenReferenceMaterials.call({ getPersonas() { return []; }, getSettings() { return { writingStyleSamples: samples }; }, documentsService: { findAll() { return []; } } } as any, 'p', 'u');
  assert.deepEqual(frozen.map(x => x.id), ['sample-1', 'sample-2']);
  const intended = selectWritingStyleSamplesForTask({ samples, templateKey: 'chapter.refinement.rewrite', chapterNo: 1 });
  assert.deepEqual(intended.map(x => x.id), ['sample-2']);
  const historicalInCandidate = verifyRefinementStateFact({ key: 'holding', value: '拿着钥匙', sourceBlockId: 'b0', anchorQuote: '甲拿着钥匙入场' }, { original: '甲拿着钥匙入场，散场时把钥匙留在桌上。', candidate: '甲拿着钥匙入场，散场时把钥匙留在桌上。' });
  assert.deepEqual(historicalInCandidate, { status: 'evidence', origin: 'candidate' });
  const budget = resolveRefinementCallBudget({ promptChars: 1000, desiredOutputChars: 1, requiredOutputTokens: 9000, contextTokens: 64000, maxOutputTokens: 8192 });
  assert.deepEqual(budget, { ok: true, maxTokens: 8192 });
  const unknownModel = resolveRefinementModelCapability({ provider: 'deepseek', model: 'unknown-small-model' });
  assert.deepEqual(unknownModel, { contextTokens: 64000, maxOutputTokens: 8192 });
  const fix = await finalPath('repair');
  assert.equal(fix.result.status, 'ready');
  assert.ok(fix.result.checkpoint.acceptedDraftText.startsWith(first));
  assert.ok(!fix.result.checkpoint.acceptedDraftText.includes(repaired));
  assert.ok(fix.result.checkpoint.issues.some(x => x.disposition === 'resolved'));
  const revert = await finalPath('revert');
  assert.equal(revert.result.status, 'ready_with_issues');
  assert.ok(revert.result.checkpoint.acceptedDraftText.startsWith(first));
  assert.equal(revert.result.checkpoint.changes.length, 1);
  const conflict = await finalPath('reverted-conflict');
  assert.equal(conflict.result.status, 'ready_with_issues');
  assert.ok(conflict.result.checkpoint.issues.some(x => x.anchorQuote === '甲推开门，放下钥匙。' && x.severity === 'high' && x.disposition === 'warning'));
  console.log(JSON.stringify({
    note: 'Defect observations: exit 0 is reproduction success, not acceptance success.',
    necessaryOutputSilentlyClamped: { requiredOutputTokens: 9000, budget },
    unknownModelAdmitted: unknownModel,
    currentChapterSampleNotExcluded: { currentChapterNo: 1, frozenSampleIds: frozen.map(x => x.id), expectedSampleIds: intended.map(x => x.id) },
    entryFactInsideCandidateStillAcceptedAsExit: historicalInCandidate,
    acceptedFinalRepairLost: { status: fix.result.status, reviewCalls: fix.reviews, actualDraft: fix.result.checkpoint.acceptedDraftText, repairWasMarkedResolved: true, repairedDraftReturned: false },
    revertedRangeResurrected: { status: revert.result.status, reviewCalls: revert.reviews, actualDraft: revert.result.checkpoint.acceptedDraftText, changes: revert.result.checkpoint.changes, retainedOriginalChars: revert.result.checkpoint.coverage.retainedOriginalChars },
    revertedOriginalConflictDowngraded: { status: conflict.result.status, reviewCalls: conflict.reviews, issues: conflict.result.checkpoint.issues },
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
