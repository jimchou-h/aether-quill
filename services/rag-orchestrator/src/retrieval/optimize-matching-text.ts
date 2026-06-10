import type { PersonaContextPayload } from '../context/persona-snapshot';
import { resolveKnowledgeDocTypeForRetrieval } from './knowledge-doc-type';
import {
  buildEffectiveMatchingText,
  isPersonaKeywordSupplementEnabled,
  supplementPersonaKeywordsFromSource,
  type PersonaCardRef,
} from './persona-keyword-supplement';
const CHAPTER_OPTIMIZE_TEMPLATE_KEYS = new Set([
  'chapter.optimize.plan',
  'chapter.optimize.draft',
  'chapter.optimize.typo-check',
  'chapter.optimize.typo-fix',
]);

/** 默认开启；设 `CHAPTER_OPTIMIZE_PERSONA_MATCH=0` 可回退为仅本章结构化文本 */
export function isChapterOptimizeMatchingBoostEnabled(): boolean {
  const flag = (process.env.CHAPTER_OPTIMIZE_PERSONA_MATCH ?? '').trim().toLowerCase();
  return flag !== '0' && flag !== 'false';
}

export function listPersonaCardsFromKnowledgeDocs(
  docs: Array<{ title: string; content?: string; docType?: string }>,
  projectPersonas?: Pick<PersonaContextPayload, 'name'>[]
): PersonaCardRef[] {
  const refs: PersonaCardRef[] = [];
  const seenTitles = new Set<string>();

  for (const doc of docs) {
    if (resolveKnowledgeDocTypeForRetrieval(doc) !== 'persona_card') {
      continue;
    }
    const title = doc.title?.trim() ?? '';
    if (!title || seenTitles.has(title)) {
      continue;
    }
    seenTitles.add(title);
    refs.push({ title, docType: 'persona_card' });
  }

  for (const persona of projectPersonas ?? []) {
    const name = persona.name?.trim() ?? '';
    if (name.length < 2) {
      continue;
    }
    const syntheticTitle = `人物小传：${name}`;
    if (seenTitles.has(syntheticTitle)) {
      continue;
    }
    seenTitles.add(syntheticTitle);
    refs.push({ title: syntheticTitle, docType: 'persona_card' });
  }

  return refs;
}

export function parseAppearingCharactersFromExtra(
  extra?: Record<string, unknown>
): string[] {
  const raw = extra?.appearingCharacters;
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const name = typeof item === 'string' ? item.trim() : String(item).trim();
    if (name.length < 2 || seen.has(name)) {
      continue;
    }
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function shouldApplyChapterOptimizeMatchingBoost(input: {
  templateKey?: string;
  instruction?: string;
  appearingCharacters?: string[];
}): boolean {
  if (!isChapterOptimizeMatchingBoostEnabled()) {
    return false;
  }
  if ((input.appearingCharacters?.length ?? 0) > 0) {
    return true;
  }
  if (input.instruction?.trim()) {
    return true;
  }
  const tk = input.templateKey?.trim() ?? '';
  return CHAPTER_OPTIMIZE_TEMPLATE_KEYS.has(tk);
}

/**
 * 章节优化：在保留本章 structured 基线的前提下，将 instruction / 关注角色并入标题匹配文本。
 * 不写入持久化 structuredInfo，仅用于当次检索。
 */
export function resolveOptimizeStructuredMatchingText(input: {
  chapterStructuredMatchingText?: string;
  instruction?: string;
  appearingCharacters?: string[];
  personaCards?: PersonaCardRef[];
}): string | undefined {
  const chapterStructured = input.chapterStructuredMatchingText?.trim() ?? '';
  const instruction = input.instruction?.trim() ?? '';
  const appearing = (input.appearingCharacters ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);

  if (!instruction && appearing.length === 0) {
    return chapterStructured || undefined;
  }
  if (!isChapterOptimizeMatchingBoostEnabled()) {
    return chapterStructured || undefined;
  }

  const personaCards = input.personaCards ?? [];
  const supplementSource = [chapterStructured, instruction, appearing.join(' ')]
    .filter(Boolean)
    .join('\n');

  let supplements: string[] = [];
  if (isPersonaKeywordSupplementEnabled() && personaCards.length > 0 && supplementSource.trim()) {
    supplements = supplementPersonaKeywordsFromSource(supplementSource, personaCards)
      .supplementedKeywords;
  }

  const seen = new Set(supplements);
  for (const name of appearing) {
    if (!seen.has(name)) {
      seen.add(name);
      supplements.push(name);
    }
  }

  const body = [chapterStructured, instruction].filter(Boolean).join(' ').trim();
  const effective = buildEffectiveMatchingText(
    body || instruction.slice(0, 400),
    supplements
  );
  return effective || undefined;
}

export function mapChaptersForStructuredKnowledgeMatch(
  chapters: Array<{ chapterNo: number; structuredMatchingText?: string }>,
  targetChapterNo: number,
  boost?: {
    instruction?: string;
    appearingCharacters?: string[];
    personaCards?: PersonaCardRef[];
  }
): Array<{ chapterNo: number; structuredMatchingText?: string }> {
  if (
    !boost ||
    !shouldApplyChapterOptimizeMatchingBoost({
      instruction: boost.instruction,
      appearingCharacters: boost.appearingCharacters,
    })
  ) {
    return chapters;
  }

  return chapters.map((c) => {
    if (c.chapterNo !== targetChapterNo) {
      return c;
    }
    const enhanced = resolveOptimizeStructuredMatchingText({
      chapterStructuredMatchingText: c.structuredMatchingText,
      instruction: boost.instruction,
      appearingCharacters: boost.appearingCharacters,
      personaCards: boost.personaCards,
    });
    return {
      chapterNo: c.chapterNo,
      structuredMatchingText: enhanced ?? c.structuredMatchingText,
    };
  });
}
