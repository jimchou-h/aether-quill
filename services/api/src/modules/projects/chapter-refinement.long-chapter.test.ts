import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRefinementSourceBlocks,
  CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
  planRefinementDiagnosisWindows,
  type RefinementSourceBlock,
} from './chapter-refinement.util';
import { OrchestratedRefinementEngine } from './chapter-refinement.engine';
import type {
  RefinementGenerationGateway,
  RefinementGenerationRequest,
  RefinementGenerationResult,
} from './chapter-refinement.gateway';
import {
  createInitialRefinementCheckpoint,
  resolveRefinementPolicy,
  type RefinementRunRecord,
} from './chapter-refinement.types';

/**
 * 长章端到端 fixture：脚本模型（不依赖真实模型）验证整章顺序编排在
 * 10000 / 15000 / 20000 字规模下仍满足覆盖、偏移与预算约束。
 * 本文件只证明确定性链路正确，不代表真实模型成稿质量。
 */

const SENTENCE = '夜色沉下来，风从窗缝里钻进来，屋里的灯影在墙上轻轻晃动。';
const REVIEW_OK = JSON.stringify({ issues: [], exitStateFacts: [] });

interface ChapterFixture {
  text: string;
  blocks: RefinementSourceBlock[];
  sceneRanges: Array<[number, number]>;
}

/** 生成指定字数的整章：段落以空行分隔，段落按场景分组，每场 3 段。 */
function buildChapter(targetChars: number, sceneCount: number): ChapterFixture {
  const perScene = Math.ceil(targetChars / sceneCount);
  const perParagraph = Math.ceil(perScene / 3);
  const paragraphs: string[] = [];
  const sceneRanges: Array<[number, number]> = [];
  let start = 0;
  for (let scene = 0; scene < sceneCount; scene += 1) {
    for (let paragraph = 0; paragraph < 3; paragraph += 1) {
      let text = `第${scene + 1}场第${paragraph + 1}段。`;
      while (text.length < perParagraph) {
        text += SENTENCE;
      }
      paragraphs.push(text);
    }
    sceneRanges.push([start, paragraphs.length]);
    start = paragraphs.length;
  }
  const text = paragraphs.join('\n\n');
  const blocks = buildRefinementSourceBlocks(text);
  assert.equal(blocks.length, paragraphs.length, '每段应恰好对应一个 source block');
  return { text, blocks, sceneRanges };
}

function makeRecord(baseText: string): RefinementRunRecord {
  return {
    runId: 'run-long',
    projectId: 'p1',
    chapterNo: 12,
    creatorId: 'u1',
    clientRequestId: 'c-long',
    payloadHash: 'h-long',
    status: 'running',
    phase: 'reading',
    revision: 2,
    attemptId: 'a1',
    pauseReason: null,
    resumable: false,
    baseUpdatedAt: '2026-10-06T00:00:00.000Z',
    baseHash: 'base-hash',
    rewritePolicy: 'preserve-plot',
    snapshot: {
      instruction: '收紧节奏，保持人物状态与必要事件不变',
      baseTitle: '第十二章',
      baseText,
      systemPromptText: '项目系统提示',
      templateVersions: [],
      modelRoute: null,
      resolvedPolicy: resolveRefinementPolicy({}),
      frozenAt: '2026-10-06T00:00:00.000Z',
    },
    checkpoint: createInitialRefinementCheckpoint(baseText),
    tombstone: false,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:10.000Z',
    expiresAt: '2026-10-13T00:00:00.000Z',
  };
}

function inspectWindowId(prompt: string): string {
  return prompt.match(/<diagnosis-window id="([^"]+)"/)?.[1] ?? '';
}

/** 按诊断窗返回脚本化 inspect：把落在窗内的场景片段按 block 引用交回。 */
function buildInspectByWindow(fixture: ChapterFixture, targetChars: number): Map<string, string> {
  const windows = planRefinementDiagnosisWindows({
    baseText: fixture.text,
    blocks: fixture.blocks,
    targetChars,
  });
  const byWindow = new Map<string, string>();
  for (const window of windows) {
    const fragments = fixture.sceneRanges
      .map(([sceneStart, sceneEnd]) => {
        const from = Math.max(sceneStart, window.startBlockIndex);
        const to = Math.min(sceneEnd, window.endBlockIndex);
        if (from >= to) {
          return null;
        }
        return {
          startBlockId: fixture.blocks[from].id,
          endBlockId: fixture.blocks[to - 1].id,
          startsNewScene: from === sceneStart,
          confidence: 'high' as const,
          goal: `推进第 ${sceneStart + 1} 段起`,
          entryFacts: [],
          exitFacts: [],
          proposedBeatEnds: [],
        };
      })
      .filter((fragment) => fragment !== null);
    byWindow.set(
      window.id,
      JSON.stringify({ windowId: window.id, sceneFragments: fragments, issues: [] })
    );
  }
  return byWindow;
}

function buildPlan(
  fixture: ChapterFixture,
  decisions: Array<'keep' | 'patch' | 'rewrite'>
): string {
  return JSON.stringify({
    chapterIntent: '收紧节奏',
    protectedFacts: [],
    sceneBriefs: fixture.sceneRanges.map(([sceneStart, sceneEnd], index) => ({
      sceneId: `scene-${index + 1}`,
      sourceBlockIds: fixture.blocks.slice(sceneStart, sceneEnd).map((block) => block.id),
      decision: decisions[index] ?? 'rewrite',
      reason: '啰嗦',
      editIntent: '压缩',
      expectedChange: '更短',
      entryFacts: [],
      exitFacts: [],
      protectedSpanIds: [],
      targetLength: { direction: 'condense' },
      checks: [],
    })),
  });
}

function makeGateway(
  fixture: ChapterFixture,
  inspectByWindow: Map<string, string>,
  plan: string,
  rewriteOutputs: string[]
): { gateway: RefinementGenerationGateway; requests: RefinementGenerationRequest[] } {
  const requests: RefinementGenerationRequest[] = [];
  let rewriteCall = 0;
  return {
    requests,
    gateway: {
      async generate(request): Promise<RefinementGenerationResult> {
        requests.push(request);
        const scripted = (): Partial<RefinementGenerationResult> => {
          switch (request.templateKey) {
            case CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY:
              return { text: inspectByWindow.get(inspectWindowId(request.prompt)) ?? '' };
            case CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY:
              return { text: plan };
            case CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY: {
              const text = rewriteOutputs[rewriteCall] ?? '';
              rewriteCall += 1;
              return { text };
            }
            case CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY:
              return { text: REVIEW_OK };
            default:
              return { ok: false, errorMessage: `no script for ${request.templateKey}` };
          }
        };
        const result = scripted();
        return {
          ok: result.ok ?? true,
          text: result.text ?? '',
          traceId: result.traceId ?? 'trace-long',
          aborted: result.aborted ?? false,
          ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
        };
      },
    },
  };
}

async function runChapter(fixture: ChapterFixture, decisions: Array<'keep' | 'patch' | 'rewrite'>) {
  const record = makeRecord(fixture.text);
  const policy = record.snapshot.resolvedPolicy;
  const inspectByWindow = buildInspectByWindow(fixture, policy.diagnosisTargetChars);
  const rewriteOutputs = fixture.sceneRanges
    .map((_, index) => (decisions[index] === 'keep' ? '' : `R${index + 1}`))
    .filter(Boolean);
  const { gateway, requests } = makeGateway(
    fixture,
    inspectByWindow,
    buildPlan(fixture, decisions),
    rewriteOutputs
  );
  const engine = new OrchestratedRefinementEngine(gateway);
  const result = await engine.run({
    record,
    signal: new AbortController().signal,
    onStage: () => undefined,
  });
  return { result, requests, inspectByWindow, policy };
}

for (const [targetChars, sceneCount] of [
  [10000, 3],
  [15000, 4],
  [20000, 5],
] as const) {
  test(`整章端到端（约 ${targetChars} 字 / ${sceneCount} 场）：覆盖全文且偏移不漂移`, async () => {
    const fixture = buildChapter(targetChars, sceneCount);
    assert.ok(
      fixture.text.length >= targetChars,
      `fixture 长度 ${fixture.text.length} 应不小于 ${targetChars}`
    );

    const { result, requests, inspectByWindow, policy } = await runChapter(
      fixture,
      fixture.sceneRanges.map(() => 'rewrite' as const)
    );

    assert.equal(result.status, 'ready');
    assert.equal(result.checkpoint.coverage.sourceChars, fixture.text.length);
    assert.equal(result.checkpoint.coverage.processedChars, fixture.text.length);
    assert.equal(result.checkpoint.coverage.retainedOriginalChars, 0);
    assert.equal(result.checkpoint.changes.length, sceneCount);

    // 每个场景恰好一次改写；诊断窗数量与规划一致
    const inspectCalls = requests.filter(
      (request) => request.templateKey === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY
    );
    const rewriteCalls = requests.filter(
      (request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY
    );
    assert.equal(inspectCalls.length, inspectByWindow.size);
    assert.ok(inspectCalls.length > 1, '长章应产生多个诊断窗');
    assert.equal(rewriteCalls.length, sceneCount);
    assert.ok(
      requests.length <= policy.maxCallsPerAttempt,
      `调用数 ${requests.length} 不应超过预算 ${policy.maxCallsPerAttempt}`
    );

    // 变更区间用冻结原文偏移登记：场景间分隔串逐码元保留，后续不因前序长度漂移
    const expectedChanges = fixture.sceneRanges.map(([sceneStart, sceneEnd]) => [
      fixture.blocks[sceneStart].startOffset,
      fixture.blocks[sceneEnd - 1].endOffset,
    ]);
    assert.deepEqual(
      result.checkpoint.changes.map((change) => [change.startOffset, change.endOffset]),
      expectedChanges
    );

    let expectedDraft = '';
    fixture.sceneRanges.forEach(([sceneStart], index) => {
      if (index > 0) {
        const prevEnd = fixture.sceneRanges[index - 1][1];
        expectedDraft += fixture.text.slice(
          fixture.blocks[prevEnd - 1].endOffset,
          fixture.blocks[sceneStart].startOffset
        );
      }
      expectedDraft += `R${index + 1}`;
    });
    assert.equal(result.checkpoint.acceptedDraftText, expectedDraft);
  });
}

test('E10：前半章 keep、章尾改写时章尾仍被处理且覆盖全文', async () => {
  const fixture = buildChapter(10000, 3);
  const { result, requests } = await runChapter(fixture, ['keep', 'keep', 'rewrite']);

  assert.equal(result.status, 'ready');
  assert.equal(result.checkpoint.changes.length, 1);

  // 只对末场调用改写；前半章 keep 不产生模型调用
  assert.equal(
    requests.filter((request) => request.templateKey === CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY)
      .length,
    1
  );

  const [tailStart, tailEnd] = fixture.sceneRanges[fixture.sceneRanges.length - 1];
  const tailStartOffset = fixture.blocks[tailStart].startOffset;
  const tailEndOffset = fixture.blocks[tailEnd - 1].endOffset;
  assert.equal(result.checkpoint.changes[0]?.startOffset, tailStartOffset);
  assert.equal(result.checkpoint.changes[0]?.endOffset, tailEndOffset);

  // 章尾确实被替换，前半章逐码元保留
  assert.equal(result.checkpoint.acceptedDraftText, fixture.text.slice(0, tailStartOffset) + 'R3');
  assert.equal(result.checkpoint.coverage.processedChars, fixture.text.length);
});
