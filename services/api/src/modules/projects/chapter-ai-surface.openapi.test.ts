import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const OPENAPI_ROOT = path.resolve(__dirname, '../../../../../openapi/openapi.yaml');

const CUT_PATH_MARKERS = [
  '/optimize/typo-check',
  '/optimize/typo-fix',
  '/pipeline/',
  '/compliance-check/',
];

const KEEP_PATH_MARKERS = [
  '/optimize/plan',
  '/optimize/draft',
  '/optimize/auto-loop',
  '/optimize/workbench/',
];

test('openapi root no longer registers cut chapter AI product paths', () => {
  const text = readFileSync(OPENAPI_ROOT, 'utf8');
  for (const marker of CUT_PATH_MARKERS) {
    assert.equal(
      text.includes(marker),
      false,
      `openapi.yaml must not retain cut path marker: ${marker}`
    );
  }
  for (const marker of KEEP_PATH_MARKERS) {
    assert.ok(text.includes(marker), `openapi.yaml must keep path marker: ${marker}`);
  }
});
