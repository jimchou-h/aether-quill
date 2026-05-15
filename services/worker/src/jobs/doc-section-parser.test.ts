import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inferDocType, parseDocumentSections, sectionsForIngestion } from './doc-section-parser';

describe('inferDocType', () => {
  it('detects persona_card from title', () => {
    assert.equal(inferDocType('人物小传：林策', ''), 'persona_card');
  });

  it('detects world_doc', () => {
    assert.equal(inferDocType('世界观：旧港口', ''), 'world_doc');
  });
});

describe('parseDocumentSections', () => {
  it('splits by Chinese section headers', () => {
    const content = ['【身份】', '少年剑客', '', '【关系】', '师父：老周'].join('\n');
    const sections = parseDocumentSections(content);
    assert.ok(sections.length >= 2);
    assert.equal(sections[0].section, 'identity');
    assert.ok(sections[0].content.includes('少年剑客'));
    assert.equal(sections[1].section, 'relationship');
  });
});

describe('sectionsForIngestion', () => {
  it('returns multiple sections for persona_card', () => {
    const content = ['【身份】', 'A', '', '【背景】', 'B'].join('\n');
    const sections = sectionsForIngestion('林策角色卡', content, 'persona_card');
    assert.ok(sections.length >= 2);
  });
});
