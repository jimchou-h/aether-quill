import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inferDocumentKnowledgeType } from './documents-type.util';

describe('inferDocumentKnowledgeType', () => {
  it('returns persona_card for character sheets', () => {
    assert.equal(inferDocumentKnowledgeType('林策角色卡', ''), 'persona_card');
  });

  it('returns document for generic notes', () => {
    assert.equal(inferDocumentKnowledgeType('杂项笔记', '随便记点东西'), 'document');
  });
});
