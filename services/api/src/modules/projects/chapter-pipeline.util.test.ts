import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRuleSegmentFix,
  getPipelineInputText,
  mergePipelineConfig,
  relocateRuleIssuesInText,
  resolvePipelineApplyText,
  resolveProtagonistContext,
  resolveRuleIssueSpanStrict,
  sanitizeRuleIssuesForText,
  sanitizeSensoryOutlineWithContentScan,
  type ChapterPipelineSession,
  type PipelineRuleIssue,
} from './chapter-pipeline.util';
import type { ContentSafetyRule } from '@aether-quill/config';

test('getPipelineInputText uses version chain', () => {
  const session: ChapterPipelineSession = {
    sessionId: 's1',
    projectId: 'p1',
    chapterNo: 5,
    sourceText: 'original',
    sourceUpdatedAt: new Date().toISOString(),
    versions: {
      original: 'original',
      afterCharacter: 'version-a',
      afterSensory: 'version-b',
      afterRules: 'version-c',
      final: 'version-final',
    },
    config: {
      pipelinePreset: 'full',
      pipelineSkipSensoryOutlineReview: false,
      pipelineRulesFixMode: 'semi',
      pipelineHomogenizationEnabled: false,
      pipelineHomogenizationPriorChapterCount: 3,
      pipelineEnabledModules: [1, 2, 3],
    },
    currentModule: 4,
    traceIds: {},
    createdAt: new Date(),
  };

  assert.equal(getPipelineInputText(session, 1), 'original');
  assert.equal(getPipelineInputText(session, 2), 'version-a');
  assert.equal(getPipelineInputText(session, 3), 'version-b');
  assert.equal(getPipelineInputText(session, 4), 'version-c');
});

test('resolvePipelineApplyText prefers final when requested', () => {
  const session: ChapterPipelineSession = {
    sessionId: 's1',
    projectId: 'p1',
    chapterNo: 1,
    sourceText: 'o',
    sourceUpdatedAt: new Date().toISOString(),
    versions: { original: 'o', afterRules: 'c', final: 'f' },
    config: {
      pipelinePreset: 'full',
      pipelineSkipSensoryOutlineReview: false,
      pipelineRulesFixMode: 'semi',
      pipelineHomogenizationEnabled: false,
      pipelineHomogenizationPriorChapterCount: 3,
      pipelineEnabledModules: [1, 2, 3],
    },
    currentModule: 'done',
    traceIds: {},
    createdAt: new Date(),
  };
  assert.equal(resolvePipelineApplyText(session, 'final'), 'f');
  assert.equal(resolvePipelineApplyText(session, 'afterRules'), 'f');
});

test('mergePipelineConfig removes module 4 when homogenization disabled', () => {
  const config = mergePipelineConfig(
    { pipelinePreset: 'full', pipelineHomogenizationEnabled: false },
    {}
  );
  assert.deepEqual(config.pipelineEnabledModules, [1, 2, 3]);
});

test('resolveProtagonistContext includes unlock rules', () => {
  const block = resolveProtagonistContext(10, [
    {
      abilityKey: '飞行',
      unlockAtChapter: 8,
      descriptionForPrompt: '可在空中飞行',
    },
  ]);
  assert.match(block, /第 10 章/);
  assert.match(block, /飞行/);
  assert.match(block, /已解锁/);
});

test('resolveRuleIssueSpanStrict requires exact offset match', () => {
  const text = '前文删除段落后文仍有男人转身';
  const issue: PipelineRuleIssue = {
    id: 'pronoun-1',
    category: 'pronoun_mismatch',
    text: '男人',
    context: '仍有男人转身',
    fixStrategy: 'auto',
    startOffset: 20,
    endOffset: 22,
    fixed: false,
    source: 'deterministic',
  };
  assert.equal(resolveRuleIssueSpanStrict(text, issue), null);
  const located = resolveRuleIssueSpanStrict(text, {
    ...issue,
    startOffset: text.indexOf('男人'),
    endOffset: text.indexOf('男人') + 2,
  });
  assert.ok(located);
});

test('applyRuleSegmentFix replaces located violation text', () => {
  const text = '他看着她，后入时低头吻住了她的唇。';
  const issue: PipelineRuleIssue = {
    id: 'rear-1',
    category: 'rear_kiss',
    text: '后入时低头吻',
    context: '看着她，后入时低头吻住了她的唇',
    fixStrategy: 'ai_segment',
    startOffset: 4,
    endOffset: 11,
    fixed: false,
  };
  const { text: fixed, applied } = applyRuleSegmentFix(text, issue, '从身后贴近，在她耳边低语');
  assert.equal(applied, true);
  assert.ok(fixed.includes('从身后贴近'));
  assert.ok(!fixed.includes('后入时低头吻'));
});

test('relocateRuleIssuesInText updates offsets when exact match exists', () => {
  const text = 'alpha beta gamma';
  const start = text.indexOf('beta');
  const issues: PipelineRuleIssue[] = [
    {
      id: 'i1',
      category: 'explanatory_text',
      text: 'beta',
      context: 'alpha beta gamma',
      fixStrategy: 'ai_segment',
      startOffset: start,
      endOffset: start + 4,
      fixed: false,
      source: 'deterministic',
    },
  ];
  const relocated = relocateRuleIssuesInText(text, issues);
  assert.equal(relocated[0].startOffset, start);
  assert.equal(relocated[0].endOffset, start + 4);
});

test('sanitizeRuleIssuesForText drops issues that cannot be located in text', () => {
  const text = 'alpha beta gamma';
  const issues: PipelineRuleIssue[] = [
    {
      id: 'i1',
      category: 'forbidden_word',
      text: 'missing',
      context: '',
      fixStrategy: 'auto',
      startOffset: 50,
      endOffset: 57,
      fixed: false,
    },
  ];
  assert.equal(sanitizeRuleIssuesForText(text, issues).length, 0);
});

test('sanitizeRuleIssuesForText forces llm issues to manual', () => {
  const text = 'alpha beta gamma';
  const issues: PipelineRuleIssue[] = [
    {
      id: 'issue-1',
      category: 'explanatory_text',
      text: 'beta',
      context: 'alpha beta gamma',
      fixStrategy: 'auto',
      startOffset: 6,
      endOffset: 10,
      fixed: false,
      source: 'llm',
    },
  ];
  const sanitized = sanitizeRuleIssuesForText(text, issues);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].fixStrategy, 'manual');
});

test('sanitizeRuleIssuesForText downgrades oversized auto explanatory_text to manual', () => {
  const violation = `（换句话说，${'很长'.repeat(80)}）`;
  const text = `前文${violation}后文`;
  const issues: PipelineRuleIssue[] = [
    {
      id: 'i1',
      category: 'explanatory_text',
      text: violation,
      context: text,
      fixStrategy: 'auto',
      startOffset: 2,
      endOffset: 2 + violation.length,
      fixed: false,
      source: 'deterministic',
    },
  ];
  const sanitized = sanitizeRuleIssuesForText(text, issues);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].fixStrategy, 'manual');
});

test('applyRuleSegmentFix replaces only violation span without deleting surrounding window', () => {
  const prefix = 'A'.repeat(300);
  const suffix = 'B'.repeat(300);
  const text = `${prefix}后入时低头吻住了她的唇。${suffix}`;
  const issue: PipelineRuleIssue = {
    id: 'rear-1',
    category: 'rear_kiss',
    text: '后入时低头吻',
    context: '后入时低头吻住了她的唇',
    fixStrategy: 'ai_segment',
    startOffset: prefix.length,
    endOffset: prefix.length + 7,
    fixed: false,
  };
  const { text: fixed, applied } = applyRuleSegmentFix(text, issue, '从身后贴近低语');
  assert.equal(applied, true);
  assert.ok(fixed.startsWith(prefix));
  assert.ok(fixed.endsWith(suffix));
  assert.ok(fixed.includes('从身后贴近低语'));
});

const testForbiddenRule: ContentSafetyRule = {
  ruleId: 'test-forbidden',
  severity: 'high',
  action: 'mark',
  type: 'keyword',
  pattern: '违禁词',
};

test('sanitizeSensoryOutlineWithContentScan demotes required items with forbidden words', () => {
  const result = sanitizeSensoryOutlineWithContentScan(
    {
      required: [{ id: 'r1', text: '加强触觉描写', priority: 'required' }],
      suggested: [{ id: 's1', text: '避免使用违禁词', priority: 'suggested' }],
    },
    [testForbiddenRule],
    true
  );

  assert.equal(result.required.length, 1);
  assert.equal(result.required[0]?.id, 'r1');
  assert.equal(result.required[0]?.contentWarnings, undefined);

  assert.equal(result.suggested.length, 1);
  assert.equal(result.suggested[0]?.id, 's1');
  assert.equal(result.suggested[0]?.priority, 'suggested');
  assert.deepEqual(result.suggested[0]?.contentWarnings, ['禁用词：违禁词']);
});

test('sanitizeSensoryOutlineWithContentScan skips scan when disabled', () => {
  const result = sanitizeSensoryOutlineWithContentScan(
    {
      required: [{ id: 'r1', text: '含违禁词', priority: 'required' }],
      suggested: [],
    },
    [testForbiddenRule],
    false
  );

  assert.equal(result.required.length, 1);
  assert.equal(result.required[0]?.contentWarnings, undefined);
  assert.equal(result.suggested.length, 0);
});
