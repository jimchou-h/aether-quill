import { countTokens } from 'gpt-tokenizer';

export const DEFAULT_EVIDENCE_TOKEN_BUDGET = 4096;

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

/** 按顺序累加文本块，不超过 token 预算 */
export function trimTextsToTokenBudget(texts: string[], maxTokens: number): string[] {
  if (maxTokens <= 0) {
    return [];
  }
  const out: string[] = [];
  let used = 0;
  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }
    const cost = countEvidenceTokens(trimmed);
    if (used + cost > maxTokens) {
      break;
    }
    out.push(trimmed);
    used += cost;
  }
  return out;
}
