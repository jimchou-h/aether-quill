/** Independent re-audit AFTER fourth-round remediation (D1 正常范围预算 / D2 最终复检保存失败 / D3 unresolved 阻断).
 * Assertions document the FIXED behavior — exit 0 means acceptance for these paths.
 * Run from services/api: node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/final-acceptance-probes-2026-10-07.ts
 */
import assert from 'node:assert/strict';
import { OrchestratedRefinementEngine } from '../../../../services/api/src/modules/projects/chapter-refinement.engine';
import { createInitialRefinementCheckpoint, resolveRefinementPolicy } from '../../../../services/api/src/modules/projects/chapter-refinement.types';
import { resolveRefinementCallBudget, resolveRefinementRewriteMaxTokens } from '../../../../services/api/src/modules/projects/chapter-refinement.util';

const base = '甲推开门，放下钥匙。\n\n乙走进院子，关好门。';
const rewriteText = '甲推门进屋，将钥匙放下。\n\n乙来到院中，将门关好。';
const blocking = JSON.stringify({ issues: [{ kind: 'hard_constraint', severity: 'high', anchorQuote: '甲推门进屋', expectedFact: '接缝一致', sourceEvidence: '原文', fixIntent: '修复接缝' }], exitStateFacts: [] });
const cleanReview = JSON.stringify({ issues: [], exitStateFacts: [] });
const inspect = JSON.stringify({ windowId: 'w0', sceneFragments: [0, 1].map(i => ({ startBlockId: `b${i}`, endBlockId: `b${i}`, startsNewScene: true, confidence: 'high', goal: '保持事件', entryFacts: [], exitFacts: [], proposedBeatEnds: [] })), issues: [] });
const plan = JSON.stringify({ chapterIntent: '改善表达', protectedFacts: [], sceneBriefs: [0, 1].map(i => ({ sceneId: `s${i + 1}`, sourceBlockIds: [`b${i}`], decision: 'rewrite', reason: '改善表达', editIntent: '改善表达', expectedChange: '改善表达', entryFacts: [], exitFacts: [], protectedSpanIds: [], targetLength: { direction: 'hold' }, checks: [] })) });
function record(text: string): any {
  const route = { tier: 'writing', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.3 };
  return { runId: 'audit', projectId: 'p', chapterNo: 1, creatorId: 'u', clientRequestId: 'audit', payloadHash: 'h', status: 'running', phase: 'reading', revision: 2, attemptId: 'a', pauseReason: null, resumable: false, baseUpdatedAt: '2026-10-07T00:00:00.000Z', baseHash: 'h', rewritePolicy: 'preserve-plot', snapshot: { instruction: '改善表达', baseTitle: '样章', baseText: text, systemPromptText: '风格指导', templateVersions: [], modelRoute: route, modelRoutes: { writing: route, utility: { ...route, tier: 'utility' } }, resolvedPolicy: resolveRefinementPolicy({}), frozenAt: '2026-10-07T00:00:00.000Z' }, checkpoint: createInitialRefinementCheckpoint(text), tombstone: false, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z' };
}
const response = (text: string, ok = true) => ({ text, ok, aborted: false, traceId: 'audit' });

async function main() {
  // D1：正常 3500 字范围的必要输出估算必须装得进已登记模型的单次输出上限
  const required3500 = resolveRefinementRewriteMaxTokens(3500);
  assert.ok(required3500 <= 8192, `3500 字范围必要输出 ${required3500} 不应超过 8192`);
  const budget3500 = resolveRefinementCallBudget({ promptChars: 20000, desiredOutputChars: 3500, contextTokens: 64000, maxOutputTokens: 8192 });
  assert.equal(budget3500.ok, true);

  // D1 端到端：3500+ 字单块范围实际完成改写
  const paragraph = '夜幕低垂，城中灯火次第亮起，长街尽头传来更鼓声声。'.repeat(47);
  const bigBase = [paragraph, paragraph].join('\n\n');
  const bigInspect = JSON.stringify({ windowId: 'w0', sceneFragments: [{ startBlockId: 'b0', endBlockId: 'b1', startsNewScene: true, confidence: 'high', goal: '保持事件', entryFacts: [], exitFacts: [], proposedBeatEnds: [] }], issues: [] });
  const bigPlan = JSON.stringify({ chapterIntent: '改善表达', protectedFacts: [], sceneBriefs: [{ sceneId: 's1', sourceBlockIds: ['b0', 'b1'], decision: 'rewrite', reason: '改善表达', editIntent: '改善表达', expectedChange: '改善表达', entryFacts: [], exitFacts: [], protectedSpanIds: [], targetLength: { direction: 'hold' }, checks: [] }] });
  let rewriteCalls = 0;
  const big = await new OrchestratedRefinementEngine({ async generate(req: any) {
    const key = req.templateKey.split('.').at(-1);
    if (key === 'inspect') return response(bigInspect);
    if (key === 'plan') return response(bigPlan);
    if (key === 'rewrite') { rewriteCalls++; return response('夜幕降临，灯火亮起。他推门而入，屋内寂静无声。'); }
    if (key === 'review') return response(cleanReview);
    throw new Error(key);
  } }).run({ record: record(bigBase), signal: new AbortController().signal, onStage() {} });
  assert.equal(big.status, 'ready');
  assert.equal(rewriteCalls, 1);

  // D2：整章最终接缝修复后复检的保存失败 → 暂停 persistence_failed
  let reviews = 0;
  let preCallCommits = 0;
  const d2 = await new OrchestratedRefinementEngine({ async generate(req: any) {
    const key = req.templateKey.split('.').at(-1);
    if (key === 'inspect') return response(inspect);
    if (key === 'plan') return response(plan);
    if (key === 'rewrite') return response(rewriteText);
    if (key === 'repair') return response('甲推门进屋，郑重地将钥匙放下。');
    if (key === 'review') { reviews++; return response(reviews === 1 || reviews === 3 ? blocking : cleanReview); }
    throw new Error(key);
  } }).run({ record: record(base), signal: new AbortController().signal, onStage() {}, onCheckpoint(cp: any) {
    if (cp.progress.message.startsWith('调用前保存进度')) { preCallCommits++; if (preCallCommits === 8) throw new Error('storage unavailable'); }
  } });
  assert.equal(d2.status, 'paused');
  assert.equal(d2.pauseReason, 'persistence_failed');

  // D3：仍生效候选携带未解决阻断 → 暂停，不得可应用
  let d3Reviews = 0;
  const d3 = await new OrchestratedRefinementEngine({ async generate(req: any) {
    const key = req.templateKey.split('.').at(-1);
    if (key === 'inspect') return response(inspect);
    if (key === 'plan') return response(plan);
    if (key === 'rewrite') return response(rewriteText);
    if (key === 'repair') return { text: '', ok: false, aborted: false, traceId: 'audit', errorMessage: 'upstream timeout' };
    if (key === 'review') { d3Reviews++; return response(d3Reviews === 1 ? blocking : cleanReview); }
    throw new Error(key);
  } }).run({ record: record(base), signal: new AbortController().signal, onStage() {} });
  assert.equal(d3.status, 'paused');
  assert.equal(d3.pauseReason, 'boundary_conflict');
  assert.ok(d3.checkpoint.issues.some((x: any) => x.disposition === 'unresolved' && x.severity === 'high'));

  console.log(JSON.stringify({
    note: 'Fixed-behavior observations: exit 0 means acceptance for D1/D2/D3.',
    normalRangeBudget: { requiredOutputTokensFor3500Chars: required3500, budgetOk: budget3500.ok },
    normalRangeRewriteEndToEnd: { status: big.status, rewriteCalls },
    finalRecheckStorageFailurePauses: { status: d2.status, pauseReason: d2.pauseReason },
    liveCandidateWithUnresolvedBlockingPauses: { status: d3.status, pauseReason: d3.pauseReason },
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
