import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractPersonaDisplayName,
  formatMultiPersonaEvidencePreamble,
  formatPersonaCardEvidenceBlock,
  hasMultiPersonaCardEvidence,
  prependMultiPersonaPreamble,
} from './persona-card-evidence';

describe('extractPersonaDisplayName', () => {
  it('parses common persona card titles', () => {
    assert.equal(extractPersonaDisplayName('人物小传：林策'), '林策');
    assert.equal(extractPersonaDisplayName('苏晚角色卡'), '苏晚');
    assert.equal(extractPersonaDisplayName('世界观设定'), '世界观设定');
  });
});

describe('formatPersonaCardEvidenceBlock', () => {
  it('includes canonical_character boundary markers', () => {
    const block = formatPersonaCardEvidenceBlock({
      documentId: 'd1',
      title: '人物小传：林策',
      content: '马甲：夜鸦',
      reason: '标题匹配',
    });
    assert.ok(block.includes('canonical_character=林策'));
    assert.ok(block.includes('马甲：夜鸦'));
    assert.ok(block.includes('角色卡·林策·结束'));
  });
});

describe('multi persona preamble', () => {
  it('adds preamble when count >= 2', () => {
    const preamble = formatMultiPersonaEvidencePreamble(2);
    assert.ok(preamble.includes('多角色设定须知'));
    const combined = prependMultiPersonaPreamble('block-a\n\nblock-b', 2);
    assert.ok(combined.startsWith('【多角色设定须知】'));
  });

  it('detects multiple persona blocks in evidence', () => {
    const evidence = [
      formatPersonaCardEvidenceBlock({
        documentId: 'a',
        title: '人物小传：甲',
        content: '甲设定',
      }),
      formatPersonaCardEvidenceBlock({
        documentId: 'b',
        title: '人物小传：乙',
        content: '乙设定',
      }),
    ].join('\n\n');
    assert.equal(hasMultiPersonaCardEvidence(evidence), true);
  });
});
