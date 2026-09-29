/**
 * 章节生成用人设注入块（自动循环等保留路径共用）。
 * 从终稿合规 util 抽出，避免删除合规产品时打断自动循环。
 */

import { extractCardDisplayName } from '../documents/persona-card-link.util';

/** 角色卡按匹配全量注入；99999 只挡住极端超大文档，不当日常上限 */
export const CHAPTER_PERSONA_CARD_MAX_CHARS = 99999;

export type ChapterPersonaCardDoc = {
  personaId?: string | null;
  title: string;
  content: string;
};

function filterPublishedPersonas<T extends { name: string; status: string }>(
  personas: T[],
  selectedPersonaNames?: string[]
): T[] {
  const published = personas.filter((persona) => persona.status === 'published');
  if (!selectedPersonaNames?.length) {
    return published;
  }
  const selected = new Set(
    selectedPersonaNames.map((name) => name.trim()).filter((name) => name.length > 0)
  );
  if (selected.size === 0) {
    return published;
  }
  return published.filter((persona) => selected.has(persona.name));
}

function clipPersonaCardContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= CHAPTER_PERSONA_CARD_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, CHAPTER_PERSONA_CARD_MAX_CHARS)}\n…（角色卡过长，已截断）`;
}

function matchPersonaCard(
  persona: { id?: string; name: string },
  cards: ChapterPersonaCardDoc[]
): ChapterPersonaCardDoc | undefined {
  if (persona.id) {
    const byId = cards.find((card) => card.personaId === persona.id);
    if (byId?.content.trim()) {
      return byId;
    }
  }
  return cards.find((card) => extractCardDisplayName(card.title) === persona.name);
}

export function resolveChapterPersonaNames(
  personas: Array<{ name: string; status: string }>,
  sourceText: string,
  selectedPersonaNames?: string[]
): string[] | undefined {
  const appearing = personas
    .filter((persona) => persona.name && sourceText.includes(persona.name))
    .map((persona) => persona.name);
  const selected = (selectedPersonaNames ?? []).map((name) => name.trim()).filter(Boolean);
  const names = [...new Set([...appearing, ...selected])];
  return names.length > 0 ? names : undefined;
}

/** 用人设：正文出场或检索勾选的角色含草稿；无名单时回退已发布人物。 */
function filterChapterPersonas<T extends { name: string; status: string }>(
  personas: T[],
  names?: string[]
): T[] {
  const selected = (names ?? []).map((name) => name.trim()).filter(Boolean);
  if (selected.length === 0) {
    return filterPublishedPersonas(personas);
  }
  const wanted = new Set(selected);
  return personas.filter((persona) => wanted.has(persona.name));
}

export function buildChapterPersonaPromptBlock(
  personas: Array<{ id?: string; name: string; profile: string; state: string; status: string }>,
  selectedPersonaNames?: string[],
  options?: { cards?: ChapterPersonaCardDoc[]; sourceText?: string }
): string {
  const names = options?.sourceText
    ? resolveChapterPersonaNames(personas, options.sourceText, selectedPersonaNames)
    : selectedPersonaNames;
  const selected = filterChapterPersonas(personas, names);
  const usedNames = new Set(selected.map((persona) => persona.name));
  const cards = options?.cards ?? [];
  const blocks = selected.map((persona) => {
    const card = matchPersonaCard(persona, cards);
    const lines = [`${persona.name}：${persona.profile}`];
    if (card?.content.trim()) {
      lines.push(`角色卡《${card.title}》`, clipPersonaCardContent(card.content));
    }
    lines.push(`状态：${persona.state}`);
    return lines.join('\n');
  });
  if (options?.sourceText) {
    for (const card of cards) {
      const displayName = extractCardDisplayName(card.title);
      if (!displayName || usedNames.has(displayName) || !options.sourceText.includes(displayName)) {
        continue;
      }
      if (!card.content.trim()) {
        continue;
      }
      usedNames.add(displayName);
      blocks.push(
        `${displayName}：\n角色卡《${card.title}》\n${clipPersonaCardContent(card.content)}`
      );
    }
  }
  return blocks.join('\n\n');
}

/** @deprecated 兼容旧名；新代码请用 buildChapterPersonaPromptBlock */
export const buildCompliancePersonaBlock = buildChapterPersonaPromptBlock;
export type CompliancePersonaCardDoc = ChapterPersonaCardDoc;
export const COMPLIANCE_PERSONA_CARD_MAX_CHARS = CHAPTER_PERSONA_CARD_MAX_CHARS;
export const resolveCompliancePersonaNames = resolveChapterPersonaNames;
