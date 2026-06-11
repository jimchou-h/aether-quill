import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChapterIdentityRelationExtractPrompt,
  parseIdentityRelationsFromModelContent,
} from './identity-relation-extract';

test('buildChapterIdentityRelationExtractPrompt includes persona names', () => {
  const prompt = buildChapterIdentityRelationExtractPrompt({
    chapterNo: 3,
    title: '师徒',
    content: '正文',
    personaNames: ['沈镜川', '叶清歌'],
  });
  assert.ok(prompt.includes('沈镜川'));
  assert.ok(prompt.includes('稳定身份关系'));
});

test('parseIdentityRelationsFromModelContent parses array', () => {
  const items = parseIdentityRelationsFromModelContent(
    JSON.stringify([
      { from: '沈镜川', to: '叶清歌', relation: '师父', evidenceSnippet: '叫了声师父' },
    ])
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.relation, '师父');
});

test('parseIdentityRelationsFromModelContent parses fenced json', () => {
  const items = parseIdentityRelationsFromModelContent(
    '```json\n[{"from":"A","to":"B","relation":"恋人"}]\n```'
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.from, 'A');
});

test('parseIdentityRelationsFromModelContent skips invalid rows', () => {
  const items = parseIdentityRelationsFromModelContent(
    JSON.stringify([
      { from: 'A', to: 'A', relation: '自己' },
      { from: '', to: 'B', relation: '友人' },
      { from: 'A', to: 'B', relation: '同门' },
    ])
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.relation, '同门');
});
