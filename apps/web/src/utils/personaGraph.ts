import type { PersonaIdentityRelationItem, PersonaItem, RelationEventItem } from '../services/api';

export interface PersonaGraphNode {
  id: string;
  name: string;
  weight: number;
}

export interface PersonaGraphLink {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  tooltip: string;
  strength: number;
  directed?: boolean;
}

export interface PersonaGraphData {
  nodes: PersonaGraphNode[];
  links: PersonaGraphLink[];
}

export interface EventRelationGraphFilters {
  chapterFrom?: number | '';
  chapterTo?: number | '';
  keyword?: string;
}

function filterRelationEvents(
  events: RelationEventItem[],
  filters: EventRelationGraphFilters
): RelationEventItem[] {
  const from = Number(filters.chapterFrom);
  const to = Number(filters.chapterTo);
  const key = (filters.keyword ?? '').trim().toLowerCase();

  return events.filter((event) => {
    if (typeof event.chapterNo === 'number') {
      if (Number.isFinite(from) && from > 0 && event.chapterNo < from) {
        return false;
      }
      if (Number.isFinite(to) && to > 0 && event.chapterNo > to) {
        return false;
      }
    }
    if (!key) {
      return true;
    }
    const haystack = [event.protagonist, event.counterparty, event.summary].join(' ').toLowerCase();
    return haystack.includes(key);
  });
}

export function buildIdentityRelationGraph(
  personas: PersonaItem[],
  identityRelations: PersonaIdentityRelationItem[]
): PersonaGraphData {
  const nodeMap = new Map<string, PersonaGraphNode>();
  for (const persona of personas) {
    nodeMap.set(persona.id, {
      id: persona.id,
      name: persona.name,
      weight: 0,
    });
  }

  const links: PersonaGraphLink[] = [];
  const pairLabels = new Map<string, string[]>();

  for (const relation of identityRelations) {
    const from = nodeMap.get(relation.fromPersonaId);
    const to = nodeMap.get(relation.toPersonaId);
    if (!from || !to || relation.fromPersonaId === relation.toPersonaId) {
      continue;
    }

    from.weight += 1;
    to.weight += 1;

    const pairKey = `${relation.fromPersonaId}|${relation.toPersonaId}`;
    const labels = pairLabels.get(pairKey) ?? [];
    if (!labels.includes(relation.relation)) {
      labels.push(relation.relation);
      pairLabels.set(pairKey, labels);
    }
  }

  for (const [pairKey, labels] of pairLabels.entries()) {
    const [sourceId, targetId] = pairKey.split('|');
    const matched = identityRelations.filter(
      (item) => item.fromPersonaId === sourceId && item.toPersonaId === targetId
    );
    links.push({
      id: pairKey,
      sourceId,
      targetId,
      label: labels.join('、'),
      tooltip: matched
        .map((item) => {
          const chapter =
            typeof item.chapterNo === 'number' && item.chapterNo > 0
              ? `第${item.chapterNo}章 `
              : '';
          return `${chapter}${item.relation}${item.evidenceSnippet ? `：${item.evidenceSnippet}` : ''}`;
        })
        .join('\n'),
      strength: labels.length,
      directed: true,
    });
  }

  return {
    nodes: [...nodeMap.values()],
    links,
  };
}

export function buildEventRelationGraph(
  personas: PersonaItem[],
  relationEvents: RelationEventItem[],
  filters: EventRelationGraphFilters = {}
): PersonaGraphData {
  const events = filterRelationEvents(relationEvents, filters);
  const nodeMap = new Map<string, PersonaGraphNode>();

  for (const persona of personas) {
    nodeMap.set(persona.id, {
      id: persona.id,
      name: persona.name,
      weight: 0,
    });
  }

  const pairCount = new Map<string, number>();
  const pairEvents = new Map<string, RelationEventItem[]>();

  for (const event of events) {
    const sourceId =
      event.protagonistPersonaId ||
      personas.find((persona) => persona.name === event.protagonist)?.id;
    const targetId =
      event.counterpartyPersonaId ||
      personas.find((persona) => persona.name === event.counterparty)?.id;
    if (!sourceId || !targetId || sourceId === targetId) {
      continue;
    }

    const pairKey = [sourceId, targetId].sort().join('|');
    pairCount.set(pairKey, (pairCount.get(pairKey) ?? 0) + 1);
    const bucket = pairEvents.get(pairKey) ?? [];
    bucket.push(event);
    pairEvents.set(pairKey, bucket);

    const source = nodeMap.get(sourceId);
    const target = nodeMap.get(targetId);
    if (source) {
      source.weight += 1;
    }
    if (target) {
      target.weight += 1;
    }

    const sample = pairEvents.get(pairKey)?.[0];
    if (sample && !nodeMap.has(sourceId)) {
      nodeMap.set(sourceId, { id: sourceId, name: sample.protagonist, weight: 1 });
    }
    if (sample && !nodeMap.has(targetId)) {
      nodeMap.set(targetId, { id: targetId, name: sample.counterparty, weight: 1 });
    }
  }

  const links: PersonaGraphLink[] = [];
  for (const [pairKey, count] of pairCount.entries()) {
    const [sourceId, targetId] = pairKey.split('|');
    links.push({
      id: pairKey,
      sourceId,
      targetId,
      label: count > 1 ? String(count) : '',
      tooltip:
        pairEvents
          .get(pairKey)
          ?.map((event) => `第${event.chapterNo ?? '?'}章 ${event.summary}`)
          .join('\n') || '',
      strength: count,
      directed: false,
    });
  }

  return {
    nodes: [...nodeMap.values()],
    links,
  };
}

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
