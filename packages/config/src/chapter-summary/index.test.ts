import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChapterSummaryPromptRules,
  buildFallbackChapterSummary,
  formatChapterSummaryTemplate,
  normalizeChapterSummary,
  parseChapterSummaryTemplate,
} from './index';

test('formatChapterSummaryTemplate joins three labeled lines', () => {
  assert.equal(
    formatChapterSummaryTemplate({
      plot: '雨夜对峙结束',
      characters: '甲（湿衣）；乙（持刀）',
      openThreads: '谁泄露行踪',
    }),
    ['情节：雨夜对峙结束', '人物：甲（湿衣）；乙（持刀）', '未收线：谁泄露行踪'].join('\n')
  );
});

test('parseChapterSummaryTemplate accepts colon variants and extra prose', () => {
  const fields = parseChapterSummaryTemplate(
    '以下是摘要\n情节: 冲突爆发并收束\n人物：甲（受伤）\n未收线：无\n谢谢'
  );
  assert.deepEqual(fields, {
    plot: '冲突爆发并收束',
    characters: '甲（受伤）',
    openThreads: '无',
  });
});

test('normalizeChapterSummary returns null when a label is missing', () => {
  assert.equal(normalizeChapterSummary('情节：只有情节\n人物：甲'), null);
  assert.equal(normalizeChapterSummary(''), null);
});

test('normalizeChapterSummary reformats valid output', () => {
  const got = normalizeChapterSummary('情节：  A  \n人物：B\n未收线：无');
  assert.equal(got, ['情节：A', '人物：B', '未收线：无'].join('\n'));
});

test('buildFallbackChapterSummary uses template for empty content', () => {
  assert.equal(
    buildFallbackChapterSummary('  \n'),
    ['情节：暂无摘要（章节内容为空）', '人物：待补全', '未收线：待补全'].join('\n')
  );
});

test('buildFallbackChapterSummary truncates plot excerpt', () => {
  const content = '章'.repeat(200);
  const summary = buildFallbackChapterSummary(content);
  assert.ok(summary.startsWith('情节：'));
  assert.ok(summary.includes('\n人物：待补全\n未收线：待补全'));
  assert.ok(summary.includes('...'));
});

test('buildChapterSummaryPromptRules mentions fixed labels and length', () => {
  const rules = buildChapterSummaryPromptRules().join('\n');
  assert.ok(rules.includes('情节：'));
  assert.ok(rules.includes('人物：'));
  assert.ok(rules.includes('未收线：'));
  assert.ok(rules.includes('180~280'));
});
