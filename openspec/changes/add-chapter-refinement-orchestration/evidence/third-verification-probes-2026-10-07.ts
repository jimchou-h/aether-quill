/** Independent regression audit, fake gateway, neutral fixtures.
 * Defect assertions reproduce current behavior; exit 0 is NOT acceptance.
 * Run from services/api with node --import tsx and this path.
 */
import assert from 'node:assert/strict';
import { OrchestratedRefinementEngine } from '../../../../services/api/src/modules/projects/chapter-refinement.engine';
import { createInitialRefinementCheckpoint, resolveRefinementPolicy } from '../../../../services/api/src/modules/projects/chapter-refinement.types';
import { verifyRefinementStateFact } from '../../../../services/api/src/modules/projects/chapter-refinement.util';
const base = '甲推开门，放下钥匙。';
const candidate = '甲推门进屋，将钥匙放下。';
const repaired = '甲推门进屋，郑重地将钥匙放下。';
const inspect = JSON.stringify({ windowId: 'w0', sceneFragments: [{ startBlockId: 'b0', endBlockId: 'b0', startsNewScene: true, confidence: 'high', goal: '保持事件', entryFacts: [], exitFacts: [], proposedBeatEnds: [] }], issues: [] });
const plan = JSON.stringify({ chapterIntent: '改善表达', protectedFacts: [], sceneBriefs: [{ sceneId: 'scene-1', sourceBlockIds: ['b0'], decision: 'rewrite', reason: '改善表达', editIntent: '改善表达', expectedChange: '改善表达', entryFacts: [], exitFacts: [], protectedSpanIds: [], targetLength: { direction: 'hold' }, checks: [] }] });
const clean = JSON.stringify({ issues: [], exitStateFacts: [] });
const blocking = JSON.stringify({ issues: [{ kind: 'hard_constraint', severity: 'high', anchorQuote: '甲推门进屋', expectedFact: '前后状态一致', sourceEvidence: base, fixIntent: '修复接缝状态冲突' }], exitStateFacts: [] });
const resp = (text: string) => ({ ok: true, text, traceId: 'third-audit', aborted: false });
function record(text = base): any {
 const route = { tier: 'writing', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.3 };
 return { runId: 'third-audit', projectId: 'p', chapterNo: 1, creatorId: 'u', clientRequestId: 'third-audit', payloadHash: 'h', status: 'running', phase: 'reading', revision: 2, attemptId: 'a', pauseReason: null, resumable: false, baseUpdatedAt: '2026-10-07T00:00:00.000Z', baseHash: 'h', rewritePolicy: 'preserve-plot', snapshot: { instruction: '改善表达，保留事件', baseTitle: '样章', baseText: text, systemPromptText: '', templateVersions: [], modelRoutes: { writing: route, utility: { ...route, tier: 'utility' } }, resolvedPolicy: resolveRefinementPolicy({}), frozenAt: '2026-10-07T00:00:00.000Z' }, checkpoint: createInitialRefinementCheckpoint(text), tombstone: false, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z' };
}
async function main() {
 const normal = record('甲安静地走进屋里，将钥匙放在桌上。'.repeat(250).slice(0, 3500));
 const calls: string[] = [];
 const sizeResult = await new OrchestratedRefinementEngine({ async generate(req: any) {
  const key = req.templateKey.split('.').at(-1); calls.push(key);
  if (key === 'inspect') return resp(inspect);
  if (key === 'plan') return resp(plan);
  if (key === 'rewrite') return resp(normal.snapshot.baseText);
  return resp(clean);
 } }).run({ record: normal, signal: new AbortController().signal, onStage() {}, onCheckpoint() {} });
 assert.equal(sizeResult.status, 'ready_with_issues');
 assert.ok(sizeResult.checkpoint.issues.some(x => x.message.includes('8750') && x.message.includes('8192')));
 assert.ok(!calls.includes('rewrite'));
 assert.equal(sizeResult.checkpoint.acceptedDraftText, normal.snapshot.baseText);

 let reviews = 0;
 let repairReturned = false;
 let storageFaults = 0;
 const storageResult = await new OrchestratedRefinementEngine({ async generate(req: any) {
  const key = req.templateKey.split('.').at(-1);
  if (key === 'inspect') return resp(inspect);
  if (key === 'plan') return resp(plan);
  if (key === 'rewrite') return resp(candidate);
  if (key === 'review') return resp(++reviews === 2 ? blocking : clean);
  if (key === 'repair') { repairReturned = true; return resp(repaired); }
  throw new Error(key);
 } }).run({ record: record(), signal: new AbortController().signal, onStage() {}, onCheckpoint() {
  if (repairReturned) { storageFaults++; throw new Error('injected checkpoint persistence failure'); }
 } });
 assert.equal(storageFaults, 1);
 assert.equal(reviews, 2);
 assert.equal(storageResult.status, 'ready_with_issues');
 assert.equal(storageResult.checkpoint.acceptedDraftText, base);

 let firstReviews = 0;
 const first = await new OrchestratedRefinementEngine({ async generate(req: any) {
  const key = req.templateKey.split('.').at(-1);
  if (key === 'inspect') return resp(inspect);
  if (key === 'plan') return resp(plan);
  if (key === 'rewrite') return resp(candidate);
  if (key === 'review') return resp(++firstReviews === 1 ? clean : blocking.replace('甲推门进屋', '不在正文中的引文'));
  throw new Error(key);
 } }).run({ record: record(), signal: new AbortController().signal, onStage() {}, onCheckpoint() {} });
 assert.equal(first.status, 'paused');
 const resumedRecord = record(); resumedRecord.checkpoint = first.checkpoint;
 let resumedCalls = 0;
 const resumed = await new OrchestratedRefinementEngine({ async generate() { resumedCalls++; return resp(clean); } }).run({ record: resumedRecord, signal: new AbortController().signal, onStage() {}, onCheckpoint() {} });
 assert.equal(resumed.status, 'ready_with_issues');
 assert.ok(resumed.checkpoint.issues.some(issue => issue.disposition === 'unresolved'));

 const stillHistorical = verifyRefinementStateFact({ key: 'holding', value: '拿着钥匙', sourceBlockId: 'b0', anchorQuote: '甲拿着钥匙入场', exitAnchorQuote: '甲拿着钥匙入场' }, { original: '甲拿着钥匙入场，散场时把钥匙留在桌上。', candidate: '甲拿着钥匙入场，散场时把钥匙留在桌上。' });
 assert.deepEqual(stillHistorical, { status: 'evidence', origin: 'candidate' });
 console.log(JSON.stringify({
  note: 'Defect observations; exit 0 means reproduced, not accepted.',
  ordinary3500CharRangeBlocked: { sourceChars: normal.snapshot.baseText.length, rewriteTargetChars: normal.snapshot.resolvedPolicy.rewriteTargetChars, status: sizeResult.status, calls, unchangedDraft: sizeResult.checkpoint.acceptedDraftText === normal.snapshot.baseText, issues: sizeResult.checkpoint.issues },
  persistenceFailureDuringFinalRepairReviewSwallowed: { storageFaults, reviewCalls: reviews, status: storageResult.status, pauseReason: storageResult.pauseReason ?? null, acceptedDraft: storageResult.checkpoint.acceptedDraftText },
  unresolvedIssueSurvivesIntoApplicableResume: { firstStatus: first.status, resumedStatus: resumed.status, resumedCalls, unresolved: resumed.checkpoint.issues.filter(issue => issue.disposition === 'unresolved') },
  falselyLabelledExitAnchorAccepted: stillHistorical,
 }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
