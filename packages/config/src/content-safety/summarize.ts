import type { ContentSafetyHit } from './types';

function hitDisplayLabel(hit: ContentSafetyHit): string {
  const matched = (hit.matchedText || hit.normalizedMatchedText || '').trim();
  if (matched) {
    return `「${matched}」`;
  }
  if (hit.ruleId.startsWith('project:')) {
    return '自定义禁用词';
  }
  return hit.ruleId;
}

function hitDedupeKey(hit: ContentSafetyHit): string {
  const matched = (hit.matchedText || hit.normalizedMatchedText || '').trim();
  return `${hit.severity}:${matched || hit.ruleId}`;
}

/** 将扫描命中格式化为用户可读摘要（优先展示正文匹配片段，而非 ruleId） */
export function summarizeContentSafetyHits(hits: ContentSafetyHit[]): string {
  if (hits.length === 0) {
    return '';
  }

  const seen = new Set<string>();
  const labels: string[] = [];

  for (const hit of hits) {
    const key = hitDedupeKey(hit);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    labels.push(`${hit.severity === 'high' ? '高' : hit.severity === 'medium' ? '中' : '低'}:${hitDisplayLabel(hit)}`);
    if (labels.length >= 3) {
      break;
    }
  }

  const preview = labels.join('、');
  return hits.length > labels.length ? `${preview} 等 ${hits.length} 处` : preview;
}

export function formatContentSafetyBlockMessage(
  blockReason: string | undefined,
  hits: ContentSafetyHit[]
): string {
  const hitSummary = summarizeContentSafetyHits(hits);
  const reason = blockReason || '内容安全扫描未通过';
  return hitSummary ? `${reason}（${hitSummary}）` : reason;
}
