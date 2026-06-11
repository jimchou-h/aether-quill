import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeIdentityRelationCandidates,
  normalizeIdentityRelationDedupeKey,
  parseExtractedIdentityRelationCandidates,
} from './identity-relation.util';

test('parseExtractedIdentityRelationCandidates parses relations wrapper', () => {
  const items = parseExtractedIdentityRelationCandidates({
    relations: [{ from: '沈镜川', to: '叶清歌', relation: '师父' }],
  });
  assert.equal(items.length, 1);
});

test('mergeIdentityRelationCandidates adds and dedupes', () => {
  const personas = [
    { id: 'p1', name: '沈镜川' },
    { id: 'p2', name: '叶清歌' },
  ];

  const first = mergeIdentityRelationCandidates({
    projectId: 'proj',
    chapterNo: 3,
    existing: [],
    candidates: [{ from: '沈镜川', to: '叶清歌', relation: '师父' }],
    personas,
    now: new Date('2026-01-01'),
  });

  assert.equal(first.addedCount, 1);
  assert.equal(first.records.length, 1);

  const second = mergeIdentityRelationCandidates({
    projectId: 'proj',
    chapterNo: 5,
    existing: first.records,
    candidates: [{ from: '沈镜川', to: '叶清歌', relation: '师父', evidenceSnippet: '证据' }],
    personas,
    now: new Date('2026-01-02'),
  });

  assert.equal(second.addedCount, 0);
  assert.equal(second.updatedCount, 1);
  assert.equal(second.records.length, 1);
  assert.equal(second.records[0]?.chapterNo, 5);
});

test('normalizeIdentityRelationDedupeKey collapses whitespace', () => {
  const key = normalizeIdentityRelationDedupeKey({
    fromPersonaId: 'a',
    toPersonaId: 'b',
    relation: '师 父',
  });
  assert.equal(key, 'a|b|师父');
});
