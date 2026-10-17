/** Independent neutral probes: real gateway -> real orchestrator HTTP -> local fake provider.
 * Run from services/api with node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/batch-acceptance-probes-2026-10-07.ts
 * No real provider, credentials, author project or chapter is used.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OrchestratorRefinementGateway } from '../../../../services/api/src/modules/projects/chapter-refinement.gateway';
import { verifyRefinementStateFact } from '../../../../services/api/src/modules/projects/chapter-refinement.util';
import { OrchestratedRefinementEngine } from '../../../../services/api/src/modules/projects/chapter-refinement.engine';
import { createInitialRefinementCheckpoint, resolveRefinementPolicy } from '../../../../services/api/src/modules/projects/chapter-refinement.types';

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}
async function main() {
  const repo = path.resolve(process.cwd(), '../..');
  const captures: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const provider = http.createServer((req, res) => {
    let text = '';
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      captures.push(JSON.parse(text));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'NEUTRAL_RESULT' }, finish_reason: null }] }) + '\n\n');
      res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  const providerPort = await listen(provider);
  const reserve = http.createServer();
  const orchestratorPort = await listen(reserve);
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const cwd = mkdtempSync(path.join(tmpdir(), 'aether-neutral-acceptance-'));
  const orchestratorRoot = path.join(repo, 'services/rag-orchestrator');
  const requireOrchestrator = createRequire(path.join(orchestratorRoot, 'package.json'));
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, {
    NODE_ENV: 'test', RAG_ORCHESTRATOR_PORT: String(orchestratorPort),
    DEEPSEEK_API_URL: `http://127.0.0.1:${providerPort}/v1`,
    SILICONFLOW_API_URL: `http://127.0.0.1:${providerPort}/v1`,
    PROVIDER_API_KEY: 'neutral-test-only',
    QDRANT_URL: `http://127.0.0.1:${providerPort}`, EMBEDDING_PROVIDER: 'siliconflow',
    EMBEDDING_MODEL: 'BAAI/bge-m3', EMBEDDING_API_KEY: 'neutral-test-only',
    API_BASE_URL: `http://127.0.0.1:${providerPort}`,
    NO_PROXY: '127.0.0.1,localhost',
  });
  const child = spawn(process.execPath, ['--import', pathToFileURL(requireOrchestrator.resolve('tsx')).href, path.join(orchestratorRoot, 'src/main.ts')], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null) throw new Error(`orchestrator exited ${child.exitCode}: ${output.slice(-2000)}`);
      try {
        const res = await fetch(`http://127.0.0.1:${orchestratorPort}/api/projects/neutral-audit/context`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemPromptText: 'CURRENT_PROJECT_MARK', chapters: [] }), signal: AbortSignal.timeout(1000) });
        if (res.ok) break;
      } catch { /* wait for this isolated child only */ }
      if (n === 99) throw new Error(`orchestrator startup timeout: ${output.slice(-2000)}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const gateway = new OrchestratorRefinementGateway(() => `http://127.0.0.1:${orchestratorPort}`);
    const phases = ['inspect', 'plan', 'rewrite', 'review', 'repair'];
    const matrix = [];
    for (const phase of phases) {
      const result = await gateway.generate({
        projectId: 'neutral-audit', chapterNo: 1, templateKey: `chapter.refinement.${phase}`,
        systemPromptText: `TASK_CONTRACT_${phase}`, projectSystemPromptText: 'FROZEN_PROJECT_GUIDE_MARK',
        prompt: `NEUTRAL_TASK_${phase}`, signal: AbortSignal.timeout(15000), maxTokens: 256,
        modelRoute: { tier: ['rewrite', 'repair'].includes(phase) ? 'writing' : 'utility', provider: 'deepseek', model: 'deepseek-chat', temperature: 0.3 },
        frozenReferenceMaterials: { materials: [], promptText: '', personaText: 'FROZEN_PERSONA_MARK', knowledgeText: 'FROZEN_KNOWLEDGE_MARK', styleSampleBlock: 'FROZEN_STYLE_MARK', frozenAt: '2026-10-07T00:00:00.000Z' },
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      const messages = captures.at(-1)!.messages;
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
      const user = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
      matrix.push({ phase, projectGuideInSystem: system.includes('FROZEN_PROJECT_GUIDE_MARK'), styleInUser: user.includes('FROZEN_STYLE_MARK'), taskContract: system.includes(`TASK_CONTRACT_${phase}`), persona: user.includes('FROZEN_PERSONA_MARK'), knowledge: user.includes('FROZEN_KNOWLEDGE_MARK') });
    }
    const candidate = '甲手里拿着钥匙走到门边后把钥匙放在桌上。';
    const anchor = '甲手里拿着钥匙';
    const sameSentence = verifyRefinementStateFact({ key: 'holding', sourceBlockId: 'b0', value: '拿着钥匙', anchorQuote: anchor, exitAnchorQuote: anchor }, { candidate, original: candidate });
    const base = candidate + '\n\n乙站在院里等候。';
    const route = { provider: 'deepseek' as const, model: 'deepseek-chat', temperature: 0.3 };
    const blocks = ['b0', 'b1'];
    const inspect = JSON.stringify({ windowId: 'w0', sceneFragments: blocks.map(id => ({ startBlockId: id, endBlockId: id, startsNewScene: true, confidence: 'high', goal: '保留事件', entryFacts: [], exitFacts: [], proposedBeatEnds: [] })), issues: [] });
    const plan = JSON.stringify({ chapterIntent: '改善表达', protectedFacts: [], sceneBriefs: blocks.map((id, i) => ({ sceneId: `scene-${i+1}`, sourceBlockIds: [id], decision: 'rewrite', reason: '改善表达', editIntent: '改善表达', expectedChange: '改善表达', entryFacts: [], exitFacts: [], protectedSpanIds: [], targetLength: { direction: 'hold' }, checks: [] })) });
    let reviews = 0;
    let staleFactRecorded = false;
    const rewritePrompts: string[] = [];
    const record: any = { runId: 'neutral-state-audit', projectId: 'p', chapterNo: 1, creatorId: 'u', clientRequestId: 'c', payloadHash: 'h', status: 'running', phase: 'reading', revision: 2, attemptId: 'a', pauseReason: null, resumable: false, baseUpdatedAt: '2026-10-07T00:00:00.000Z', baseHash: 'h', rewritePolicy: 'preserve-plot', snapshot: { instruction: '改善表达，保留事件', baseTitle: '中性样章', baseText: base, systemPromptText: '', templateVersions: [], modelRoutes: { writing: { ...route, tier: 'writing' }, utility: { ...route, tier: 'utility' } }, resolvedPolicy: resolveRefinementPolicy({}), frozenAt: '2026-10-07T00:00:00.000Z' }, checkpoint: createInitialRefinementCheckpoint(base), tombstone: false, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z' };
    const engineResult = await new OrchestratedRefinementEngine({ async generate(req) {
      const phase = req.templateKey.split('.').at(-1);
      let text = JSON.stringify({ issues: [], exitStateFacts: [] });
      if (phase === 'inspect') text = inspect;
      if (phase === 'plan') text = plan;
      if (phase === 'rewrite') { rewritePrompts.push(req.prompt); text = rewritePrompts.length === 1 ? candidate : '乙在院里等候。'; }
      if (phase === 'review' && reviews++ === 0) text = JSON.stringify({ issues: [], exitStateFacts: [{ key: 'holding', sourceBlockId: 'b0', value: '拿着钥匙', anchorQuote: anchor, exitAnchorQuote: anchor }] });
      return { ok: true, text, traceId: 'neutral-state-audit', aborted: false };
    } }).run({ record, signal: new AbortController().signal, onStage() {}, onCheckpoint(cp) { staleFactRecorded ||= (cp.resumeState?.stateFacts ?? []).some(f => f.key === 'holding' && f.value === '拿着钥匙'); } });
    const confirmedSection = rewritePrompts[1]?.split('【前文已确认的当前状态')[1]?.split('【')[0] ?? '';
    const propagation = { status: engineResult.status, recordedStaleFact: staleFactRecorded, nextUnitConfirmedSection: confirmedSection, nextUnitReceivesStaleFact: confirmedSection.includes('拿着钥匙') };
    console.log(JSON.stringify({ propagation, rewriteCalls: rewritePrompts.length, issues: engineResult.checkpoint.issues }));
    // 修复后：缺陷观察断言改为正确行为回归
    // R2：同一句先拿钥匙、后放下，不得判为确定末态，也不得污染下一范围
    assert.equal(propagation.recordedStaleFact, false);
    assert.equal(propagation.nextUnitReceivesStaleFact, false);
    const observation = { realGatewayAndOrchestratorProviderMatrix: matrix, sameSentenceLaterChange: { candidate, anchor, result: sameSentence, propagation } };
    // R1：工具档（inspect/plan/review）不得注入项目长写作指导；写作档注入
    assert.deepEqual(matrix.map(row => row.projectGuideInSystem), [false, false, true, false, true]);
    assert.deepEqual(matrix.map(row => row.styleInUser), [false, false, true, false, true]);
    assert.equal(sameSentence.status, 'superseded');
    writeFileSync(path.join(repo, 'openspec/changes/add-chapter-refinement-orchestration/evidence/batch-acceptance-observations-2026-10-07.json'), JSON.stringify(observation, null, 2) + '\n');
    console.log(JSON.stringify(observation, null, 2));
  } finally {
    child.kill();
    await new Promise<void>(resolve => provider.close(() => resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
