export type PersonaCardLinkDoc = {
  id: string;
  title: string;
  docType?: string;
  personaId?: string | null;
};

export function normalizeDocumentList(payload: unknown): PersonaCardLinkDoc[] {
  if (Array.isArray(payload)) {
    return payload as PersonaCardLinkDoc[];
  }
  if (
    payload &&
    typeof payload === 'object' &&
    'data' in payload &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: PersonaCardLinkDoc[] }).data;
  }
  return [];
}

export function buildLinkedPersonaCardMap(
  documents: PersonaCardLinkDoc[]
): Map<string, PersonaCardLinkDoc> {
  const map = new Map<string, PersonaCardLinkDoc>();
  for (const doc of documents) {
    if ((doc.docType ?? 'other') === 'persona_card' && doc.personaId) {
      map.set(doc.personaId, doc);
    }
  }
  return map;
}

export function linkedPersonaCardTitle(
  map: Map<string, PersonaCardLinkDoc>,
  personaId: string
): string {
  return map.get(personaId)?.title ?? '未关联';
}
