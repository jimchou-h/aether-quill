import { resolvePersonaIdByName } from './persona-graph.util';

export interface PersonaIdentityRelationRecord {
  id: string;
  projectId: string;
  fromPersonaId: string;
  toPersonaId: string;
  relation: string;
  source: 'llm' | 'manual';
  chapterNo: number | null;
  evidenceSnippet?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtractedIdentityRelationCandidate {
  from: string;
  to: string;
  relation: string;
  evidenceSnippet?: string;
}

export function normalizeIdentityRelationLabel(relation: string): string {
  return relation.replace(/\s+/g, '').trim();
}

export function normalizeIdentityRelationDedupeKey(input: {
  fromPersonaId: string;
  toPersonaId: string;
  relation: string;
}): string {
  return `${input.fromPersonaId}|${input.toPersonaId}|${normalizeIdentityRelationLabel(input.relation)}`;
}

export function parseExtractedIdentityRelationCandidates(
  raw: unknown
): ExtractedIdentityRelationCandidate[] {
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
        Array.isArray((payload as { relations?: unknown[] }).relations)
      ? (payload as { relations: unknown[] }).relations
      : [];

  const candidates: ExtractedIdentityRelationCandidate[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const from = typeof record.from === 'string' ? record.from.trim() : '';
    const to = typeof record.to === 'string' ? record.to.trim() : '';
    const relation = typeof record.relation === 'string' ? record.relation.trim() : '';
    if (!from || !to || !relation || from === to) {
      continue;
    }

    const evidenceSnippet =
      typeof record.evidenceSnippet === 'string' ? record.evidenceSnippet.trim() : undefined;

    candidates.push({
      from,
      to,
      relation,
      evidenceSnippet: evidenceSnippet || undefined,
    });
  }

  return candidates;
}

export function mergeIdentityRelationCandidates(input: {
  projectId: string;
  chapterNo: number | null;
  existing: PersonaIdentityRelationRecord[];
  candidates: ExtractedIdentityRelationCandidate[];
  personas: Array<{ id: string; name: string }>;
  now?: Date;
}): { records: PersonaIdentityRelationRecord[]; addedCount: number; updatedCount: number } {
  const now = input.now ?? new Date();
  const records = [...input.existing];
  const indexByKey = new Map(
    records.map((record) => [normalizeIdentityRelationDedupeKey(record), record])
  );

  let addedCount = 0;
  let updatedCount = 0;

  for (const candidate of input.candidates) {
    const fromPersonaId = resolvePersonaIdByName(input.personas, candidate.from);
    const toPersonaId = resolvePersonaIdByName(input.personas, candidate.to);
    if (!fromPersonaId || !toPersonaId || fromPersonaId === toPersonaId) {
      continue;
    }

    const key = normalizeIdentityRelationDedupeKey({
      fromPersonaId,
      toPersonaId,
      relation: candidate.relation,
    });

    const existing = indexByKey.get(key);
    if (existing) {
      const chapterNo =
        typeof input.chapterNo === 'number' &&
        input.chapterNo > 0 &&
        (existing.chapterNo === null || input.chapterNo >= existing.chapterNo)
          ? input.chapterNo
          : existing.chapterNo;

      existing.chapterNo = chapterNo;
      if (candidate.evidenceSnippet) {
        existing.evidenceSnippet = candidate.evidenceSnippet;
      }
      existing.updatedAt = now;
      updatedCount += 1;
      continue;
    }

    const record: PersonaIdentityRelationRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId: input.projectId,
      fromPersonaId,
      toPersonaId,
      relation: candidate.relation,
      source: 'llm',
      chapterNo: input.chapterNo,
      evidenceSnippet: candidate.evidenceSnippet,
      createdAt: now,
      updatedAt: now,
    };

    records.push(record);
    indexByKey.set(key, record);
    addedCount += 1;
  }

  return { records, addedCount, updatedCount };
}

export function buildIdentityRelationMemoryBlock(
  relations: PersonaIdentityRelationRecord[],
  personas: Array<{ id: string; name: string }>
): string {
  if (relations.length === 0) {
    return '';
  }

  const nameById = new Map(personas.map((persona) => [persona.id, persona.name]));
  const lines = relations
    .map((record) => {
      const fromName = nameById.get(record.fromPersonaId);
      const toName = nameById.get(record.toPersonaId);
      if (!fromName || !toName) {
        return null;
      }
      return `- ${fromName} → ${toName}：${record.relation}`;
    })
    .filter((line): line is string => Boolean(line));

  if (lines.length === 0) {
    return '';
  }

  return [
    '【人物身份关系】',
    ...lines,
    '',
    '【执行约束】',
    '- 上述为相对稳定的社会/亲属/门派身份，称呼与互动须一致',
    '- 不得无因改写身份关系；若剧情需要变化，须写出过渡',
  ].join('\n');
}
