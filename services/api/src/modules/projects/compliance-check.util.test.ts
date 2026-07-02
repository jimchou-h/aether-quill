import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceOutlineUserPrompt, buildForbiddenWordsSummary } from './compliance-check.util';

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
});
