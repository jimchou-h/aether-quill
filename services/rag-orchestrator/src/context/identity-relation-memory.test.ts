import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityRelationMemoryBlock } from './identity-relation-memory';

test('buildIdentityRelationMemoryBlock formats relations', () => {
  const block = buildIdentityRelationMemoryBlock([
    { fromName: '沈镜川', toName: '叶清歌', relation: '师父' },
  ]);
  assert.ok(block.includes('【人物身份关系】'));
  assert.ok(block.includes('沈镜川 → 叶清歌：师父'));
});

test('buildIdentityRelationMemoryBlock returns empty for no relations', () => {
  assert.equal(buildIdentityRelationMemoryBlock([]), '');
});
