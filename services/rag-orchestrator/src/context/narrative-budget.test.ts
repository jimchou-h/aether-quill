import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyHeadCharBudget,
  applyOutlineBudget,
  clampNarrativeBlockMaxChars,
} from './narrative-budget';

describe('narrative-budget', () => {
  it('clamps budgets', () => {
    assert.equal(clampNarrativeBlockMaxChars(-1, 4000), 0);
    assert.equal(clampNarrativeBlockMaxChars(99999, 4000, 8000), 8000);
    assert.equal(clampNarrativeBlockMaxChars('x', 4000), 4000);
  });

  it('keeps short outline full', () => {
    const r = applyOutlineBudget('短大纲', 100, '港口');
    assert.equal(r.mode, 'full');
    assert.equal(r.text, '短大纲');
  });

  it('sections long outline with query', () => {
    const outline = [
      '无关段落甲。',
      '无关段落乙。',
      '旧港口走私航线与码头帮派对峙。',
      '无关段落丙。',
      '无关段落丁。',
    ].join('\n\n');
    const r = applyOutlineBudget(outline, 36, '旧港口走私');
    assert.notEqual(r.mode, 'full');
    assert.ok(r.text.length < outline.length);
    assert.ok(r.text.length > 0);
  });

  it('head-truncates without query', () => {
    const r = applyOutlineBudget('一二三四五六七八九十'.repeat(10), 20);
    assert.equal(r.mode, 'truncated');
    assert.ok(r.text.includes('已按预算截断'));
  });

  it('omits when budget is 0', () => {
    assert.equal(applyOutlineBudget('大纲', 0).mode, 'omitted');
    assert.equal(applyHeadCharBudget('abc', 0), '');
  });
});
