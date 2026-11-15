import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(__dirname, '../../../../../');
const OPENAPI_ROOT = path.join(ROOT, 'openapi/openapi.yaml');
const LOCK_PATH_FILE = path.join(ROOT, 'openapi/paths/projects/chapter-lock-by-no.yaml');
const SHARED_TYPES_ROOT = path.join(ROOT, 'packages/shared-types/src/index.ts');
const LOCK_PATH = '/api/projects/{id}/knowledge/chapters/{chapterNo}/lock';

function extractBlock(text: string, headerPrefix: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(headerPrefix));
  assert.notEqual(start, -1, `missing block: ${headerPrefix}`);
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^    [A-Za-z]/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join('\n');
}

test('openapi registers chapter lock PATCH path with contract file', () => {
  const text = readFileSync(OPENAPI_ROOT, 'utf8');
  assert.ok(text.includes(`${LOCK_PATH}:`), 'openapi.yaml must register the lock path');
  assert.ok(
    text.includes('./paths/projects/chapter-lock-by-no.yaml'),
    'openapi.yaml must reference chapter-lock-by-no.yaml'
  );
  assert.ok(existsSync(LOCK_PATH_FILE), 'chapter-lock-by-no.yaml must exist');
  const pathText = readFileSync(LOCK_PATH_FILE, 'utf8');
  assert.ok(pathText.includes('patch:'), 'lock path must define a patch operation');
  assert.ok(
    pathText.includes('ChapterLockPatch'),
    'lock path must use ChapterLockPatch request body'
  );
  assert.ok(pathText.includes('ChapterItem'), 'lock path must return ChapterItem');
  assert.ok(pathText.includes('minimum: 1'), 'chapterNo must be a positive integer');
});

test('openapi chapter schemas expose isLocked with false default', () => {
  const text = readFileSync(OPENAPI_ROOT, 'utf8');
  for (const schema of ['ChapterItem', 'WorkspaceChapter']) {
    const block = extractBlock(text, `    ${schema}:`);
    assert.ok(block.includes('isLocked:'), `${schema} must declare isLocked`);
    assert.ok(block.includes('type: boolean'), `${schema}.isLocked must be boolean`);
    assert.ok(block.includes('default: false'), `${schema}.isLocked must default to false`);
  }
  const patchBlock = extractBlock(text, '    ChapterLockPatch:');
  assert.ok(patchBlock.includes('isLocked:'), 'ChapterLockPatch must declare isLocked');
  assert.ok(patchBlock.includes('type: boolean'), 'ChapterLockPatch.isLocked must be boolean');
  assert.ok(/required:\s*\n\s*- isLocked/.test(patchBlock), 'isLocked must be required');
});

test('shared-types align lock path and isLocked schemas', () => {
  const text = readFileSync(SHARED_TYPES_ROOT, 'utf8');
  assert.ok(text.includes(`'${LOCK_PATH}':`), 'shared-types must include the lock path');
  const workspaceChapter = extractBlock(text, '    WorkspaceChapter:');
  assert.ok(workspaceChapter.includes('isLocked:'), 'WorkspaceChapter must include isLocked');
  const chapterItem = extractBlock(text, '    ChapterItem:');
  assert.ok(chapterItem.includes('isLocked:'), 'ChapterItem must include isLocked');
  const patchBlock = extractBlock(text, '    ChapterLockPatch:');
  assert.ok(patchBlock.includes('isLocked:'), 'ChapterLockPatch must include isLocked');
});