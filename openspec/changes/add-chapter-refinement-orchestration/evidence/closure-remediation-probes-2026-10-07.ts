/** Independent closure re-audit AFTER remediation (C1/C2/C4/W6).
 * Assertions document the FIXED behavior — exit 0 means acceptance for these paths.
 * Defect-asserting originals kept in closure-verification-probes-2026-10-07.ts.
 * Run from services/api: node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/closure-remediation-probes-2026-10-07.ts
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
  const route = { tier: 'writing', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.3 };
  return { runId: 'audit', projectId: 'p', chapterNo: 1, creatorId: 'u', clientRequestId: 'audit', payloadHash: 'h', status: 'running', phase: 'reading', revision: 2, attemptId: 'a', pauseReason: null, resumable: false, baseUpdatedAt: '2026-10-07T00:00:00.000Z', baseHash: 'h', rewritePolicy: 'preserve-plot', snapshot: { instruction: '改善表达，保留事件', baseTitle: '样章', baseText: base, systemPromptText: '风格指导', templateVersions: [], modelRoute: route, modelRoutes: { writing: route, utility: { ...route, tier: 'utility' } }, resolvedPolicy: resolveRefinementPolicy({}), frozenAt: '2026-10-07T00:00:00.000Z' }, checkpoint: createInitialRefinementCheckpoint(base), tombstone: false, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z' };
}
const response = (text: string, ok = true) => ({ text, ok, aborted: false, traceId: 'audit' });

async function finalPath(mode: 'repair' | 'revert' | 'reverted-conflict') {
  let reviews = 0;
  const checkpoints: any[] = [];
  const result = await new OrchestratedRefinementEngine({ async generate(req: any) {
    const key = req.templateKey.split('.').at(-1);
    if (key === 'inspect') return response(inspect);
    if (key === 'plan') return response(plan);
    if (key === 'rewrite') return response(req.prompt.includes('甲推开门') ? first : second);
    if (key === 'repair') return mode === 'repair' ? response(repaired) : response('', false);
    if (key === 'review') {
      reviews++;
      if (reviews === 3) return response(issue('甲推门进屋'));
      if (mode === 'reverted-conflict' && reviews === 4) return response(issue('甲推开门，放下钥匙。'));
      return response(cleanReview);
    }
    throw new Error(key);
  } }).run({ record: record(), signal: new AbortController().signal, onStage() {}, onCheckpoint(cp) { checkpoints.push(structuredClone(cp)); } });
  return { result, reviews, checkpoints };
}

async function main() {
  const samples = [1, 2].map(n => ({ id: `sample-${n}`, sourceChapterNo: n, sceneType: 'dialogue' as const, text: `第${n}章的参照文字。`.repeat(10), createdAt: '2026-10-07', updatedAt: '2026-10-07' }));
  // C4：冻结材料按当前章排除当前章样本（chapterNo=1 → 只保留第 2 章样本）
  const frozen = ProjectsService.prototype.getFrozenReferenceMaterials.call({ getPersonas() { return []; }, getSettings() { return { writingStyleSamples: samples }; }, documentsService: { findAll() { return []; } } } as any, 'p', 'u', 1);
  assert.deepEqual(frozen.map(x => x.id), ['sample-2']);
  const intended = selectWritingStyleSamplesForTask({ samples, templateKey: 'chapter.refinement.rewrite', chapterNo: 1 });
  assert.deepEqual(frozen.map(x => x.id), intended.map(x => x.id));

  // W6：无末态锚点的入场状态（即使全文落在候选里）不得当作散场当前状态
  const entryInCandidate = verifyRefinementStateFact({ key: 'holding', value: '拿着钥匙', sourceBlockId: 'b0', anchorQuote: '甲拿着钥匙入场' }, { original: '甲拿着钥匙入场，散场时把钥匙留在桌上。', candidate: '甲拿着钥匙入场，散场时把钥匙留在桌上。' });
  assert.deepEqual(entryInCandidate, { status: 'historical' });
  // 带末态锚点且 value 落在锚点内 → 确认为候选证据
  const exitBound = verifyRefinementStateFact({ key: 'holding', value: '把钥匙留在桌上', sourceBlockId: 'b0', anchorQuote: '甲拿着钥匙入场', exitAnchorQuote: '散场时把钥匙留在桌上' }, { original: '甲拿着钥匙入场，散场时把钥匙留在桌上。', candidate: '甲拿着钥匙入场，散场时把钥匙留在桌上。' });
  assert.deepEqual(exitBound, { status: 'evidence', origin: 'candidate' });

  // C2：必要输出超过单次输出上限 → 明确拒绝，不再静默压低 maxTokens
  const clamped = resolveRefinementCallBudget({ promptChars: 1000, desiredOutputChars: 1, requiredOutputTokens: 9000, contextTokens: 64000, maxOutputTokens: 8192 });
  assert.equal(clamped.ok, false);
  assert.ok(clamped.reason?.includes('单次输出上限'));
  // C2：已知 provider 的未知 model 不得按 provider 级猜测值放行
  assert.equal(resolveRefinementModelCapability({ provider: 'deepseek', model: 'unknown-small-model' }), null);
  assert.ok(resolveRefinementModelCapability({ provider: 'deepseek', model: 'deepseek-chat' }));

  // C1：最终接缝修复成功后，修复稿进入终态且不被 checkpoint 写回
  const fix = await finalPath('repair');
  assert.equal(fix.result.status, 'ready');
  assert.ok(fix.result.checkpoint.acceptedDraftText.startsWith(repaired));
  assert.ok(fix.result.checkpoint.issues.some(x => x.disposition === 'resolved'));
  assert.equal(fix.checkpoints.at(-1)?.acceptedDraftText, fix.result.checkpoint.acceptedDraftText);

  // C1：最终修复失败回退后，旧候选不复活，changes / 落库候选与终态一致
  const revert = await finalPath('revert');
  assert.equal(revert.result.status, 'ready_with_issues');
  assert.ok(revert.result.checkpoint.acceptedDraftText.startsWith('甲推开门，放下钥匙。'));
  assert.ok(!revert.result.checkpoint.acceptedDraftText.includes(first));
  assert.equal(revert.result.checkpoint.changes.length, 1);
  assert.equal(revert.checkpoints.at(-1)?.acceptedDraftText, revert.result.checkpoint.acceptedDraftText);

  // C1：回退后只命中原文/旧候选、无法定位到单一活动候选的阻断 → 暂停，不降级为提示
  const conflict = await finalPath('reverted-conflict');
  assert.equal(conflict.result.status, 'paused');
  assert.equal(conflict.result.pauseReason, 'boundary_conflict');
  assert.ok(conflict.result.checkpoint.issues.some(x => x.anchorQuote === '甲推开门，放下钥匙。' && x.disposition === 'unresolved'));

  console.log(JSON.stringify({
    note: 'Fixed-behavior observations: exit 0 means acceptance for C1/C2/C4/W6 paths.',
    currentChapterSampleExcluded: { currentChapterNo: 1, frozenSampleIds: frozen.map(x => x.id) },
    entryFactWithoutExitAnchor: entryInCandidate,
    exitFactWithAnchor: exitBound,
    oversizedRequiredOutputRejected: clamped,
    unknownModelRejected: resolveRefinementModelCapability({ provider: 'deepseek', model: 'unknown-small-model' }),
    finalRepairKept: { status: fix.result.status, reviewCalls: fix.reviews, draftStartsWithRepair: fix.result.checkpoint.acceptedDraftText.startsWith(repaired), lastPersistedMatchesFinal: fix.checkpoints.at(-1)?.acceptedDraftText === fix.result.checkpoint.acceptedDraftText },
    revertConsistent: { status: revert.result.status, changes: revert.result.checkpoint.changes.length, oldCandidateGone: !revert.result.checkpoint.acceptedDraftText.includes(first) },
    unlocatableBlockingPauses: { status: conflict.result.status, pauseReason: conflict.result.pauseReason },
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
