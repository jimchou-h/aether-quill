import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trimTextsToTokenBudget } from './token-budget';

describe('trimTextsToTokenBudget', () => {
  it('keeps blocks within budget', () => {
    const out = trimTextsToTokenBudget(['短文本A', '短文本B'], 500);
    assert.equal(out.length, 2);
  });

  it('stops when budget exceeded', () => {
    const long = '这是一段很长的测试文本。'.repeat(200);
    const out = trimTextsToTokenBudget([long, '尾部'], 10);
    assert.equal(out.length, 0);
  });
});
