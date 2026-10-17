/** Independent regression audit, fake gateway, neutral fixtures.
 * Positive assertions verify D1/D2/D3 and (since B1) the E1 closure. W6 remains an observation.
 * Run from services/api with node --import tsx and this path.
 */
import assert from 'node:assert/strict';
import { OrchestratedRefinementEngine } from '../../../../services/api/src/modules/projects/chapter-refinement.engine';
import { createInitialRefinementCheckpoint, resolveRefinementPolicy } from '../../../../services/api/src/modules/projects/chapter-refinement.types';
import { verifyRefinementStateFact, buildRefinementSourceBlocks, planRefinementDiagnosisWindows } from '../../../../services/api/src/modules/projects/chapter-refinement.util';
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
  if (key === 'rewrite') return resp(normal.snapshot.baseText.replaceAll('安静地走进屋里', '轻步走入屋中'));
  return resp(clean);
 } }).run({ record: normal, signal: new AbortController().signal, onStage() {}, onCheckpoint() {} });
 assert.equal(sizeResult.status, 'ready');
 assert.equal(sizeResult.checkpoint.issues.length, 0);
 assert.equal(calls.filter(x => x === 'rewrite').length, 1);
 assert.notEqual(sizeResult.checkpoint.acceptedDraftText, normal.snapshot.baseText);

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
 assert.equal(storageResult.status, 'paused'); assert.equal(storageResult.pauseReason, 'persistence_failed');
 assert.equal(storageResult.checkpoint.acceptedDraftText, candidate);

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
 assert.equal(resumed.status, 'paused'); assert.equal(resumed.pauseReason, 'boundary_conflict');
 assert.ok(resumed.checkpoint.issues.some(issue => issue.disposition === 'unresolved'));

 // A chapter-level retained-original notice has no unitId (e.g. unsplittable scene).
 // It must not exempt a separate, chapter-level unresolved hard conflict.
 const mixedBase = base + '\n\n' + '乙静候门外。'.repeat(1000);
 const mixedInitialRecord = record(mixedBase);
 const mixedBlocks = buildRefinementSourceBlocks(mixedBase);
 const mixedWindows = planRefinementDiagnosisWindows({ baseText: mixedBase, blocks: mixedBlocks, targetChars: 3000 });
 const mixedPlan = JSON.parse(plan);
 mixedPlan.sceneBriefs.push({ ...mixedPlan.sceneBriefs[0], sceneId: 'scene-2', sourceBlockIds: ['b1'] });
 let mixedReviews = 0;
 const mixedFirst = await new OrchestratedRefinementEngine({ async generate(req: any) {
  const key = req.templateKey.split('.').at(-1);
  if (key === 'inspect') {
   const windowId = req.prompt.match(/<diagnosis-window id="([^"]+)"/)?.[1];
   const window = mixedWindows.find(x => x.id === windowId)!;
   return resp(JSON.stringify({ windowId, sceneFragments: [0, 1].filter(i => i >= window.startBlockIndex && i < window.endBlockIndex).map(i => ({ startBlockId: `b${i}`, endBlockId: `b${i}`, startsNewScene: true, confidence: 'high', goal: '保持事件', entryFacts: [], exitFacts: [], proposedBeatEnds: [] })), issues: [] }));
  }
  if (key === 'plan') return resp(JSON.stringify(mixedPlan));
  if (key === 'rewrite') return resp(candidate);
  if (key === 'review') return resp(++mixedReviews === 1 ? clean : blocking.replace('甲推门进屋', '不在正文中的引文'));
  throw new Error(key);
 } }).run({ record: mixedInitialRecord, signal: new AbortController().signal, onStage() {}, onCheckpoint() {} });
 assert.equal(mixedFirst.status, 'paused');
 assert.ok(mixedFirst.checkpoint.issues.some(x => x.disposition === 'retained_original' && x.unitId === undefined));
 const mixedRecord = record(mixedBase); mixedRecord.checkpoint = mixedFirst.checkpoint;
 const mixed = await new OrchestratedRefinementEngine({ async generate() { return resp(clean); } }).run({ record: mixedRecord, signal: new AbortController().signal, onStage() {}, onCheckpoint() {} });
 // B1 关闭后的正确行为：无 unitId 的全章保留提示不得豁免无 unitId 的全章阻断。
 // 续跑即使本轮 review 全清，旧阻断仍 unresolved → 必须暂停，不可应用。
 assert.equal(mixed.status, 'paused');
 assert.equal(mixed.pauseReason, 'boundary_conflict');
 assert.ok(mixed.checkpoint.issues.some(x => x.disposition === 'unresolved' && x.severity === 'high'));

 const stillHistorical = verifyRefinementStateFact({ key: 'holding', value: '拿着钥匙', sourceBlockId: 'b0', anchorQuote: '甲拿着钥匙入场', exitAnchorQuote: '甲拿着钥匙入场' }, { original: '甲拿着钥匙入场，散场时把钥匙留在桌上。', candidate: '甲拿着钥匙入场，散场时把钥匙留在桌上。' });
 // B2 关闭后的正确行为：入场片段改名为 exitAnchorQuote 仍不得被认作确定末态。
 // 候选后面明确改变同一状态 → 程序按「之后仍有后续相关变化」判 superseded，不传播。
 assert.equal(stillHistorical.status, 'superseded');
 // 同一状态在范围末尾的最后一次变化才可作为末态证据
 const lastChange = verifyRefinementStateFact({ key: 'holding', value: '钥匙留在桌上', sourceBlockId: 'b0', anchorQuote: '甲拿着钥匙入场', exitAnchorQuote: '散场时把钥匙留在桌上' }, { original: '甲拿着钥匙入场，散场时把钥匙留在桌上。', candidate: '甲拿着钥匙入场，散场时把钥匙留在桌上。' });
 assert.equal(lastChange.status, 'evidence');
 console.log(JSON.stringify({
  note: 'Positive observations for original D1/D2/D3; E1 closed in B1, W6 closed in B2.',
  ordinary3500CharRangeRewritten: { sourceChars: normal.snapshot.baseText.length, rewriteTargetChars: normal.snapshot.resolvedPolicy.rewriteTargetChars, status: sizeResult.status, calls, unchangedDraft: sizeResult.checkpoint.acceptedDraftText === normal.snapshot.baseText, issues: sizeResult.checkpoint.issues },
  persistenceFailureDuringFinalRepairReviewPauses: { storageFaults, reviewCalls: reviews, status: storageResult.status, pauseReason: storageResult.pauseReason ?? null, acceptedDraft: storageResult.checkpoint.acceptedDraftText },
  unresolvedIssueBlocksResume: { firstStatus: first.status, resumedStatus: resumed.status, resumedCalls, unresolved: resumed.checkpoint.issues.filter(issue => issue.disposition === 'unresolved') },
  chapterLevelUnresolvedStillBlocksApplyAfterB1: { note: 'E1 closed in B1; positive assertion.', status: mixed.status, pauseReason: mixed.pauseReason ?? null, unresolved: mixed.checkpoint.issues.filter(issue => issue.disposition === 'unresolved') },
  falselyLabelledExitAnchorRejectedAfterB2: { entryAnchorFilledAsExit: stillHistorical.status, lastRelevantChangeAccepted: lastChange.status },
 }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
