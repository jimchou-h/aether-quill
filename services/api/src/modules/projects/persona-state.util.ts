export function buildFallbackPersonaState(chapterNo: number, chapterContent: string) {
  const firstSentence = chapterContent
    .replace(/\s+/g, ' ')
    .split(/[。！？\n]/u)
    .map((item) => item.trim())
    .find(Boolean);

  if (!firstSentence) {
    return `第${chapterNo}章已更新，状态待补充`;
  }

  return `第${chapterNo}章后：${firstSentence.slice(0, 48)}`;
}

export function trimForPrompt(content: string, maxLength: number) {
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength)}\n...(已截断)`;
}

export function normalizePersonaStateOutput(raw: string) {
  const normalized = raw
    .trim()
    .replace(/^人物状态[:：]\s*/u, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return normalized || null;
}

export const PERSONA_STATE_MAX_LENGTH = 60;

export interface ChapterPersonaStateItem {
  name: string;
  appeared: boolean;
  state: string;
}

export function clampPersonaStateText(state: string): string {
  const normalized = normalizePersonaStateOutput(state) || state.trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > PERSONA_STATE_MAX_LENGTH
    ? normalized.slice(0, PERSONA_STATE_MAX_LENGTH)
    : normalized;
}

export function parseChapterPersonaStatesFromModelContent(raw: unknown): ChapterPersonaStateItem[] {
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
        Array.isArray((payload as { personas?: unknown[] }).personas)
      ? (payload as { personas: unknown[] }).personas
      : [];

  const parsed: ChapterPersonaStateItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const stateRaw = typeof record.state === 'string' ? record.state.trim() : '';
    if (!name || !stateRaw) {
      continue;
    }
    parsed.push({
      name,
      appeared: record.appeared === true,
      state: clampPersonaStateText(stateRaw),
    });
  }

  return parsed;
}
