import assert from 'node:assert/strict';
import test from 'node:test';
import { formatContentSafetyBlockMessage, summarizeContentSafetyHits } from './summarize';
import type { ContentSafetyHit } from './types';

const sampleHit = (overrides: Partial<ContentSafetyHit> = {}): ContentSafetyHit => ({
  ruleId: 'project:2edf3b60-1dee-4592-b54b-e4c6e60911fe',
  severity: 'medium',
  startOffset: 0,
  endOffset: 2,
  matchedText: '测试',
  normalizedMatchedText: '测试',
  action: 'rewrite_sentence',
  ...overrides,
});

test('summarizeContentSafetyHits shows matched text instead of ruleId', () => {
  const summary = summarizeContentSafetyHits([sampleHit()]);
  assert.match(summary, /「测试」/);
  assert.doesNotMatch(summary, /2edf3b60/);
});

test('summarizeContentSafetyHits dedupes repeated hits', () => {
  const summary = summarizeContentSafetyHits([
    sampleHit(),
    sampleHit({ startOffset: 10, endOffset: 12 }),
    sampleHit({ startOffset: 20, endOffset: 22 }),
  ]);
  assert.equal(summary, '中:「测试」 等 3 处');
});

test('summarizeContentSafetyHits truncates long hit lists', () => {
  const summary = summarizeContentSafetyHits([
    sampleHit({ matchedText: '甲', normalizedMatchedText: '甲' }),
    sampleHit({ matchedText: '乙', normalizedMatchedText: '乙' }),
    sampleHit({ matchedText: '丙', normalizedMatchedText: '丙' }),
    sampleHit({ matchedText: '丁', normalizedMatchedText: '丁' }),
  ]);
  assert.match(summary, /等 4 处/);
});

test('formatContentSafetyBlockMessage joins reason and summary', () => {
  const message = formatContentSafetyBlockMessage('中风险句子改写后仍未通过内容安全扫描', [
    sampleHit(),
  ]);
  assert.match(message, /中风险句子改写后仍未通过/);
  assert.match(message, /「测试」/);
});
