/**
 * AQ-382 后置真实样章试跑（私有开发工具，产物写入 .scratch/，不提交）。
 *
 * 目的：用真实 orchestrator + 真实模型跑通「智能精修」链路，并与旧「文笔优化（方案→正文）」
 * 链路在同一原文、同一要求、同一模型档位下对照。只输出候选稿与运行证据，
 * 不写章节、不发布模板、不触碰业务数据。
 *
 * 用法（在 services/api 下）：
 *   pnpm exec tsx scripts/refinement-sample-validation.ts \
 *     --link=refinement --input=../.scratch/ch11-stored.txt --max-chars=3200 \
 *     --instruction-file=../.scratch/refinement-validation/instruction.txt \
 *     --label=scene --out=../.scratch/refinement-validation
 *
 *   --link=refinement|legacy|both
 *   --max-chars=N  可选；按自然段边界截取前 N 字（短场取样）
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveGenerationCallProfile } from '@aether-quill/config';
import {
  OrchestratedRefinementEngine,
  type RefinementEngineStageEvent,
} from '../src/modules/projects/chapter-refinement.engine';
import { OrchestratorRefinementGateway } from '../src/modules/projects/chapter-refinement.gateway';
import type { RefinementGenerationGateway } from '../src/modules/projects/chapter-refinement.gateway';
import {
  CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_TEMPLATE_KEYS,
  parsePlanOutput,
} from '../src/modules/projects/chapter-refinement.util';
import {
  createInitialRefinementCheckpoint,
  resolveRefinementPolicy,
  type RefinementRunRecord,
} from '../src/modules/projects/chapter-refinement.types';
import {
  buildDraftUserPrompt,
  buildPlanUserPrompt,
  CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
} from '../src/modules/projects/chapter-optimize.util';
import { streamPipelineGeneration } from '../src/modules/projects/chapter-generation-stream.client';
import { getWarehouseDefaultTaskPromptText } from '../src/modules/task-prompts/task-prompt-defaults';

const ORCHESTRATOR_URL = process.env.RAG_ORCHESTRATOR_URL || 'http://127.0.0.1:3001';
const PROBE_PROJECT_ID = 'aq-validation-probe';

function arg(name: string, fallback = ''): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 按自然段边界截取前 maxChars 字，避免短场取样切在半句上。 */
function sliceAtParagraph(text: string, maxChars: number): string {
  if (!maxChars || text.length <= maxChars) {
    return text;
  }
  const head = text.slice(0, maxChars);
  const cut = head.lastIndexOf('\n\n');
  return cut > maxChars * 0.6 ? head.slice(0, cut) : head;
}

function buildFrozenTemplateTexts(): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const key of CHAPTER_REFINEMENT_TEMPLATE_KEYS) {
    texts[key] = getWarehouseDefaultTaskPromptText(key);
  }
  return texts;
}

function describeModelRouting() {
  const keys = [
    CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
    CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
    CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
    CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
    CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
    CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
    CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
  ];
  return keys.map((templateKey) => ({
    templateKey,
    ...resolveGenerationCallProfile({ templateKey }),
  }));
}

async function runRefinementLink(input: {
  baseText: string;
  instruction: string;
  label: string;
}): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const policy = resolveRefinementPolicy({});
  const record: RefinementRunRecord = {
    runId: `validation-${input.label}`,
    projectId: PROBE_PROJECT_ID,
    chapterNo: 0,
    creatorId: 'validation',
    clientRequestId: `validation-${input.label}`,
    payloadHash: sha256(input.baseText),
    status: 'running',
    phase: 'reading',
    revision: 1,
    attemptId: 'attempt-1',
    pauseReason: null,
    resumable: false,
    baseUpdatedAt: new Date(0).toISOString(),
    baseHash: sha256(input.baseText),
    rewritePolicy: 'preserve-plot',
    snapshot: {
      instruction: input.instruction,
      baseTitle: input.label,
      baseText: input.baseText,
      // 无真实项目上下文：不注入项目 systemPrompt 与文风样本，作为已知变量记录
      systemPromptText: '',
      templateVersions: [],
      templateTexts: buildFrozenTemplateTexts(),
      modelRoute: null,
      resolvedPolicy: policy,
      frozenAt: new Date().toISOString(),
    },
    checkpoint: createInitialRefinementCheckpoint(input.baseText),
    tombstone: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  };

  const gateway = new OrchestratorRefinementGateway(() => ORCHESTRATOR_URL);
  // 捕获各阶段原始输出，用于记录「实际请求里注入了什么」这一证据（不改动引擎行为）。
  // 无论成功与否都记录：被拒答 / 合同违规时原文才是定位问题的证据。
  const captured: Record<string, string> = {};
  const capturedCalls: Array<{
    templateKey: string;
    ok: boolean;
    aborted: boolean;
    completionFailure?: string;
    errorMessage?: string;
    traceId: string;
    text: string;
  }> = [];
  const capturingGateway: RefinementGenerationGateway = {
    async generate(request) {
      const result = await gateway.generate(request);
      capturedCalls.push({
        templateKey: request.templateKey,
        ok: result.ok,
        aborted: result.aborted,
        ...(result.completionFailure ? { completionFailure: result.completionFailure } : {}),
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
        traceId: result.traceId,
        text: result.text,
      });
      if (result.ok) {
        // plan 会因合同违规重试，引擎采用最后一次成功输出；按 key 覆盖保证 planDiagnostics
        // 反映实际被采纳的方案，而不是首次可解析但合同违规的那次。
        captured[request.templateKey] = result.text;
      }
      return result;
    },
  };
  const engine = new OrchestratedRefinementEngine(capturingGateway);
  const stages: RefinementEngineStageEvent[] = [];
  const result = await engine.run({
    record,
    signal: new AbortController().signal,
    onStage: (event) => {
      stages.push(event);
      process.stderr.write(
        `[refinement] ${event.phase} ${event.unitIndex}/${event.unitTotal} ${event.message}\n`
      );
    },
  });

  return {
    link: 'refinement',
    status: result.status,
    phase: result.phase,
    pauseReason: result.pauseReason ?? null,
    resumable: result.resumable,
    candidate: result.checkpoint.acceptedDraftText,
    coverage: result.checkpoint.coverage,
    changes: result.checkpoint.changes,
    issues: result.checkpoint.issues,
    chapterBrief: result.checkpoint.chapterBrief,
    planDiagnostics: describePlanDiagnostics(captured[CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]),
    rawCalls: capturedCalls,
    usage: result.checkpoint.usage,
    elapsedMs: Date.now() - startedAt,
    stages: stages.map((stage) => `${stage.phase}:${stage.message}`),
  };
}

/**
 * 记录逐字锁实际来源：程序门禁只认 plan 显式标注的 protectedSpanIds（source block id）。
 * chapter 级 protectedFacts 与场内首尾事实是语义证据，交给 review 检查，不参与程序门禁。
 */
function describePlanDiagnostics(planText: string | undefined): Record<string, unknown> {
  if (!planText) {
    return { parsed: false };
  }
  try {
    const parsed = parsePlanOutput(planText);
    if (!parsed.brief) {
      return { parsed: true, boundaryConflict: parsed.boundaryConflict ?? null };
    }
    const brief = parsed.brief;
    return {
      parsed: true,
      chapterIntent: brief.chapterIntent,
      protectedFacts: brief.protectedFacts,
      scenes: brief.sceneBriefs.map((sceneBrief) => ({
        sceneId: sceneBrief.sceneId,
        decision: sceneBrief.decision,
        sourceBlockIds: sceneBrief.sourceBlockIds,
        entryFacts: sceneBrief.entryFacts,
        exitFacts: sceneBrief.exitFacts,
        protectedSpanIds: sceneBrief.protectedSpanIds,
      })),
    };
  } catch (error) {
    return { parsed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runLegacyLink(input: {
  baseText: string;
  instruction: string;
  label: string;
}): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const chapter = { chapterNo: 0, title: input.label, content: input.baseText };

  const planResponse = await streamPipelineGeneration({
    orchestratorUrl: ORCHESTRATOR_URL,
    projectId: PROBE_PROJECT_ID,
    templateKey: CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
    systemPromptOverride: getWarehouseDefaultTaskPromptText(CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY),
    prompt: buildPlanUserPrompt({ chapter, instruction: input.instruction }),
    context: { chapterNo: 0 },
    callbacks: {},
  });
  const planText = planResponse.text;

  const draftResponse = await streamPipelineGeneration({
    orchestratorUrl: ORCHESTRATOR_URL,
    projectId: PROBE_PROJECT_ID,
    templateKey: CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
    systemPromptOverride: getWarehouseDefaultTaskPromptText(CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY),
    prompt: buildDraftUserPrompt({ chapter, instruction: input.instruction, planText }),
    context: { chapterNo: 0 },
    callbacks: {},
  });

  return {
    link: 'legacy-optimize',
    status: draftResponse.ok ? 'ready' : 'failed',
    planOk: planResponse.ok,
    planCompleted: planResponse.completed ?? null,
    planFinishReason: planResponse.finishReason ?? null,
    planTraceId: planResponse.traceId,
    plan: planText,
    draftOk: draftResponse.ok,
    draftCompleted: draftResponse.completed ?? null,
    draftFinishReason: draftResponse.finishReason ?? null,
    draftTraceId: draftResponse.traceId,
    draftError: draftResponse.errorMessage ?? null,
    candidate: draftResponse.text,
    retrievedEvidenceChars: (draftResponse.retrievedEvidence ?? '').length,
    elapsedMs: Date.now() - startedAt,
  };
}

async function main() {
  const link = arg('link', 'refinement');
  const inputPath = arg('input');
  const outDir = arg('out', path.resolve(process.cwd(), '../../.scratch/refinement-validation'));
  const label = arg('label', 'sample');
  const instructionFile = arg('instruction-file');
  const maxChars = Number(arg('max-chars', '0')) || 0;

  if (!inputPath) {
    throw new Error('缺少 --input=<样章文件路径>');
  }
  const rawText = readFileSync(inputPath, 'utf8').replace(/\r\n/g, '\n');
  const baseText = sliceAtParagraph(rawText, maxChars);
  const instruction = instructionFile
    ? readFileSync(instructionFile, 'utf8').trim()
    : arg('instruction');

  mkdirSync(outDir, { recursive: true });
  const common = {
    label,
    inputPath: path.resolve(inputPath),
    sourceChars: baseText.length,
    sourceHash: sha256(baseText),
    instructionChars: instruction.length,
    modelRouting: describeModelRouting(),
    orchestratorUrl: ORCHESTRATOR_URL,
    ranAt: new Date().toISOString(),
  };
  process.stderr.write(
    `[validation] source=${baseText.length}字 hash=${common.sourceHash.slice(0, 12)}\n`
  );

  const links = link === 'both' ? ['refinement', 'legacy'] : [link];
  for (const target of links) {
    const outcome =
      target === 'refinement'
        ? await runRefinementLink({ baseText, instruction, label })
        : await runLegacyLink({ baseText, instruction, label });
    const candidate = String(outcome.candidate ?? '');
    const { rawCalls, ...meta } = outcome as { rawCalls?: unknown } & Record<string, unknown>;
    writeFileSync(path.join(outDir, `${label}.${target}.candidate.txt`), candidate, 'utf8');
    writeFileSync(
      path.join(outDir, `${label}.${target}.meta.json`),
      JSON.stringify({ ...common, ...meta, candidate: undefined, candidateChars: candidate.length }, null, 2),
      'utf8'
    );
    if (rawCalls) {
      writeFileSync(
        path.join(outDir, `${label}.${target}.raw.json`),
        JSON.stringify(rawCalls, null, 2),
        'utf8'
      );
    }
    process.stderr.write(
      `[validation] ${target} done: status=${outcome.status} candidate=${candidate.length}字 elapsed=${outcome.elapsedMs}ms\n`
    );
  }
}

main().catch((error) => {
  process.stderr.write(
    `[validation] failed: ${error instanceof Error ? error.stack : String(error)}\n`
  );
  process.exitCode = 1;
});
