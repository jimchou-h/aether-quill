import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const OPENAPI_PATH = path.resolve(__dirname, '../../../../../openapi/openapi.yaml');

test('workbench paths are additive and rewriteMode enum stays from-plan|direct', () => {
  const yaml = readFileSync(OPENAPI_PATH, 'utf8');

  assert.match(
    yaml,
    /\/api\/projects\/\{id\}\/knowledge\/chapters\/\{chapterNo\}\/optimize\/workbench\/draft:/
  );
  assert.match(
    yaml,
    /\/api\/projects\/\{id\}\/knowledge\/chapters\/\{chapterNo\}\/optimize\/workbench\/review:/
  );
  assert.match(
    yaml,
    /\/api\/projects\/\{id\}\/knowledge\/chapters\/\{chapterNo\}\/optimize\/workbench\/fix-span:/
  );

  const draftSchema = yaml.slice(yaml.indexOf('ChapterOptimizationDraftRequest:'));
  const rewriteEnum = draftSchema.match(
    /rewriteMode:\r?\n\s+type: string\r?\n\s+enum: \[([^\]]+)\]/
  );
  assert.ok(rewriteEnum, 'ChapterOptimizationDraftRequest.rewriteMode enum missing');
  assert.equal(rewriteEnum[1], 'from-plan, direct');
  assert.match(draftSchema, /Ignored when `rewriteMode` is `direct`/);
  assert.doesNotMatch(
    draftSchema.slice(0, draftSchema.indexOf('ChapterOptimizationReviewRequest:')),
    /workbench/
  );
});

test('workbench scene plan is additive and draft scene mode is optional', () => {
  const yaml = readFileSync(OPENAPI_PATH, 'utf8');

  assert.match(
    yaml,
    /\/api\/projects\/\{id\}\/knowledge\/chapters\/\{chapterNo\}\/optimize\/workbench\/plan:/
  );

  const planSchema = yaml.slice(yaml.indexOf('ChapterOptimizeWorkbenchPlanRequest:'));
  const planRequired = planSchema.match(/required:([\s\S]*?)\r?\n\s{6}properties:/);
  assert.ok(planRequired, 'ChapterOptimizeWorkbenchPlanRequest.required missing');
  for (const field of ['instruction', 'startOffset', 'endOffset', 'baseUpdatedAt', 'sourceText']) {
    assert.match(planRequired[1], new RegExp(`\\b${field}\\b`));
  }
  assert.doesNotMatch(planRequired[1], /\bprofile\b/);

  const draftSchema = yaml.slice(
    yaml.indexOf('ChapterOptimizeWorkbenchDraftRequest:'),
    yaml.indexOf('ChapterOptimizeWorkbenchPlanRequest:')
  );
  const draftRequired = draftSchema.match(/required:([\s\S]*?)\r?\n\s{6}properties:/);
  assert.ok(draftRequired, 'ChapterOptimizeWorkbenchDraftRequest.required missing');
  assert.doesNotMatch(draftRequired[1], /\bmode\b|\bplanText\b/);
  assert.match(draftSchema, /mode:\r?\n\s+type: string\r?\n\s+enum: \[direct, from-plan\]/);
  assert.match(draftSchema, /planText:/);

  const planPath = readFileSync(
    path.resolve(
      __dirname,
      '../../../../../openapi/paths/projects/chapter-optimize-workbench-plan.yaml'
    ),
    'utf8'
  );
  for (const event of ['start', 'stage', 'content', 'end', 'error']) {
    assert.match(planPath, new RegExp(`"event":"${event}"`));
  }
});
