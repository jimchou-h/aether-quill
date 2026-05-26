import { countTokens } from 'gpt-tokenizer';

export const DEFAULT_EVIDENCE_TOKEN_BUDGET = 99999;

export function resolveEvidenceTokenBudget(): number {
  const raw = Number(process.env.EVIDENCE_TOKEN_BUDGET ?? DEFAULT_EVIDENCE_TOKEN_BUDGET);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_EVIDENCE_TOKEN_BUDGET;
  }
  return Math.trunc(raw);
}

export function countEvidenceTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return countTokens(trimmed);
}

export interface TrimTextsToTokenBudgetResult {
  texts: string[];
  /** 原 `texts` 数组中纳入预算的索引（与 `texts` 下标一一对应，跳过空串） */
  includedIndices: number[];
}

/** 按顺序累加文本块，不超过 token 预算 */
export function trimTextsToTokenBudgetDetailed(
  texts: string[],
  maxTokens: number
): TrimTextsToTokenBudgetResult {
  if (maxTokens <= 0) {
    return { texts: [], includedIndices: [] };
  }
  const textsOut: string[] = [];
  const includedIndices: number[] = [];
  let used = 0;
  for (let index = 0; index < texts.length; index += 1) {
    const trimmed = texts[index]?.trim() ?? '';
    if (!trimmed) {
      continue;
    }
    const cost = countEvidenceTokens(trimmed);
    if (used + cost > maxTokens) {
      break;
    }
    textsOut.push(trimmed);
    includedIndices.push(index);
    used += cost;
  }
  return { texts: textsOut, includedIndices };
}

export function trimTextsToTokenBudget(texts: string[], maxTokens: number): string[] {
  return trimTextsToTokenBudgetDetailed(texts, maxTokens).texts;
}
