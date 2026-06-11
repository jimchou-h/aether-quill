export interface RelationEventMemoryInput {
  protagonist: string;
  counterparty: string;
  summary: string;
  evidenceSnippet?: string;
  chapterNo?: number | null;
}

export const RELATION_EVENT_SUMMARY_MAX_LENGTH = 200;
export const RELATION_EVENT_SELECTED_MAX_COUNT = 30;

export interface ExtractedRelationEventCandidate {
  counterparty: string;
  actors?: string[];
  summary: string;
  evidenceSnippet?: string;
}

export interface RelationEventSoftDeleteRecord {
  id: string;
  chapterNo: number | null;
  deletedAt: Date | null;
  updatedAt: Date;
}

/** 重新生成某章关系事件前，软删除该章已有未删除条目 */
export function softDeleteChapterRelationEvents(
  events: RelationEventSoftDeleteRecord[],
  chapterNo: number,
  now = new Date()
): string[] {
  const removedIds: string[] = [];
  for (const event of events) {
    if (event.deletedAt || event.chapterNo !== chapterNo) {
      continue;
    }
    event.deletedAt = now;
    event.updatedAt = now;
    removedIds.push(event.id);
  }
  return removedIds;
}

export function normalizeRelationEventDedupeKey(input: {
  chapterNo: number | null;
  protagonist: string;
  counterparty: string;
  summary: string;
}): string {
  const chapter =
    typeof input.chapterNo === 'number' && input.chapterNo > 0 ? String(input.chapterNo) : '';
  const protagonist = input.protagonist.trim().toLowerCase();
  const counterparty = input.counterparty.trim().toLowerCase();
  const summary = input.summary.replace(/\s+/g, '').trim().toLowerCase();
  return `${chapter}|${protagonist}|${counterparty}|${summary}`;
}

export function parseExtractedRelationEventCandidates(
  raw: unknown
): ExtractedRelationEventCandidate[] {
  let payload = raw;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced ? fenced[1].trim() : trimmed;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return [];
    }
  }

  const items = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as { events?: unknown[] }).events)
      ? (payload as { events: unknown[] }).events
      : [];

  const candidates: ExtractedRelationEventCandidate[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const counterparty = typeof record.counterparty === 'string' ? record.counterparty.trim() : '';
    const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
    if (!counterparty || !summary) {
      continue;
    }

    const evidenceSnippet =
      typeof record.evidenceSnippet === 'string' ? record.evidenceSnippet.trim() : undefined;
    const actors = normalizeRelationEventActors(record.actors);

    candidates.push({
      counterparty,
      actors: actors.length > 0 ? actors : undefined,
      summary,
      evidenceSnippet: evidenceSnippet || undefined,
    });
  }

  return candidates;
}

export function normalizeRelationEventActors(actors: unknown): string[] {
  if (!Array.isArray(actors)) {
    return [];
  }

  const normalized = actors
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return [...new Set(normalized)];
}

export function resolveRelationEventActors(
  actors: unknown,
  protagonist: string,
  counterparty: string
): string[] {
  const normalized = normalizeRelationEventActors(actors);
  const merged = normalized.length > 0 ? [...normalized] : [protagonist, counterparty];

  if (!merged.includes(protagonist)) {
    merged.unshift(protagonist);
  }
  if (!merged.includes(counterparty)) {
    merged.push(counterparty);
  }

  return [...new Set(merged)];
}

export function normalizeSelectedEventIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return [];
  }

  const normalized = ids
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return [...new Set(normalized)];
}

export function buildRelationMemoryBlock(events: RelationEventMemoryInput[]): string {
  if (events.length === 0) {
    return '';
  }

  const lines = events.map((event, index) => {
    const chapterLabel =
      typeof event.chapterNo === 'number' && event.chapterNo > 0
        ? `第${event.chapterNo}章`
        : '章节未标注';
    const pair = `${event.protagonist}-${event.counterparty}`;
    let line = `${index + 1}. [${chapterLabel}][${pair}] ${event.summary}`;
    if (event.evidenceSnippet?.trim()) {
      line += `\n   证据：${event.evidenceSnippet.trim()}`;
    }
    return line;
  });

  return [
    '【用户选择的关系事件（既定事实）】',
    lines.join('\n'),
    '',
    '【执行约束】',
    '- 上述事件视为已发生事实，不得无因否定',
    '- 如需关系反转，必须写出过渡情节',
  ].join('\n');
}

export function matchesRelationEventFilters(
  event: RelationEventMemoryInput & { actors: string[] },
  filters: {
    counterparty?: string;
    chapterNo?: number;
    keyword?: string;
    appearingCharacters?: string[];
  }
): boolean {
  if (filters.counterparty?.trim()) {
    const counterparty = filters.counterparty.trim();
    if (event.counterparty !== counterparty && !event.actors.includes(counterparty)) {
      return false;
    }
  }

  if (typeof filters.chapterNo === 'number' && filters.chapterNo > 0) {
    if (event.chapterNo !== filters.chapterNo) {
      return false;
    }
  }

  if (filters.keyword?.trim()) {
    const keyword = filters.keyword.trim().toLowerCase();
    const haystack = [
      event.protagonist,
      event.counterparty,
      event.summary,
      event.evidenceSnippet || '',
      ...event.actors,
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(keyword)) {
      return false;
    }
  }

  if (Array.isArray(filters.appearingCharacters) && filters.appearingCharacters.length > 0) {
    const appearing = new Set(
      filters.appearingCharacters.map((item) => item.trim()).filter(Boolean)
    );
    const intersects = event.actors.some((actor) => appearing.has(actor));
    if (!intersects) {
      return false;
    }
  }

  return true;
}
