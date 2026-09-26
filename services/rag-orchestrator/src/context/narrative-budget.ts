import { pickTopParagraphs } from '../retrieval/paragraph-crop';

/** 0 = 不注入该块；正数 = 最大字符数 */
export function clampNarrativeBlockMaxChars(
  value: unknown,
  fallback: number,
  max = 8000
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(0, Math.trunc(n)));
}

export const DEFAULT_OUTLINE_MAX_CHARS = 4000;
export const DEFAULT_PERSONA_PROFILE_MAX_CHARS = 2000;
export const DEFAULT_RELATION_MEMO_MAX_CHARS = 2000;
/** 出场人物静态角色卡按匹配注入全文；99999 只挡住极端超大文档 */
export const PERSONA_CARD_INJECT_MAX_CHARS = 99999;

export function applyHeadCharBudget(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (!trimmed || maxChars <= 0) {
    return '';
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}\n…（已按预算截断）`;
}

/**
 * 大纲超预算时按 query 取相关段落再拼到预算内；无 query 则头部截断。
 */
export function applyOutlineBudget(
  outlineSummary: string,
  maxChars: number,
  query?: string
): { text: string; mode: 'full' | 'sectioned' | 'truncated' | 'omitted' } {
  const trimmed = outlineSummary.trim();
  if (!trimmed) {
    return { text: '', mode: 'omitted' };
  }
  if (maxChars <= 0) {
    return { text: '', mode: 'omitted' };
  }
  if (trimmed.length <= maxChars) {
    return { text: trimmed, mode: 'full' };
  }
  const q = query?.trim() ?? '';
  if (q.length >= 2) {
    const paragraphs = pickTopParagraphs(trimmed, q, 6);
    const joined = paragraphs.join('\n\n').trim();
    if (joined) {
      return {
        text: applyHeadCharBudget(joined, maxChars),
        mode: 'sectioned',
      };
    }
  }
  return { text: applyHeadCharBudget(trimmed, maxChars), mode: 'truncated' };
}
