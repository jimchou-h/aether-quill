import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const OPENAPI_PATH = path.resolve(__dirname, '../../../../../openapi/openapi.yaml');
const PATHS_DIR = path.resolve(__dirname, '../../../../../openapi/paths/projects');

function readOpenapi(): string {
  return readFileSync(OPENAPI_PATH, 'utf8');
}

test('refinement runs paths are additive and do not disturb optimize paths', () => {
  const yaml = readOpenapi();

  assert.match(
    yaml,
    /\/api\/projects\/\{id\}\/knowledge\/chapters\/\{chapterNo\}\/optimize\/refinement\/runs:/
  );
  assert.match(
    yaml,
    /\/api\/projects\/\{id\}\/knowledge\/chapters\/\{chapterNo\}\/optimize\/refinement\/runs\/\{runId\}:/
  );
  assert.match(
    yaml,
    /\/api\/projects\/\{id\}\/knowledge\/chapters\/\{chapterNo\}\/optimize\/refinement\/runs\/\{runId\}\/events:/
  );

  assert.match(yaml, /chapter-refinement-runs\.yaml/);
  assert.match(yaml, /chapter-refinement-run-by-id\.yaml/);
  assert.match(yaml, /chapter-refinement-run-events\.yaml/);
});

test('refinement create request required fields and policy enum are locked', () => {
  const yaml = readOpenapi();

  const createSchema = yaml.slice(
    yaml.indexOf('ChapterRefinementCreateRequest:'),
    yaml.indexOf('RefinementResolvedPolicy:')
  );
  const required = createSchema.match(/required:([\s\S]*?)\r?\n\s{6}properties:/);
  assert.ok(required, 'ChapterRefinementCreateRequest.required missing');
  for (const field of ['clientRequestId', 'expectedChapterUpdatedAt', 'instruction']) {
    assert.match(required[1], new RegExp(`\\b${field}\\b`));
  }
  // rewritePolicy / diagnosisTargetChars are optional refinements of the brief.
  assert.doesNotMatch(required[1], /\brewritePolicy\b/);
  assert.doesNotMatch(required[1], /\bdiagnosisTargetChars\b/);
  assert.match(createSchema, /instruction:[\s\S]*?maxLength: 20000/);

  const policyEnum = yaml.match(
    /ChapterRefinementRewritePolicy:\r?\n\s+type: string\r?\n\s+enum:\r?\n\s+- preserve-plot\r?\n\s+- scene-rewrite/
  );
  assert.ok(
    policyEnum,
    'ChapterRefinementRewritePolicy enum must stay preserve-plot|scene-rewrite'
  );

  const storageEnum = yaml.match(
    /ChapterRefinementStorageMode:[\s\S]*?enum:\r?\n\s+- postgres\r?\n\s+- memory/
  );
  assert.ok(storageEnum, 'ChapterRefinementStorageMode enum must stay postgres|memory');
});

test('refinement status/phase/pause enums match the client contract', () => {
  const yaml = readOpenapi();

  const statusBlock = yaml.slice(
    yaml.indexOf('RefinementStatus:'),
    yaml.indexOf('RefinementPhase:')
  );
  for (const status of [
    'queued',
    'running',
    'paused',
    'ready',
    'ready_with_issues',
    'failed',
    'discarded',
    'expired',
  ]) {
    assert.match(statusBlock, new RegExp(`- ${status}\\b`));
  }

  const phaseBlock = yaml.slice(
    yaml.indexOf('RefinementPhase:'),
    yaml.indexOf('RefinementPauseReason:')
  );
  for (const phase of ['reading', 'planning', 'rewriting', 'repairing', 'verifying', 'finished']) {
    assert.match(phaseBlock, new RegExp(`- ${phase}\\b`));
  }

  const pauseBlock = yaml.slice(
    yaml.indexOf('RefinementPauseReason:'),
    yaml.indexOf('ChapterRefinementRewritePolicy:')
  );
  for (const reason of [
    'user_cancelled',
    'budget_exhausted',
    'upstream_failure',
    'process_restart',
    'context_budget',
    'invalid_model_output',
    'boundary_conflict',
    'permission_revoked',
    'source_changed',
  ]) {
    assert.match(pauseBlock, new RegExp(`- ${reason}\\b`));
  }
});

test('RefinementRunView composes RefinementRunSummary and freezes base/candidate text', () => {
  const yaml = readOpenapi();

  const viewBlock = yaml.slice(yaml.indexOf('RefinementRunView:'), yaml.indexOf('\nsecurity:'));
  assert.match(viewBlock, /allOf:/);
  assert.match(viewBlock, /\$ref: '#\/components\/schemas\/RefinementRunSummary'/);
  for (const field of [
    'instruction',
    'baseText',
    'acceptedDraftText',
    'chapterBrief',
    'changes',
    'issues',
    'coverage',
    'sourceCurrent',
  ]) {
    assert.match(viewBlock, new RegExp(`\\b${field}\\b`));
  }
  assert.match(viewBlock, /acceptedDraftText[\s\S]*?MUST NOT be treated as a verified final draft/);
});

test('refinement SSE events file documents the AQ-380 event set', () => {
  const eventsPath = readFileSync(
    path.join(PATHS_DIR, 'chapter-refinement-run-events.yaml'),
    'utf8'
  );

  for (const event of ['snapshot', 'stage', 'finished', 'error']) {
    assert.match(eventsPath, new RegExp(`"event":"${event}"`));
  }
  // Reserved for later tasks; must be documented as not yet emitted.
  for (const reserved of ['content', 'unit_settled', 'issue', 'paused']) {
    assert.match(eventsPath, new RegExp(reserved));
  }
  // Observing must be decoupled from execution.
  assert.match(eventsPath, /does \*\*not\*\* cancel the run/);
  assert.match(eventsPath, /text\/event-stream/);
});

test('refinement runs path files keep create/list/get/events response codes', () => {
  const runsPath = readFileSync(path.join(PATHS_DIR, 'chapter-refinement-runs.yaml'), 'utf8');
  assert.match(runsPath, /post:/);
  assert.match(runsPath, /get:/);
  assert.match(runsPath, /'202':/);
  assert.match(runsPath, /'409':/);

  const byIdPath = readFileSync(path.join(PATHS_DIR, 'chapter-refinement-run-by-id.yaml'), 'utf8');
  assert.match(byIdPath, /'200':/);
  assert.match(byIdPath, /'410':/);
});

// ── 5.1：取消 / 继续 / 放弃 契约 ─────────────────────────────────────

test('refinement run cancel/resume/discard paths and request schemas are registered', () => {
  const yaml = readOpenapi();

  for (const segment of ['cancel', 'resume', 'discard']) {
    assert.match(
      yaml,
      new RegExp(
        `/api/projects/\\{id\\}/knowledge/chapters/\\{chapterNo\\}/optimize/refinement/runs/\\{runId\\}/${segment}:`
      ),
      `missing path for .../${segment}`
    );
    assert.match(yaml, new RegExp(`chapter-refinement-run-${segment}\\.yaml`));
  }

  // 三个请求体 schema 必须在 openapi.yaml 中内联定义，且继续 / 放弃携带 revision CAS 字段
  for (const schema of [
    'ChapterRefinementCancelRequest',
    'ChapterRefinementResumeRequest',
    'ChapterRefinementDiscardRequest',
  ]) {
    assert.match(yaml, new RegExp(`${schema}:`), `missing schema ${schema}`);
  }
  assert.match(
    yaml.match(/ChapterRefinementResumeRequest:[\s\S]*?ChapterRefinementDiscardRequest:/)?.[0] ??
      '',
    /expectedRunRevision/
  );
  assert.match(
    yaml.match(/ChapterRefinementDiscardRequest:[\s\S]*?RefinementResolvedPolicy:/)?.[0] ?? '',
    /expectedRunRevision/
  );
  assert.match(
    yaml.match(/ChapterRefinementCancelRequest:[\s\S]*?ChapterRefinementResumeRequest:/)?.[0] ?? '',
    /expectedAttemptId/
  );
});

test('refinement control path files keep the documented status codes and idempotency semantics', () => {
  const cancelPath = readFileSync(
    path.join(PATHS_DIR, 'chapter-refinement-run-cancel.yaml'),
    'utf8'
  );
  assert.match(cancelPath, /post:/);
  assert.match(cancelPath, /'200':/);
  assert.match(cancelPath, /'409':/);
  assert.match(cancelPath, /'410':/);
  // 取消必须明确幂等、且迟到的模型回调不得覆盖已取消的 checkpoint
  assert.match(cancelPath, /idempotent/);
  assert.match(cancelPath, /Late callbacks from the aborted attempt must not overwrite/);

  const resumePath = readFileSync(
    path.join(PATHS_DIR, 'chapter-refinement-run-resume.yaml'),
    'utf8'
  );
  assert.match(resumePath, /post:/);
  assert.match(resumePath, /'202':/);
  assert.match(resumePath, /'403':/);
  assert.match(resumePath, /'409':/);
  assert.match(resumePath, /'410':/);
  // 继续不得重跑已接受单位，且必须重新校验冻结版本与权限
  assert.match(resumePath, /units are not re-run/);
  assert.match(resumePath, /compare-and-set/);

  const discardPath = readFileSync(
    path.join(PATHS_DIR, 'chapter-refinement-run-discard.yaml'),
    'utf8'
  );
  assert.match(discardPath, /post:/);
  assert.match(discardPath, /'200':/);
  assert.match(discardPath, /'409':/);
  // 放弃保留最小墓碑：GET / 订阅返回 410，且绝不改动章节正文
  assert.match(discardPath, /tombstone/);
  assert.match(discardPath, /never deletes or edits the chapter text/);
  assert.match(discardPath, /idempotent/);
});

// ── 6.1：运行关联字段（trace id / 模板版本）契约 ──────────────────────

test('refinement run correlation fields are documented for traceability', () => {
  const yaml = readOpenapi();

  // 模板版本引用 schema 必须在 openapi.yaml 中内联定义
  const versionBlock = yaml.slice(
    yaml.indexOf('RefinementTemplateVersionRef:'),
    yaml.indexOf('RefinementRunSummary:')
  );
  for (const field of ['key', 'version', 'hash']) {
    assert.match(versionBlock, new RegExp(`\\b${field}\\b`));
  }

  // summary 暴露创建时的请求 trace id（可空）
  const summaryBlock = yaml.slice(
    yaml.indexOf('RefinementRunSummary:'),
    yaml.indexOf('RefinementChange:')
  );
  assert.match(summaryBlock, /creationTraceId:/);
  assert.match(summaryBlock, /nullable: true/);
  assert.match(summaryBlock, /x-trace-id/);

  // view 暴露冻结模板版本，且注明墓碑后清空
  const viewBlock = yaml.slice(yaml.indexOf('RefinementRunView:'), yaml.indexOf('\nsecurity:'));
  assert.match(viewBlock, /frozenTemplateVersions:/);
  assert.match(viewBlock, /\$ref: '#\/components\/schemas\/RefinementTemplateVersionRef'/);
  assert.match(viewBlock, /tombstone clears the frozen material/);
});
