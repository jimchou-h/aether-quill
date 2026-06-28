import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeContentSafetyRules,
  projectContentSafetyRuleToEngineRule,
  sanitizeProjectContentSafetyRules,
  validateProjectContentSafetyRulesInput,
} from './project-rules';
import { DEFAULT_CONTENT_SAFETY_RULES } from './rules';

test('projectContentSafetyRuleToEngineRule maps severity to action', () => {
  assert.equal(
    projectContentSafetyRuleToEngineRule({
      id: 'a',
      pattern: '测试词',
      severity: 'high',
      enabled: true,
    }).action,
    'block'
  );
  assert.equal(
    projectContentSafetyRuleToEngineRule({
      id: 'b',
      pattern: '测试词',
      severity: 'medium',
      enabled: true,
    }).action,
    'rewrite_sentence'
  );
  assert.equal(
    projectContentSafetyRuleToEngineRule({
      id: 'c',
      pattern: '测试词',
      severity: 'low',
      enabled: true,
    }).action,
    'mark'
  );
});

test('mergeContentSafetyRules merges enabled project rules after system rules', () => {
  const merged = mergeContentSafetyRules([
    { id: '1', pattern: '自定义词', severity: 'low', enabled: true },
    { id: '2', pattern: '禁用', severity: 'high', enabled: false },
  ]);
  assert.equal(merged.length, DEFAULT_CONTENT_SAFETY_RULES.length + 1);
  assert.equal(merged[merged.length - 1]?.ruleId, 'project:1');
});

test('validateProjectContentSafetyRulesInput rejects invalid payload', () => {
  assert.equal(validateProjectContentSafetyRulesInput({}).ok, false);
  assert.equal(
    validateProjectContentSafetyRulesInput([
      { id: 'x', pattern: '', severity: 'low', enabled: true },
    ]).ok,
    false
  );
});

test('validateProjectContentSafetyRulesInput accepts valid rules', () => {
  const result = validateProjectContentSafetyRulesInput([
    { id: 'x', pattern: '违禁', severity: 'high', enabled: true },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.rules.length, 1);
  }
});

test('sanitizeProjectContentSafetyRules drops invalid rows', () => {
  assert.equal(
    sanitizeProjectContentSafetyRules([
      { id: 'ok', pattern: '词', severity: 'low' },
      { id: '', pattern: 'x', severity: 'low' },
      null,
    ]).length,
    1
  );
});
