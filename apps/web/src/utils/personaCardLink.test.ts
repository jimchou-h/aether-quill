import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLinkedPersonaCardMap,
  linkedPersonaCardTitle,
  normalizeDocumentList,
} from './personaCardLink';

test('normalizeDocumentList keeps already-unwrapped arrays', () => {
  const docs = [{ id: 'd1', title: '卡A', docType: 'persona_card', personaId: 'p1' }];
  assert.deepEqual(normalizeDocumentList(docs), docs);
});

test('normalizeDocumentList unwraps nested data envelope', () => {
  const docs = [{ id: 'd1', title: '卡A', docType: 'persona_card', personaId: 'p1' }];
  assert.deepEqual(normalizeDocumentList({ data: docs }), docs);
});

test('normalizeDocumentList returns empty array for invalid payload', () => {
  assert.deepEqual(normalizeDocumentList(null), []);
  assert.deepEqual(normalizeDocumentList({}), []);
});

test('linked map and title: bound card shows title, unbound shows 未关联', () => {
  const docs = normalizeDocumentList([
    { id: 'd1', title: '林默角色卡', docType: 'persona_card', personaId: 'p1' },
    { id: 'd2', title: '世界观', docType: 'worldview' },
  ]);
  const map = buildLinkedPersonaCardMap(docs);
  assert.equal(linkedPersonaCardTitle(map, 'p1'), '林默角色卡');
  assert.equal(linkedPersonaCardTitle(map, 'p-missing'), '未关联');
});
