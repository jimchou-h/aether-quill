export const DEFAULT_ABSENT_CHAPTER_WARNING_THRESHOLD = 3;
export const IMPORT_AUTO_PERSONA_MIN_CHAPTER_COUNT = 3;

export interface PersonaGraphFields {
  relationEventIds: string[];
  appearedChapterNos: number[];
  lastAppearedChapterNo: number | null;
}

export interface PersonaGraphPersona {
  id: string;
  name: string;
  state: string;
  relationEventIds: string[];
  appearedChapterNos: number[];
  lastAppearedChapterNo: number | null;
}

export interface PersonaGraphRelationEvent {
  id: string;
  protagonist: string;
  counterparty: string;
  protagonistPersonaId: string | null;
  counterpartyPersonaId: string | null;
  chapterNo: number | null;
  summary: string;
  evidenceSnippet?: string;
}

export function createEmptyPersonaGraphFields(): PersonaGraphFields {
  return {
    relationEventIds: [],
    appearedChapterNos: [],
    lastAppearedChapterNo: null,
  };
}

export function normalizePersonaGraphFields(
  persona: Partial<PersonaGraphFields>
): PersonaGraphFields {
  const appearedChapterNos = Array.isArray(persona.appearedChapterNos)
    ? [...new Set(persona.appearedChapterNos.filter((n) => Number.isFinite(n) && n > 0))].sort(
        (a, b) => a - b
      )
    : [];
  const relationEventIds = Array.isArray(persona.relationEventIds)
    ? [...new Set(persona.relationEventIds.filter((id) => typeof id === 'string' && id.trim()))]
    : [];

  return {
    relationEventIds,
    appearedChapterNos,
    lastAppearedChapterNo:
      typeof persona.lastAppearedChapterNo === 'number' && persona.lastAppearedChapterNo > 0
        ? persona.lastAppearedChapterNo
        : computeLastAppearedChapterNo(appearedChapterNos),
  };
}

export function resolvePersonaIdByName(
  personas: Array<{ id: string; name: string }>,
  name: string
): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  const found = personas.find((persona) => persona.name.trim() === trimmed);
  return found?.id ?? null;
}

export function addChapterAppearance(appearedChapterNos: number[], chapterNo: number): number[] {
  if (!Number.isFinite(chapterNo) || chapterNo <= 0) {
    return appearedChapterNos;
  }
  if (appearedChapterNos.includes(chapterNo)) {
    return appearedChapterNos;
  }
  return [...appearedChapterNos, chapterNo].sort((a, b) => a - b);
}

export function removeChapterFromAppearances(
  appearedChapterNos: number[],
  chapterNo: number
): number[] {
  return appearedChapterNos.filter((item) => item !== chapterNo);
}

export function renumberAppearancesAfterDelete(
  appearedChapterNos: number[],
  deletedChapterNo: number
): number[] {
  return appearedChapterNos
    .filter((item) => item !== deletedChapterNo)
    .map((item) => (item > deletedChapterNo ? item - 1 : item))
    .sort((a, b) => a - b);
}

export function renumberAppearancesAfterRenumber(
  appearedChapterNos: number[],
  oldToNew: Map<number, number>
): number[] {
  const next = appearedChapterNos
    .map((chapterNo) => oldToNew.get(chapterNo) ?? chapterNo)
    .filter((chapterNo) => chapterNo > 0);
  return [...new Set(next)].sort((a, b) => a - b);
}

export function computeLastAppearedChapterNo(appearedChapterNos: number[]): number | null {
  if (appearedChapterNos.length === 0) {
    return null;
  }
  return Math.max(...appearedChapterNos);
}

/** 用于正文出场匹配：全名 + 无冲突时的后两字昵称（如「叶清歌」→「清歌」） */
export function buildPersonaMatchTerms(
  persona: { id: string; name: string },
  allPersonas: Array<{ id: string; name: string }>
): string[] {
  const name = persona.name.trim();
  if (!name) {
    return [];
  }

  const terms = [name];
  if (name.length >= 3) {
    const suffix2 = name.slice(-2);
    const othersShareSuffix = allPersonas.some(
      (item) => item.id !== persona.id && item.name.trim().slice(-2) === suffix2
    );
    if (!othersShareSuffix) {
      terms.push(suffix2);
    }
  }

  return [...new Set(terms)];
}

export function personaAppearsInChapterContent(
  persona: { id: string; name: string },
  allPersonas: Array<{ id: string; name: string }>,
  content: string
): boolean {
  const terms = buildPersonaMatchTerms(persona, allPersonas);
  return terms.some((term) => term.length >= 2 && content.includes(term));
}

export function updateAppearancesForChapter(
  personas: PersonaGraphPersona[],
  chapterNo: number,
  content: string
): void {
  const roster = personas.map((persona) => ({ id: persona.id, name: persona.name }));
  for (const persona of personas) {
    if (personaAppearsInChapterContent(persona, roster, content)) {
      persona.appearedChapterNos = addChapterAppearance(persona.appearedChapterNos, chapterNo);
    } else {
      persona.appearedChapterNos = removeChapterFromAppearances(
        persona.appearedChapterNos,
        chapterNo
      );
    }
    persona.lastAppearedChapterNo = computeLastAppearedChapterNo(persona.appearedChapterNos);
  }
}

export function rebuildPersonaAppearancesFromChapters(
  personas: PersonaGraphPersona[],
  chapters: Array<{ chapterNo: number; content: string }>
): void {
  for (const persona of personas) {
    persona.appearedChapterNos = [];
    persona.lastAppearedChapterNo = null;
  }
  for (const chapter of chapters) {
    updateAppearancesForChapter(personas, chapter.chapterNo, chapter.content);
  }
}

export function linkRelationEventToPersonas(
  event: PersonaGraphRelationEvent,
  personas: PersonaGraphPersona[]
): void {
  event.protagonistPersonaId =
    resolvePersonaIdByName(personas, event.protagonist) ?? event.protagonistPersonaId;
  event.counterpartyPersonaId =
    resolvePersonaIdByName(personas, event.counterparty) ?? event.counterpartyPersonaId;

  const linkedIds = new Set(
    [event.protagonistPersonaId, event.counterpartyPersonaId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
  );

  for (const persona of personas) {
    if (linkedIds.has(persona.id) && !persona.relationEventIds.includes(event.id)) {
      persona.relationEventIds.push(event.id);
    }
  }
}

export function unlinkRelationEventFromPersonas(
  eventId: string,
  personas: PersonaGraphPersona[]
): void {
  for (const persona of personas) {
    persona.relationEventIds = persona.relationEventIds.filter((id) => id !== eventId);
  }
}

export function relinkAllRelationEvents(
  personas: PersonaGraphPersona[],
  events: PersonaGraphRelationEvent[]
): void {
  for (const persona of personas) {
    persona.relationEventIds = [];
  }
  for (const event of events) {
    linkRelationEventToPersonas(event, personas);
  }
}

export function clearPersonaFromRelationEvents(
  personaId: string,
  events: PersonaGraphRelationEvent[]
): void {
  for (const event of events) {
    if (event.protagonistPersonaId === personaId) {
      event.protagonistPersonaId = null;
    }
    if (event.counterpartyPersonaId === personaId) {
      event.counterpartyPersonaId = null;
    }
  }
}

export interface AbsentPersonaWarning {
  personaId: string;
  name: string;
  lastAppearedChapterNo: number | null;
  absentChapterCount: number;
}

export function detectAbsentPersonaWarnings(
  personas: PersonaGraphPersona[],
  maxChapterNo: number,
  threshold = DEFAULT_ABSENT_CHAPTER_WARNING_THRESHOLD
): AbsentPersonaWarning[] {
  if (maxChapterNo <= 0 || threshold <= 0) {
    return [];
  }

  const warnings: AbsentPersonaWarning[] = [];
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

export function buildAbsentPersonaConsistencyNotes(
  warnings: AbsentPersonaWarning[]
): Array<{ level: 'warning'; message: string }> {
  return warnings.map((warning) => {
    if (warning.lastAppearedChapterNo === null) {
      return {
        level: 'warning' as const,
        message: `角色「${warning.name}」尚未在任何章节出场（当前共 ${warning.absentChapterCount} 章）。`,
      };
    }
    return {
      level: 'warning' as const,
      message: `角色「${warning.name}」已连续 ${warning.absentChapterCount} 章未出场（最后出场：第${warning.lastAppearedChapterNo}章）。`,
    };
  });
}

export function countChapterAppearancesForName(
  chapters: Array<{ chapterNo: number; content: string }>,
  name: string,
  allPersonas: Array<{ id: string; name: string }> = []
): number {
  const persona = allPersonas.find((item) => item.name.trim() === name.trim());
  const roster = allPersonas.length > 0 ? allPersonas : persona ? [persona] : [{ id: name, name }];
  const target = persona ?? { id: name, name: name.trim() };
  if (!target.name.trim()) {
    return 0;
  }
  return chapters.filter((chapter) => personaAppearsInChapterContent(target, roster, chapter.content))
    .length;
}

export function findSimilarPersonaNameConflicts(
  names: string[],
  existingNames: string[]
): string[] {
  const existing = new Set(existingNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const seen = new Map<string, string>();
  const conflicts: string[] = [];

  for (const raw of names) {
    const name = raw.trim();
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (existing.has(key)) {
      continue;
    }
    if (seen.has(key) && seen.get(key) !== name) {
      conflicts.push(name);
      continue;
    }
    seen.set(key, name);
  }

  return [...new Set(conflicts)];
}

export function filterRelationEventsForCharacters(
  events: Array<{
    id: string;
    protagonist: string;
    counterparty: string;
    actors: string[];
  }>,
  selectedCharacters: string[]
): string[] {
  if (selectedCharacters.length === 0) {
    return [];
  }
  const selected = new Set(selectedCharacters.map((name) => name.trim()).filter(Boolean));
  return events
    .filter(
      (event) =>
        event.actors.some((actor) => selected.has(actor)) ||
        selected.has(event.protagonist) ||
        selected.has(event.counterparty)
    )
    .map((event) => event.id);
}

export function findSuggestedUnselectedRelationEvents(
  events: Array<{
    id: string;
    protagonist: string;
    counterparty: string;
    actors: string[];
  }>,
  selectedCharacters: string[],
  selectedEventIds: string[]
): Array<{ id: string; label: string }> {
  const selected = new Set(selectedCharacters.map((name) => name.trim()).filter(Boolean));
  const selectedEvents = new Set(selectedEventIds);
  const suggestions: Array<{ id: string; label: string }> = [];

  for (const event of events) {
    if (selectedEvents.has(event.id)) {
      continue;
    }
    const involved = new Set([event.protagonist, event.counterparty, ...event.actors]);
    const matchesSelected = [...involved].some((name) => selected.has(name));
    if (!matchesSelected) {
      continue;
    }
    const missing = [...involved].filter(
      (name) => name.trim() && !selected.has(name) && name !== event.protagonist
    );
    if (missing.length === 0) {
      continue;
    }
    suggestions.push({
      id: event.id,
      label: `${event.protagonist} ↔ ${event.counterparty}（涉及未选角色：${missing.join('、')}）`,
    });
  }

  return suggestions;
}
