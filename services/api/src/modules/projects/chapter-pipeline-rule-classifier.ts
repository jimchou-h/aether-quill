/**
 * 分步精修模块三：规则扫描与分级修复（AQ-276）
 */

import {
  scanContentSafety,
  type ContentSafetyAction,
  type ContentSafetyRule,
} from '@aether-quill/config';
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

function resolveIssueFixStrategy(
  category: PipelineRuleCategory,
  rulesFixMode: 'auto' | 'semi' | 'manual'
): PipelineFixStrategy {
  if (rulesFixMode === 'manual') {
    return 'manual';
  }
  return getDefaultFixStrategy(category);
}

function resolveForbiddenWordFixStrategy(
  action: ContentSafetyAction,
  rulesFixMode: 'auto' | 'semi' | 'manual',
  replacement?: string
): PipelineFixStrategy {
  if (rulesFixMode === 'manual' || action === 'block' || action === 'mark') {
    return 'manual';
  }
  if (action === 'replace' && replacement?.trim()) {
    return 'auto';
  }
  if (action === 'rewrite_sentence') {
    return 'ai_segment';
  }
  return 'manual';
}

export function scanPipelineRules(
  text: string,
  contentSafetyRules: ContentSafetyRule[],
  scanEnabled: boolean,
  rulesFixMode: 'auto' | 'semi' | 'manual'
): PipelineRuleIssue[] {
  if (!scanEnabled) {
    return [];
  }

  const issues: PipelineRuleIssue[] = [];
  const safetyResult = scanContentSafety(text, contentSafetyRules);
  for (const hit of safetyResult.hits) {
    const start = hit.startOffset ?? 0;
    const end = hit.endOffset ?? start + hit.matchedText.length;
    const matchedRule = contentSafetyRules.find((rule) => rule.ruleId === hit.ruleId);
    issues.push({
      id: `forbidden-${hit.ruleId}-${start}`,
      category: 'forbidden_word',
      text: hit.matchedText,
      context: text.slice(Math.max(0, start - 30), Math.min(text.length, end + 30)),
      fixStrategy: resolveForbiddenWordFixStrategy(
        hit.action,
        rulesFixMode,
        matchedRule?.replacement
      ),
      startOffset: start,
      endOffset: end,
      fixed: false,
      source: 'deterministic',
      ruleId: hit.ruleId,
      replacement: matchedRule?.replacement,
      contentSafetyAction: hit.action,
    });
  }

  return issues;
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
    const replacement = issue.replacement?.trim();
    if (!replacement) {
      return text;
    }
    return text.slice(0, span.start) + replacement + text.slice(span.end);
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
  const seen = new Set<string>();
  return [...deterministic, ...llmIssues].filter((issue) => {
    const key = `${issue.category}:${issue.startOffset}:${issue.endOffset}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
