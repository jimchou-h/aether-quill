/**
 * 分步精修模块三：规则扫描与分级修复（AQ-276）
 */

import { scanContentSafety, type ContentSafetyRule } from '@aether-quill/config';
import type {
  PipelineFixStrategy,
  PipelineRuleCategory,
  PipelineRuleIssue,
} from './chapter-pipeline.util';
import {
  MAX_AUTO_FIX_SPAN_BY_CATEGORY,
  resolveRuleIssueSpanStrict,
  shouldApplyAutoFix,
} from './chapter-pipeline.util';

const DEFAULT_FIX_STRATEGY: Record<PipelineRuleCategory, PipelineFixStrategy> = {
  forbidden_word: 'auto',
  explanatory_text: 'manual',
  pronoun_mismatch: 'auto',
  gendered_word_male: 'auto',
  fluid_oral_contact: 'ai_segment',
  rear_kiss: 'ai_segment',
  position_teleport: 'ai_segment',
  multi_pov: 'ai_segment',
};

const EXPLANATORY_PATTERNS = [
  /（[^）]{0,80}(?:也就是说|换句话说|这意味着|事实上)[^）]{0,80}）/g,
  /【[^】]{0,80}(?:解释|说明)[^】]{0,80}】/g,
];

const GENDERED_MALE_PATTERNS = [
  { pattern: /他(?:娇喘|呻吟|浪叫)/g, label: '男性使用女性化描写' },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPronounMismatchPattern(protagonistName: string): RegExp {
  const escaped = escapeRegExp(protagonistName);
  return new RegExp(`(?<!${escaped})男人(?!${escaped})`, 'g');
}

function buildContextualPatterns(protagonistName: string): Array<{
  category: PipelineRuleCategory;
  pattern: RegExp;
}> {
  const protagonist = escapeRegExp(protagonistName);
  return [
    {
      category: 'fluid_oral_contact',
      pattern: new RegExp(`精液.{0,20}(?:${protagonist}|他).{0,10}(?:唇|嘴|口)`, 'g'),
    },
    {
      category: 'rear_kiss',
      pattern: /后入.{0,30}吻/g,
    },
    {
      category: 'position_teleport',
      pattern: /(?:趴着|跪着).{0,20}(?:面对面|正面)/g,
    },
    {
      category: 'multi_pov',
      pattern: new RegExp(
        `(?:${protagonist}|他).{0,40}(?:她|对方).{0,40}(?:心想|感到|觉得)`,
        'g'
      ),
    },
  ];
}

function resolveIssueFixStrategy(
  category: PipelineRuleCategory,
  rulesFixMode: 'auto' | 'semi' | 'manual'
): PipelineFixStrategy {
  if (rulesFixMode === 'manual') {
    return 'manual';
  }
  return getDefaultFixStrategy(category);
}

function findAllMatches(
  text: string,
  pattern: RegExp,
  category: PipelineRuleCategory,
  fixStrategy: PipelineFixStrategy,
  issueText?: string
): PipelineRuleIssue[] {
  const issues: PipelineRuleIssue[] = [];
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = globalPattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const contextStart = Math.max(0, start - 40);
    const contextEnd = Math.min(text.length, end + 40);
    issues.push({
      id: `${category}-${index + 1}`,
      category,
      text: issueText ?? match[0],
      context: text.slice(contextStart, contextEnd),
      fixStrategy,
      startOffset: start,
      endOffset: end,
      fixed: false,
      source: 'deterministic',
    });
    index += 1;
  }
  return issues;
}

export function scanPipelineRules(
  text: string,
  contentSafetyRules: ContentSafetyRule[],
  scanEnabled: boolean,
  rulesFixMode: 'auto' | 'semi' | 'manual',
  protagonistName = '主角'
): PipelineRuleIssue[] {
  const issues: PipelineRuleIssue[] = [];

  if (scanEnabled) {
    const safetyResult = scanContentSafety(text, contentSafetyRules);
    for (const hit of safetyResult.hits) {
      const start = hit.startOffset ?? 0;
      const end = hit.endOffset ?? start + hit.matchedText.length;
      issues.push({
        id: `forbidden-${hit.ruleId}-${start}`,
        category: 'forbidden_word',
        text: hit.matchedText,
        context: text.slice(Math.max(0, start - 30), Math.min(text.length, end + 30)),
        fixStrategy: resolveIssueFixStrategy('forbidden_word', rulesFixMode),
        startOffset: start,
        endOffset: end,
        fixed: false,
        source: 'deterministic',
      });
    }
  }

  for (const pattern of EXPLANATORY_PATTERNS) {
    issues.push(
      ...findAllMatches(
        text,
        pattern,
        'explanatory_text',
        resolveIssueFixStrategy('explanatory_text', rulesFixMode)
      )
    );
  }

  issues.push(
    ...findAllMatches(
      text,
      buildPronounMismatchPattern(protagonistName),
      'pronoun_mismatch',
      resolveIssueFixStrategy('pronoun_mismatch', rulesFixMode)
    ).map((issue) => ({
      ...issue,
      context: `${issue.context}（「男人」指代${protagonistName}）`,
    }))
  );

  for (const item of GENDERED_MALE_PATTERNS) {
    issues.push(
      ...findAllMatches(
        text,
        item.pattern,
        'gendered_word_male',
        resolveIssueFixStrategy('gendered_word_male', rulesFixMode),
        item.label
      )
    );
  }

  for (const item of buildContextualPatterns(protagonistName)) {
    issues.push(
      ...findAllMatches(
        text,
        item.pattern,
        item.category,
        resolveIssueFixStrategy(item.category, rulesFixMode)
      )
    );
  }

  return dedupeIssues(issues);
}

function dedupeIssues(issues: PipelineRuleIssue[]): PipelineRuleIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.category}:${issue.startOffset}:${issue.endOffset}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function applyAutoRuleFix(
  text: string,
  issue: PipelineRuleIssue,
  protagonistName = '主角'
): string {
  const span = resolveRuleIssueSpanStrict(text, issue);
  if (!span) {
    return text;
  }
  const relocated: PipelineRuleIssue = {
    ...issue,
    startOffset: span.start,
    endOffset: span.end,
  };
  const spanLen = span.end - span.start;
  const maxSpan = MAX_AUTO_FIX_SPAN_BY_CATEGORY[issue.category] ?? 80;
  if (spanLen > maxSpan) {
    return text;
  }

  if (issue.category === 'explanatory_text') {
    return text.slice(0, span.start) + text.slice(span.end);
  }
  if (issue.category === 'pronoun_mismatch') {
    return text.slice(0, span.start) + protagonistName + text.slice(span.end);
  }
  if (issue.category === 'forbidden_word') {
    return text.slice(0, span.start) + text.slice(span.end);
  }
  if (issue.category === 'gendered_word_male') {
    const segment = text.slice(span.start, span.end);
    const fixed = segment.replace(/^他/, protagonistName);
    return text.slice(0, span.start) + fixed + text.slice(span.end);
  }
  return text;
}

export function applyAutoFixes(
  text: string,
  issues: PipelineRuleIssue[],
  mode: 'auto' | 'semi' | 'manual',
  protagonistName = '主角'
): { text: string; issues: PipelineRuleIssue[] } {
  if (mode === 'manual') {
    return { text, issues };
  }

  const sorted = [...issues].sort((a, b) => b.startOffset - a.startOffset);
  let result = text;
  const updated = issues.map((issue) => ({ ...issue }));

  for (const issue of sorted) {
    if (!shouldApplyAutoFix(issue, mode)) {
      continue;
    }
    const idx = updated.findIndex((i) => i.id === issue.id);
    if (idx < 0 || updated[idx].fixed) {
      continue;
    }
    const next = applyAutoRuleFix(result, issue, protagonistName);
    if (next !== result) {
      result = next;
      updated[idx] = { ...updated[idx], fixed: true };
    }
  }

  return { text: result, issues: updated };
}

export function getDefaultFixStrategy(category: PipelineRuleCategory): PipelineFixStrategy {
  return DEFAULT_FIX_STRATEGY[category];
}

export function normalizeRuleIssues(
  issues: PipelineRuleIssue[],
  rulesFixMode: 'auto' | 'semi' | 'manual'
): PipelineRuleIssue[] {
  return issues.map((issue) => ({
    ...issue,
    fixStrategy: resolveIssueFixStrategy(issue.category, rulesFixMode),
  }));
}

export function mergeLlmRuleIssues(
  deterministic: PipelineRuleIssue[],
  llmIssues: PipelineRuleIssue[]
): PipelineRuleIssue[] {
  return dedupeIssues([...deterministic, ...llmIssues]);
}
