import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAutoFixes,
  applyAutoRuleFix,
  getDefaultFixStrategy,
  normalizeRuleIssues,
  scanPipelineRules,
} from './chapter-pipeline-rule-classifier';
import { shouldApplyAutoFix } from './chapter-pipeline.util';
import type { PipelineRuleIssue } from './chapter-pipeline.util';

test('scanPipelineRules detects explanatory parenthetical', () => {
  const text = '他走了。（换句话说，这意味着一切结束了）';
  const issues = scanPipelineRules(text, [], true, 'auto');
  assert.ok(issues.some((i) => i.category === 'explanatory_text'));
});

test('applyAutoFixes removes pronoun mismatch in semi mode', () => {
  const text = '房间里，男人缓缓转身。';
  const issues = scanPipelineRules(text, [], false, 'semi', '林默');
  const { text: fixed, issues: updated } = applyAutoFixes(text, issues, 'semi', '林默');
  assert.ok(fixed.includes('林默'));
  assert.ok(!fixed.includes('男人'));
  assert.ok(updated.some((i) => i.fixed));
});

test('scanPipelineRules flags pronoun mismatch', () => {
  const text = '房间里，男人缓缓转身。';
  const issues = scanPipelineRules(text, [], false, 'auto');
  assert.ok(issues.some((i) => i.category === 'pronoun_mismatch'));
});

test('applyAutoRuleFix replaces pronoun mismatch with protagonist name', () => {
  const text = '房间里，男人缓缓转身。';
  const issues = scanPipelineRules(text, [], false, 'auto', '张三');
  const issue = issues.find((i) => i.category === 'pronoun_mismatch');
  assert.ok(issue);
  const fixed = applyAutoRuleFix(text, issue as PipelineRuleIssue, '张三');
  assert.ok(fixed.includes('张三缓缓转身'));
  assert.ok(!fixed.includes('男人'));
});

test('contextual categories default to ai_segment fixStrategy', () => {
  assert.equal(getDefaultFixStrategy('fluid_oral_contact'), 'ai_segment');
  assert.equal(getDefaultFixStrategy('multi_pov'), 'ai_segment');
  assert.equal(getDefaultFixStrategy('forbidden_word'), 'auto');
});

test('semi mode auto-fixes deterministic pronoun and forbidden_word', () => {
  const pronoun: import('./chapter-pipeline.util').PipelineRuleIssue = {
    id: 'pronoun_mismatch-1',
    category: 'pronoun_mismatch',
    text: '男人',
    context: '',
    fixStrategy: 'auto',
    startOffset: 0,
    endOffset: 2,
    source: 'deterministic',
  };
  const forbidden: import('./chapter-pipeline.util').PipelineRuleIssue = {
    id: 'forbidden-x-0',
    category: 'forbidden_word',
    text: '词',
    context: '',
    fixStrategy: 'auto',
    startOffset: 0,
    endOffset: 1,
    source: 'deterministic',
  };
  assert.equal(shouldApplyAutoFix(pronoun, 'semi'), true);
  assert.equal(shouldApplyAutoFix(forbidden, 'semi'), true);
});

test('applyAutoFixes removes forbidden word in semi mode', () => {
  const text = '前文禁用演示词后文';
  const issues = scanPipelineRules(
    text,
    [{ ruleId: 'custom-1', pattern: '禁用演示词', severity: 'medium', action: 'mark', type: 'keyword' }],
    true,
    'semi'
  );
  const { text: fixed, issues: updated } = applyAutoFixes(text, issues, 'semi');
  assert.ok(!fixed.includes('禁用演示词'));
  assert.ok(updated.some((i) => i.category === 'forbidden_word' && i.fixed));
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
