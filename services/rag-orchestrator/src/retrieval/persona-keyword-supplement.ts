import { extractPersonaDisplayName } from './persona-card-evidence';

export type PersonaCardRef = {
  id?: string;
  title: string;
  docType?: string;
};

const PAREN_ALIAS_DISPLAY_NAME =
  /^(.+?)\s*[（(]\s*([^）)]+)\s*[）)]\s*$/;

/** 从显示名展开可匹配 token：主名、外号、整段「主名（外号）」 */
export function expandPersonaMatchTokens(displayName: string): string[] {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return [];
  }

  const match = trimmed.match(PAREN_ALIAS_DISPLAY_NAME);
  if (!match) {
    return [trimmed];
  }

  const primary = match[1]?.trim() ?? '';
  const alias = match[2]?.trim() ?? '';
  const tokens: string[] = [];
  const seen = new Set<string>();

  const add = (token: string) => {
    const value = token.trim();
    if (value.length < 2 || seen.has(value)) {
      return;
    }
    seen.add(value);
    tokens.push(value);
  };

  add(primary);
  add(alias);
  add(trimmed);
  return tokens;
}

export function isPersonaKeywordSupplementEnabled(): boolean {
  const flag = (process.env.PERSONA_KEYWORD_SUPPLEMENT ?? '').trim().toLowerCase();
  return flag !== '0' && flag !== 'false';
}

/** 规则层命中的角色名（不含 AI 已有关键词） */
export function supplementPersonaKeywordsFromSource(
  sourceText: string,
  personaCards: PersonaCardRef[],
  aiKeywords: string[] = []
): {
  supplementedKeywords: string[];
  mergedKeywords: string[];
} {
  const supplementedKeywords = collectSupplementedPersonaNames(sourceText, personaCards);
  const mergedKeywords = mergeKeywordsPreservingAiOrder(aiKeywords, supplementedKeywords);
  return { supplementedKeywords, mergedKeywords };
}

export function buildEffectiveMatchingText(
  matchingText: string,
  supplementedKeywords: string[]
): string {
  const base = matchingText.trim();
  const extras = supplementedKeywords.map((k) => k.trim()).filter((k) => k.length >= 2);
  if (extras.length === 0) {
    return base;
  }
  if (!base) {
    return extras.join(' ');
  }
  return `${base} ${extras.join(' ')}`.trim();
}

export function resolveStructuredMatchingTextForSync(input: {
  matchingText?: string;
  personaKeywordSupplements?: string[];
}): string | undefined {
  const matchingText = input.matchingText?.trim() ?? '';
  if (!isPersonaKeywordSupplementEnabled()) {
    return matchingText || undefined;
  }
  const supplements = input.personaKeywordSupplements ?? [];
  const effective = buildEffectiveMatchingText(matchingText, supplements);
  return effective || undefined;
}

function collectSupplementedPersonaNames(
  sourceText: string,
  personaCards: PersonaCardRef[]
): string[] {
  if (!sourceText.trim()) {
    return [];
  }

  const supplemented: string[] = [];
  const seen = new Set<string>();

  const cards = personaCards.filter(
    (card) => !card.docType || card.docType === 'persona_card'
  );

  for (const card of cards) {
    const title = card.title?.trim() ?? '';
    if (!title) {
      continue;
    }

    const displayName = extractPersonaDisplayName(title);
    const tokens = expandPersonaMatchTokens(displayName);
    let matchedFromTokens = false;

    for (const token of tokens) {
      if (token.length < 2 || seen.has(token) || !sourceText.includes(token)) {
        continue;
      }
      supplemented.push(token);
      seen.add(token);
      matchedFromTokens = true;
    }

    if (
      !matchedFromTokens &&
      title.length >= 2 &&
      !seen.has(title) &&
      sourceText.includes(title)
    ) {
      supplemented.push(title);
      seen.add(title);
    }
  }

  return supplemented;
}

function mergeKeywordsPreservingAiOrder(aiKeywords: string[], supplemented: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const raw of aiKeywords) {
    const keyword = typeof raw === 'string' ? raw.trim() : '';
    if (!keyword || seen.has(keyword)) {
      continue;
    }
    seen.add(keyword);
    merged.push(keyword);
  }

  for (const keyword of supplemented) {
    if (seen.has(keyword)) {
      continue;
    }
    seen.add(keyword);
    merged.push(keyword);
  }

  return merged;
}
