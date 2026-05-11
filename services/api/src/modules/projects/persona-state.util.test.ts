import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFallbackPersonaState,
  normalizePersonaStateOutput,
  trimForPrompt,
} from './persona-state.util';

test('buildFallbackPersonaState returns placeholder for empty content', () => {
  assert.equal(buildFallbackPersonaState(3, '   \n\t'), '第3章已更新，状态待补充');
});

test('buildFallbackPersonaState uses first sentence from chapter content', () => {
  assert.equal(
    buildFallbackPersonaState(5, '他端起酒杯一饮而尽。随后沉默。'),
    '第5章后：他端起酒杯一饮而尽'
  );
});

test('trimForPrompt keeps short content intact', () => {
  assert.equal(trimForPrompt('短文本', 10), '短文本');
});

test('trimForPrompt truncates long content with marker', () => {
  const content = '章'.repeat(20);
  const trimmed = trimForPrompt(content, 10);
  assert.equal(trimmed, `${'章'.repeat(10)}\n...(已截断)`);
});

test('normalizePersonaStateOutput strips label and blank lines', () => {
  assert.equal(normalizePersonaStateOutput('人物状态：已饮酒，情绪失控'), '已饮酒，情绪失控');
  assert.equal(normalizePersonaStateOutput('\n\n  清醒，尚未饮酒  \n'), '清醒，尚未饮酒');
  assert.equal(normalizePersonaStateOutput('   '), null);
});
