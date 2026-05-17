import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFallbackPersonaState,
  clampPersonaStateText,
  normalizePersonaStateOutput,
  parseChapterPersonaStatesFromModelContent,
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

test('clampPersonaStateText truncates long state', () => {
  const longState = '状'.repeat(80);
  assert.equal(clampPersonaStateText(longState).length, 60);
});

test('parseChapterPersonaStatesFromModelContent parses fenced json array', () => {
  const raw = '```json\n[{"name":"叶辰","appeared":true,"state":"重伤昏迷"},{"name":"清歌","appeared":false,"state":"未出场"}]\n```';
  const items = parseChapterPersonaStatesFromModelContent(raw);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { name: '叶辰', appeared: true, state: '重伤昏迷' });
  assert.deepEqual(items[1], { name: '清歌', appeared: false, state: '未出场' });
});

test('parseChapterPersonaStatesFromModelContent parses personas wrapper', () => {
  const items = parseChapterPersonaStatesFromModelContent({
    personas: [{ name: '林月', appeared: true, state: '已离开宗门' }],
  });
  assert.deepEqual(items, [{ name: '林月', appeared: true, state: '已离开宗门' }]);
});

test('parseChapterPersonaStatesFromModelContent skips invalid entries', () => {
  const items = parseChapterPersonaStatesFromModelContent([
    { name: '', appeared: true, state: '无效' },
    { name: '有效', appeared: false, state: '' },
    { name: '有效', appeared: true, state: '有效状态' },
  ]);
  assert.deepEqual(items, [{ name: '有效', appeared: true, state: '有效状态' }]);
});
