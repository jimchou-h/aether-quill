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
