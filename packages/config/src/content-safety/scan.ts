import { buildNormalizedTextIndex } from './normalize';
import { DEFAULT_CONTENT_SAFETY_RULES } from './rules';
import type {
  ContentSafetyHit,
  ContentSafetyRule,
  ContentSafetyScanResult,
} from './types';

function isWhitelisted(
  text: string,
  normalizedStart: number,
  normalizedEnd: number,
  indexMap: number[],
  whitelist: string[] | undefined
): boolean {
  if (!whitelist?.length) {
    return false;
  }
  const originalStart = indexMap[normalizedStart] ?? 0;
  const originalEnd = (indexMap[normalizedEnd - 1] ?? originalStart) + 1;
  const windowStart = Math.max(0, originalStart - 12);
  const windowEnd = Math.min(text.length, originalEnd + 12);
  const window = text.slice(windowStart, windowEnd);
  return whitelist.some((item) => item && window.includes(item));
}

function mapNormalizedRangeToOriginal(
  indexMap: number[],
  normalizedStart: number,
  normalizedEnd: number,
  text: string
): { startOffset: number; endOffset: number; matchedText: string } {
  const startOffset = indexMap[normalizedStart] ?? 0;
  const endOffset = (indexMap[normalizedEnd - 1] ?? startOffset) + 1;
  return {
    startOffset,
    endOffset,
    matchedText: text.slice(startOffset, endOffset),
  };
}

function scanKeywordRule(
  text: string,
  normalized: string,
  indexMap: number[],
  rule: ContentSafetyRule
): ContentSafetyHit[] {
  const keyword = rule.pattern.toLowerCase();
  const hits: ContentSafetyHit[] = [];
  let from = 0;

  while (from < normalized.length) {
    const found = normalized.indexOf(keyword, from);
    if (found < 0) {
      break;
    }
    const end = found + keyword.length;
    if (!isWhitelisted(text, found, end, indexMap, rule.whitelist)) {
      const mapped = mapNormalizedRangeToOriginal(indexMap, found, end, text);
      hits.push({
        ruleId: rule.ruleId,
        severity: rule.severity,
        startOffset: mapped.startOffset,
        endOffset: mapped.endOffset,
        matchedText: mapped.matchedText,
        normalizedMatchedText: normalized.slice(found, end),
        action: rule.action,
      });
    }
    from = found + 1;
  }

  return hits;
}

function scanRegexRule(
  text: string,
  normalized: string,
  indexMap: number[],
  rule: ContentSafetyRule
): ContentSafetyHit[] {
  const flags = rule.pattern.includes('i') ? undefined : 'gi';
  const regex = new RegExp(rule.pattern, flags);
  const hits: ContentSafetyHit[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    const found = match.index;
    const end = found + match[0].length;
    if (isWhitelisted(text, found, end, indexMap, rule.whitelist)) {
      continue;
    }
    const mapped = mapNormalizedRangeToOriginal(indexMap, found, end, text);
    hits.push({
      ruleId: rule.ruleId,
      severity: rule.severity,
      startOffset: mapped.startOffset,
      endOffset: mapped.endOffset,
      matchedText: mapped.matchedText,
      normalizedMatchedText: match[0],
      action: rule.action,
    });
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }

  return hits;
}

function dedupeHits(hits: ContentSafetyHit[]): ContentSafetyHit[] {
  const seen = new Set<string>();
  const result: ContentSafetyHit[] = [];
  for (const hit of hits.sort((a, b) => a.startOffset - b.startOffset)) {
    const key = `${hit.startOffset}:${hit.endOffset}:${hit.ruleId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(hit);
  }
  return result;
}

export function scanContentSafety(
  text: string,
  rules: ContentSafetyRule[] = DEFAULT_CONTENT_SAFETY_RULES
): ContentSafetyScanResult {
  if (!text.trim()) {
    return { hits: [], hasHigh: false, hasMedium: false, hasLow: false };
  }

  const { normalized, indexMap } = buildNormalizedTextIndex(text);
  const allHits: ContentSafetyHit[] = [];

  for (const rule of rules) {
    if (rule.type === 'keyword') {
      allHits.push(...scanKeywordRule(text, normalized, indexMap, rule));
      continue;
    }
    allHits.push(...scanRegexRule(text, normalized, indexMap, rule));
  }

  const hits = dedupeHits(allHits);
  return {
    hits,
    hasHigh: hits.some((hit) => hit.severity === 'high'),
    hasMedium: hits.some((hit) => hit.severity === 'medium'),
    hasLow: hits.some((hit) => hit.severity === 'low'),
  };
}

export function applyLowRiskReplacements(
  text: string,
  hits: ContentSafetyHit[],
  rules: ContentSafetyRule[] = DEFAULT_CONTENT_SAFETY_RULES
): string {
  const replaceHits = hits
    .filter((hit) => hit.action === 'replace')
    .sort((a, b) => b.startOffset - a.startOffset);

  let output = text;
  for (const hit of replaceHits) {
    const rule = rules.find((item) => item.ruleId === hit.ruleId);
    if (!rule?.replacement) {
      continue;
    }
    output = `${output.slice(0, hit.startOffset)}${rule.replacement}${output.slice(hit.endOffset)}`;
  }
  return output;
}
