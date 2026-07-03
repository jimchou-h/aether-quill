import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceOutlineUserPrompt, buildCompliancePersonaBlock, buildCompliancePreScanSummary, buildForbiddenWordsSummary } from './compliance-check.util';

describe('compliance-check.util', () => {
  it('buildComplianceOutlineUserPrompt includes chapter body', () => {
    const prompt = buildComplianceOutlineUserPrompt({
      sourceText: '第一章正文',
      forbiddenWordsSummary: '词A',
    });
    assert.match(prompt, /第一章正文/);
    assert.match(prompt, /词A/);
    assert.match(prompt, /required/);
  });

  it('buildForbiddenWordsSummary lists high severity patterns', () => {
    const summary = buildForbiddenWordsSummary([
      { ruleId: 'r1', pattern: '违禁', severity: 'high', action: 'block', type: 'keyword' },
      { ruleId: 'r2', pattern: '低风险', severity: 'low', action: 'mark', type: 'keyword' },
    ]);
    assert.match(summary, /违禁/);
    assert.doesNotMatch(summary, /低风险/);
  });

  it('buildComplianceOutlineUserPrompt includes pre-scan summary when provided', () => {
    const prompt = buildComplianceOutlineUserPrompt({
      sourceText: '第一章正文',
      forbiddenWordsSummary: '词A',
      preScanSummary: '- [forbidden_word] 违禁',
    });
    assert.match(prompt, /硬规则预扫命中摘要/);
    assert.match(prompt, /违禁/);
  });

  it('buildComplianceOutlineUserPrompt includes persona block when provided', () => {
    const prompt = buildComplianceOutlineUserPrompt({
      sourceText: '第一章正文',
      forbiddenWordsSummary: '词A',
      personaBlock: '林默：黑发少年\n状态：冷静',
    });
    assert.match(prompt, /【人物卡参考】/);
    assert.match(prompt, /林默/);
  });

  it('buildCompliancePersonaBlock keeps published personas when no selection', () => {
    const block = buildCompliancePersonaBlock([
      { name: '甲', profile: '设定A', state: '平静', status: 'published' },
      { name: '乙', profile: '设定B', state: '草稿', status: 'draft' },
    ]);
    assert.match(block, /甲/);
    assert.doesNotMatch(block, /乙/);
  });

  it('buildCompliancePersonaBlock filters by selected persona names', () => {
    const personas = [
      { name: '甲', profile: '设定A', state: '平静', status: 'published' },
      { name: '乙', profile: '设定B', state: '活跃', status: 'published' },
    ];
    const block = buildCompliancePersonaBlock(personas, ['乙']);
    assert.doesNotMatch(block, /甲/);
    assert.match(block, /乙/);
  });
});
