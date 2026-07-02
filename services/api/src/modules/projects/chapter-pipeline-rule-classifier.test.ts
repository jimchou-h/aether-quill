import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAutoFixes,
  applyAutoRuleFix,
  getDefaultFixStrategy,
  normalizeRuleIssues,
  scanPipelineRules,
} from './chapter-pipeline-rule-classifier';
import { shouldApplyAiSegmentFix, shouldApplyAutoFix } from './chapter-pipeline.util';
import type { PipelineRuleIssue } from './chapter-pipeline.util';

test('scanPipelineRules returns empty when content safety scan disabled', () => {
  const text = '他走了。（换句话说，这意味着一切结束了）房间里，男人缓缓转身。';
  const issues = scanPipelineRules(text, [], false, 'auto');
  assert.equal(issues.length, 0);
});

test('scanPipelineRules does not apply hardcoded regex rules when scan enabled', () => {
  const text = '房间里，男人缓缓转身。（换句话说，这意味着一切结束了）';
  const issues = scanPipelineRules(text, [], true, 'auto');
  assert.equal(issues.length, 0);
});

test('applyAutoFixes removes pronoun mismatch in semi mode', () => {
  const text = '房间里，男人缓缓转身。';
  const issues: PipelineRuleIssue[] = [
    {
      id: 'pronoun_mismatch-1',
      category: 'pronoun_mismatch',
      text: '男人',
      context: '',
      fixStrategy: 'auto',
      startOffset: 4,
      endOffset: 6,
      fixed: false,
      source: 'deterministic',
    },
  ];
  const { text: fixed, issues: updated } = applyAutoFixes(text, issues, 'semi', '林默');
  assert.ok(fixed.includes('林默'));
  assert.ok(!fixed.includes('男人'));
  assert.ok(updated.some((i) => i.fixed));
});

test('applyAutoRuleFix replaces pronoun mismatch with protagonist name', () => {
  const text = '房间里，男人缓缓转身。';
  const issue: PipelineRuleIssue = {
    id: 'pronoun_mismatch-1',
    category: 'pronoun_mismatch',
    text: '男人',
    context: '',
    fixStrategy: 'auto',
    startOffset: 4,
    endOffset: 6,
    fixed: false,
    source: 'llm',
  };
  const fixed = applyAutoRuleFix(text, issue, '张三');
  assert.ok(fixed.includes('张三缓缓转身'));
  assert.ok(!fixed.includes('男人'));
});

test('category default fix strategies remain for LLM issues', () => {
  assert.equal(getDefaultFixStrategy('fluid_oral_contact'), 'ai_segment');
  assert.equal(getDefaultFixStrategy('multi_pov'), 'ai_segment');
  assert.equal(getDefaultFixStrategy('forbidden_word'), 'auto');
});

test('semi mode auto-fixes deterministic pronoun and replaceable forbidden_word', () => {
  const pronoun: PipelineRuleIssue = {
    id: 'pronoun_mismatch-1',
    category: 'pronoun_mismatch',
    text: '男人',
    context: '',
    fixStrategy: 'auto',
    startOffset: 0,
    endOffset: 2,
    source: 'deterministic',
  };
  const forbidden: PipelineRuleIssue = {
    id: 'forbidden-x-0',
    category: 'forbidden_word',
    text: '词',
    context: '',
    fixStrategy: 'auto',
    startOffset: 0,
    endOffset: 1,
    source: 'deterministic',
    replacement: '替换词',
  };
  assert.equal(shouldApplyAutoFix(pronoun, 'semi'), true);
  assert.equal(shouldApplyAutoFix(forbidden, 'semi'), true);
});

test('applyAutoFixes replaces forbidden word when rule has replacement', () => {
  const text = '前文禁用演示词后文';
  const issues = scanPipelineRules(
    text,
    [
      {
        ruleId: 'custom-1',
        pattern: '禁用演示词',
        severity: 'low',
        action: 'replace',
        type: 'keyword',
        replacement: '合规词',
      },
    ],
    true,
    'semi'
  );
  const { text: fixed, issues: updated } = applyAutoFixes(text, issues, 'semi');
  assert.ok(fixed.includes('合规词'));
  assert.ok(!fixed.includes('禁用演示词'));
  assert.ok(updated.some((i) => i.category === 'forbidden_word' && i.fixed));
});

test('applyAutoFixes does not delete medium forbidden word without replacement', () => {
  const text = '前文禁用演示词后文';
  const issues = scanPipelineRules(
    text,
    [
      {
        ruleId: 'custom-1',
        pattern: '禁用演示词',
        severity: 'medium',
        action: 'rewrite_sentence',
        type: 'keyword',
      },
    ],
    true,
    'auto'
  );
  const { text: fixed, issues: updated } = applyAutoFixes(text, issues, 'auto');
  assert.equal(fixed, text);
  assert.ok(updated.every((i) => i.category !== 'forbidden_word' || !i.fixed));
  assert.equal(issues[0]?.fixStrategy, 'ai_segment');
});

test('semi mode schedules ai_segment fix for medium forbidden words', () => {
  const issues = scanPipelineRules(
    '前文禁用演示词后文',
    [
      {
        ruleId: 'custom-1',
        pattern: '禁用演示词',
        severity: 'medium',
        action: 'rewrite_sentence',
        type: 'keyword',
      },
    ],
    true,
    'semi'
  );
  assert.equal(issues[0]?.fixStrategy, 'ai_segment');
  assert.equal(shouldApplyAiSegmentFix(issues[0]!, 'semi'), true);
  assert.equal(shouldApplyAiSegmentFix(issues[0]!, 'manual'), false);
});

test('normalizeRuleIssues maps LLM issues to category defaults in semi mode', () => {
  const issues: PipelineRuleIssue[] = [
    {
      id: 'llm-1',
      category: 'fluid_oral_contact',
      text: '示例',
      context: '上下文',
      fixStrategy: 'manual',
      startOffset: 0,
      endOffset: 2,
      fixed: false,
    },
  ];
  const normalized = normalizeRuleIssues(issues, 'semi');
  assert.equal(normalized[0].fixStrategy, 'ai_segment');
});
