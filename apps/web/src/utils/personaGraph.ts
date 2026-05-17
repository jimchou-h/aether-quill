import type { PersonaItem, RelationEventItem } from '../services/api';

export const DEFAULT_ABSENT_CHAPTER_WARNING_THRESHOLD = 3;

export interface PersonaAbsentWarning {
  personaId: string;
  name: string;
  lastAppearedChapterNo: number | null;
  absentChapterCount: number;
}

export function detectAbsentPersonaWarnings(
  personas: PersonaItem[],
  maxChapterNo: number,
  threshold = DEFAULT_ABSENT_CHAPTER_WARNING_THRESHOLD
): PersonaAbsentWarning[] {
  if (maxChapterNo <= 0) {
    return [];
  }

  const warnings: PersonaAbsentWarning[] = [];
  for (const persona of personas) {
    const last = persona.lastAppearedChapterNo;
    if (last === null) {
      if (maxChapterNo > threshold) {
        warnings.push({
          personaId: persona.id,
          name: persona.name,
          lastAppearedChapterNo: null,
          absentChapterCount: maxChapterNo,
        });
      }
      continue;
    }

    const absentChapterCount = maxChapterNo - last;
    if (absentChapterCount >= threshold) {
      warnings.push({
        personaId: persona.id,
        name: persona.name,
        lastAppearedChapterNo: last,
        absentChapterCount,
      });
    }
  }

  return warnings;
}

export function buildRecommendedRelationEventIds(
  events: RelationEventItem[],
  selectedCharacters: string[]
): string[] {
  if (selectedCharacters.length === 0) {
    return [];
  }
  const selected = new Set(selectedCharacters.map((name) => name.trim()).filter(Boolean));
  return events
    .filter(
      (event) =>
        selected.has(event.protagonist) ||
        selected.has(event.counterparty) ||
        event.actors.some((actor) => selected.has(actor))
    )
    .map((event) => event.id);
}

export function findUnselectedRelationSuggestions(
  events: RelationEventItem[],
  selectedCharacters: string[],
  selectedEventIds: string[]
) {
  const selected = new Set(selectedCharacters.map((name) => name.trim()).filter(Boolean));
  const selectedEvents = new Set(selectedEventIds);
  const suggestions: Array<{ id: string; label: string }> = [];

  for (const event of events) {
    if (selectedEvents.has(event.id)) {
      continue;
    }
    const involved = new Set([event.protagonist, event.counterparty, ...event.actors]);
    if (![...involved].some((name) => selected.has(name))) {
      continue;
    }
    const missing = [...involved].filter((name) => name.trim() && !selected.has(name));
    if (missing.length === 0) {
      continue;
    }
    suggestions.push({
      id: event.id,
      label: `${event.protagonist} ↔ ${event.counterparty}（建议关注：${missing.join('、')}）`,
    });
  }

  return suggestions;
}

export function getPersonaRelationEvents(
  persona: PersonaItem,
  events: RelationEventItem[]
): RelationEventItem[] {
  const linked = new Set(persona.relationEventIds ?? []);
  return events.filter(
    (event) =>
      linked.has(event.id) ||
      event.protagonistPersonaId === persona.id ||
      event.counterpartyPersonaId === persona.id
  );
}

export function buildPersonaTimeline(
  persona: PersonaItem,
  events: RelationEventItem[]
): Array<{ chapterNo: number; label: string }> {
  const timeline: Array<{ chapterNo: number; label: string }> = [];
  for (const chapterNo of persona.appearedChapterNos ?? []) {
    timeline.push({ chapterNo, label: `第${chapterNo}章 · 出场` });
  }
  for (const event of getPersonaRelationEvents(persona, events)) {
    if (typeof event.chapterNo === 'number' && event.chapterNo > 0) {
      timeline.push({
        chapterNo: event.chapterNo,
        label: `第${event.chapterNo}章 · ${event.protagonist} ↔ ${event.counterparty}：${event.summary}`,
      });
    }
  }
  return timeline.sort((a, b) => a.chapterNo - b.chapterNo);
}
