/** Independent B4 asset audit. Real engine + gateway + delivered local fake orchestrator.
 * No browser account, author project, persistence writes or real model calls.
 * exit 0 confirms the observed test-contract gaps; it is NOT B4 acceptance.
 * Run from services/api with node --import tsx and this file's relative path.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { OrchestratedRefinementEngine } from '../../../../services/api/src/modules/projects/chapter-refinement.engine';
import { OrchestratorRefinementGateway } from '../../../../services/api/src/modules/projects/chapter-refinement.gateway';
import { createInitialRefinementCheckpoint, resolveRefinementPolicy } from '../../../../services/api/src/modules/projects/chapter-refinement.types';
import { buildRefinementSourceBlocks } from '../../../../services/api/src/modules/projects/chapter-refinement.util';
import { NEUTRAL_CHAPTER_CONTENT, discardRefinementRuns } from '../../../../apps/web/e2e/support/refinement-fixture';

async function main() {
  const repo = path.resolve(process.cwd(), '../..');
  const reserve = http.createServer();
  await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'apps/web/e2e/support/fake-orchestrator.mjs'), '--port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let childOutput = '';
  child.stdout.on('data', chunk => { childOutput += chunk; });
  child.stderr.on('data', chunk => { childOutput += chunk; });
  try {
    let ready = false;
    for (let n = 0; n < 80; n++) {
      if (child.exitCode !== null) throw new Error(childOutput);
      try { ready = (await fetch(`${url}/__calls`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* isolated startup only */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);
    const base = NEUTRAL_CHAPTER_CONTENT;
    const route = { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.3 };
    const record: any = { runId: 'b4-asset-audit', projectId: 'neutral-audit', chapterNo: 1, creatorId: 'u', clientRequestId: 'c', payloadHash: 'h', status: 'running', phase: 'reading', revision: 2, attemptId: 'a', pauseReason: null, resumable: false, baseUpdatedAt: '2026-10-07T00:00:00.000Z', baseHash: 'h', rewritePolicy: 'preserve-plot', snapshot: { instruction: '收紧节奏，保持剧情与人物状态不变。', baseTitle: '自动化中性样章', baseText: base, systemPromptText: '', templateVersions: [], modelRoutes: { writing: { ...route, tier: 'writing' }, utility: { ...route, tier: 'utility' } }, resolvedPolicy: resolveRefinementPolicy({}), frozenAt: '2026-10-07T00:00:00.000Z' }, checkpoint: createInitialRefinementCheckpoint(base), tombstone: false, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z' };
    await fetch(`${url}/__control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ script: { rewrite: ['（脚本改写一）', '（脚本改写二）'] }, hangAfterNth: { 'chapter.refinement.rewrite': 1 } }) });
    const result = await new OrchestratedRefinementEngine(new OrchestratorRefinementGateway(() => url)).run({ record, signal: AbortSignal.timeout(15000), onStage() {}, onCheckpoint() {} });
    const callLog = await (await fetch(`${url}/__calls`)).json() as { calls: Array<{ templateKey: string }> };
    const rewrites = callLog.calls.filter(call => call.templateKey === 'chapter.refinement.rewrite').length;
    const actualApplyPath = '/api/projects/neutral-audit/knowledge/chapters/1/optimize/apply';
    let cleanupPosts = 0;
    const cleanupFixture: any = { projectId: 'neutral-audit', chapterNo: 1, token: 'fake-only', api: {
      async get() { return { ok: () => true, async json() { return { code: 0, data: [{ runId: 'old-run', revision: 7 }] }; } }; },
      async post() { cleanupPosts++; return { ok: () => false, status: () => 400 }; },
    } };
    await discardRefinementRuns(cleanupFixture);
    const cleanupArrayPosts = cleanupPosts;
    let postedOptions: unknown;
    cleanupFixture.api.get = async () => ({ ok: () => true, async json() { return { code: 0, data: { runs: [{ runId: 'old-run', revision: 7 }] } }; } });
    cleanupFixture.api.post = async (_url: string, options: unknown) => { postedOptions = options; return { ok: () => false, status: () => 400 }; };
    await discardRefinementRuns(cleanupFixture);
    const observation = {
      sourceBlocks: buildRefinementSourceBlocks(base).map(block => ({ id: block.id, text: block.text })),
      deliveredFakeScenarioTwo: { phaseCalls: callLog.calls.map(call => call.templateKey), rewriteCount: rewrites, terminalStatus: result.status, coverage: result.checkpoint.coverage, issues: result.checkpoint.issues, draft: result.checkpoint.acceptedDraftText },
      applyCaptureContract: { actualApplyPath, specInterceptorPattern: '/optimize/refinement/runs/[^/]+/apply$', matches: /\/optimize\/refinement\/runs\/[^/]+\/apply$/.test(actualApplyPath), skipsEqualityWhenUncaptured: true },
      fixtureCleanupContract: { actualListDataShape: 'RefinementRunSummary[]', discardPostsWithActualShape: cleanupArrayPosts, discardHasBodyWhenGivenSyntheticRunsObject: postedOptions !== undefined, returnedNormallyDespiteHttp400: true },
    };
    assert.equal(rewrites, 1, 'only b0 is planned for rewriting; second rewrite cannot happen');
    assert.equal(result.status, 'ready_with_issues');
    assert.equal(observation.applyCaptureContract.matches, false);
    assert.equal(cleanupArrayPosts, 0, 'actual array response is silently treated as no runs');
    assert.equal(postedOptions, undefined, 'discard request omits expectedRunRevision body');
    writeFileSync(path.join(repo, 'openspec/changes/add-chapter-refinement-orchestration/evidence/browser-contract-audit-observations-2026-10-07.json'), JSON.stringify(observation, null, 2) + '\n');
    console.log(JSON.stringify(observation, null, 2));
  } finally {
    child.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
