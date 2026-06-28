import { DEFAULT_CONTENT_SAFETY_RULES } from './rules';
import type {
  ContentSafetyAction,
  ContentSafetyRule,
  ContentSafetySeverity,
  ProjectContentSafetyRule,
} from './types';

export const CONTENT_SAFETY_CUSTOM_RULES_MAX = 200;
export const CONTENT_SAFETY_PATTERN_MAX_LENGTH = 64;

function severityToAction(severity: ContentSafetySeverity): ContentSafetyAction {
  switch (severity) {
    case 'high':
      return 'block';
    case 'medium':
      return 'rewrite_sentence';
    default:
      return 'mark';
  }
}

export function projectContentSafetyRuleToEngineRule(
  rule: ProjectContentSafetyRule
): ContentSafetyRule {
  return {
    ruleId: `project:${rule.id}`,
    severity: rule.severity,
    action: severityToAction(rule.severity),
    type: 'keyword',
    pattern: rule.pattern.trim(),
  };
}

export function mergeContentSafetyRules(
  projectRules: ProjectContentSafetyRule[] = [],
  systemRules: ContentSafetyRule[] = DEFAULT_CONTENT_SAFETY_RULES
): ContentSafetyRule[] {
  const enabledProjectRules = projectRules.filter(
    (rule) => rule.enabled && rule.pattern.trim().length > 0
  );
  return [...systemRules, ...enabledProjectRules.map(projectContentSafetyRuleToEngineRule)];
}

export function sanitizeProjectContentSafetyRules(input: unknown): ProjectContentSafetyRule[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const result: ProjectContentSafetyRule[] = [];
  const seenIds = new Set<string>();

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const pattern = typeof row.pattern === 'string' ? row.pattern.trim() : '';
    const severity = row.severity;

    if (!id || !pattern) {
      continue;
    }
    if (!['low', 'medium', 'high'].includes(String(severity))) {
      continue;
    }
    if (pattern.length > CONTENT_SAFETY_PATTERN_MAX_LENGTH) {
      continue;
    }
    if (seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    result.push({
      id,
      pattern,
      severity: severity as ContentSafetySeverity,
      enabled: row.enabled !== false,
    });

    if (result.length >= CONTENT_SAFETY_CUSTOM_RULES_MAX) {
      break;
    }
  }

  return result;
}

export function validateProjectContentSafetyRulesInput(
  input: unknown
): { ok: true; rules: ProjectContentSafetyRule[] } | { ok: false; message: string } {
  if (input === undefined) {
    return { ok: true, rules: [] };
  }
  if (!Array.isArray(input)) {
    return { ok: false, message: 'contentSafetyCustomRules 必须是数组' };
  }
  if (input.length > CONTENT_SAFETY_CUSTOM_RULES_MAX) {
    return {
      ok: false,
      message: `自定义禁用词最多 ${CONTENT_SAFETY_CUSTOM_RULES_MAX} 条`,
    };
  }

  const seenIds = new Set<string>();
  const rules: ProjectContentSafetyRule[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    if (!item || typeof item !== 'object') {
      return { ok: false, message: `第 ${index + 1} 条禁用词格式无效` };
    }
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const pattern = typeof row.pattern === 'string' ? row.pattern.trim() : '';
    const severity = row.severity;

    if (!id) {
      return { ok: false, message: `第 ${index + 1} 条禁用词缺少 id` };
    }
    if (!pattern) {
      return { ok: false, message: `第 ${index + 1} 条禁用词不能为空` };
    }
    if (pattern.length > CONTENT_SAFETY_PATTERN_MAX_LENGTH) {
      return {
        ok: false,
        message: `第 ${index + 1} 条禁用词超过 ${CONTENT_SAFETY_PATTERN_MAX_LENGTH} 字`,
      };
    }
    if (!['low', 'medium', 'high'].includes(String(severity))) {
      return { ok: false, message: `第 ${index + 1} 条禁用词风险等级无效` };
    }
    if (seenIds.has(id)) {
      return { ok: false, message: `禁用词 id 重复：${id}` };
    }

    seenIds.add(id);
    rules.push({
      id,
      pattern,
      severity: severity as ContentSafetySeverity,
      enabled: row.enabled !== false,
    });
  }

  return { ok: true, rules };
}
