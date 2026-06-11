const SNAPSHOT_JSON_FIELD_RE =
  /"(clothing|appearance|status|location|possessions)"\s*:\s*"((?:\\.|[^"\\])*)(?:"|$)/gu;

type PersonaSnapshotFields = {
  clothing?: string;
  appearance?: string;
  status?: string;
  location?: string;
  possessions?: string;
};

function unescapeJsonString(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function extractSnapshotFieldsFromBrokenJson(text: string): PersonaSnapshotFields {
  const snapshot: PersonaSnapshotFields = {};
  for (const match of text.matchAll(SNAPSHOT_JSON_FIELD_RE)) {
    const field = match[1] as keyof PersonaSnapshotFields;
    const rawValue = unescapeJsonString(match[2] ?? '').trim();
    if (rawValue) {
      snapshot[field] = rawValue;
    }
  }
  return snapshot;
}

function tryParseSnapshotFromText(text: string): PersonaSnapshotFields | null {
  if (!text.trim().startsWith('{')) {
    return null;
  }

  const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenced ? fenced[1] : text).trim();

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const snapshot: PersonaSnapshotFields = {};
    for (const key of ['clothing', 'appearance', 'status', 'location', 'possessions'] as const) {
      if (typeof parsed[key] === 'string' && parsed[key].trim()) {
        snapshot[key] = parsed[key].trim();
      }
    }
    return Object.keys(snapshot).length > 0 ? snapshot : null;
  } catch {
    const partial = extractSnapshotFieldsFromBrokenJson(jsonText);
    return Object.keys(partial).length > 0 ? partial : null;
  }
}

function buildSummaryLine(snapshot: PersonaSnapshotFields): string {
  const parts: string[] = [];
  if (snapshot.clothing) {
    parts.push(`着装：${snapshot.clothing}`);
  }
  if (snapshot.appearance) {
    parts.push(`外貌：${snapshot.appearance}`);
  }
  if (snapshot.status) {
    parts.push(`状态：${snapshot.status}`);
  }
  if (snapshot.location) {
    parts.push(`位置：${snapshot.location}`);
  }
  if (snapshot.possessions) {
    parts.push(`持有：${snapshot.possessions}`);
  }
  return parts.join('；');
}

export function formatPersonaStateDisplay(state: string | undefined | null): string {
  const trimmed = state?.trim();
  if (!trimmed || trimmed === '待更新') {
    return '待更新';
  }

  const snapshot = tryParseSnapshotFromText(trimmed);
  if (snapshot) {
    const summaryLine = buildSummaryLine(snapshot);
    if (summaryLine) {
      return summaryLine;
    }
  }

  return trimmed;
}
