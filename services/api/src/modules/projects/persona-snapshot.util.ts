export interface PersonaSnapshot {
  /** 着装，如「深灰三件套西装、白衬衫」 */
  clothing?: string;
  /** 相对稳定的外貌特征（发型、体型等） */
  appearance?: string;
  /** 瞬时状态：情绪、伤势、醉酒、疲劳等 */
  status?: string;
  /** 当前/末次位置 */
  location?: string;
  /** 关键持有物 */
  possessions?: string;
}

export interface PersonaChapterStateRecord {
  chapterNo: number;
  appeared: boolean;
  snapshot: PersonaSnapshot;
  summaryLine: string;
  updatedAt: string;
}

const SNAPSHOT_FIELD_LIMIT = 80;
const SUMMARY_LINE_LIMIT = 120;

function clampField(value: string | undefined, max = SNAPSHOT_FIELD_LIMIT): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function normalizePersonaSnapshot(raw: unknown): PersonaSnapshot {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const record = raw as Record<string, unknown>;
  return {
    clothing: clampField(typeof record.clothing === 'string' ? record.clothing : undefined),
    appearance: clampField(typeof record.appearance === 'string' ? record.appearance : undefined),
    status: clampField(typeof record.status === 'string' ? record.status : undefined),
    location: clampField(typeof record.location === 'string' ? record.location : undefined),
    possessions: clampField(typeof record.possessions === 'string' ? record.possessions : undefined),
  };
}

export function snapshotFromLegacyState(state: string | undefined): PersonaSnapshot {
  const trimmed = state?.trim();
  if (!trimmed || trimmed === '待更新') {
    return {};
  }
  return { status: clampField(trimmed) };
}

export function buildSummaryLineFromSnapshot(snapshot: PersonaSnapshot): string {
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
  const line = parts.join('；');
  if (!line) {
    return '';
  }
  return line.length > SUMMARY_LINE_LIMIT ? line.slice(0, SUMMARY_LINE_LIMIT) : line;
}

export function resolvePersonaSnapshotAsOfChapter(
  chapterStates: PersonaChapterStateRecord[] | undefined,
  asOfBeforeChapterNo: number
): PersonaChapterStateRecord | null {
  if (!chapterStates?.length || !Number.isFinite(asOfBeforeChapterNo) || asOfBeforeChapterNo <= 1) {
    return null;
  }
  let best: PersonaChapterStateRecord | null = null;
  for (const record of chapterStates) {
    if (
      record.chapterNo < asOfBeforeChapterNo &&
      (!best || record.chapterNo > best.chapterNo)
    ) {
      best = record;
    }
  }
  return best;
}

export function upsertPersonaChapterState(
  chapterStates: PersonaChapterStateRecord[] | undefined,
  input: {
    chapterNo: number;
    appeared: boolean;
    snapshot: PersonaSnapshot;
    summaryLine: string;
    updatedAt?: string;
  }
): PersonaChapterStateRecord[] {
  const nextRecord: PersonaChapterStateRecord = {
    chapterNo: input.chapterNo,
    appeared: input.appeared,
    snapshot: normalizePersonaSnapshot(input.snapshot),
    summaryLine:
      input.summaryLine.trim().slice(0, SUMMARY_LINE_LIMIT) ||
      buildSummaryLineFromSnapshot(input.snapshot),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
  const list = [...(chapterStates ?? [])];
  const index = list.findIndex((item) => item.chapterNo === input.chapterNo);
  if (index >= 0) {
    list[index] = nextRecord;
  } else {
    list.push(nextRecord);
    list.sort((a, b) => a.chapterNo - b.chapterNo);
  }
  return list;
}

export function formatPersonaSnapshotPromptLine(
  name: string,
  record: PersonaChapterStateRecord | null,
  fallbackState?: string
): string {
  if (record?.summaryLine?.trim()) {
    const prefix = record.appeared ? '' : '本章未出场，沿用：';
    return `${name}：${prefix}${record.summaryLine.trim()}（截至第${record.chapterNo}章）`;
  }
  const fallback = fallbackState?.trim();
  if (fallback && fallback !== '待更新') {
    return `${name}：${fallback}（手工状态，截至最新）`;
  }
  return `${name}：暂无快照`;
}

export function buildPersonaSnapshotsForPrompt(input: {
  personas: Array<{
    name: string;
    state: string;
    status: 'draft' | 'published';
    chapterStates?: PersonaChapterStateRecord[];
  }>;
  currentChapterNo?: number;
  mode?: 'all_published' | 'active_only';
}): Array<{ name: string; line: string; asOfChapterNo: number | null }> {
  const mode = input.mode ?? 'all_published';
  const asOf = input.currentChapterNo && input.currentChapterNo > 0 ? input.currentChapterNo : null;
  const filtered =
    mode === 'all_published'
      ? input.personas.filter((persona) => persona.status === 'published')
      : input.personas;

  return filtered.map((persona) => {
    const record =
      asOf !== null ? resolvePersonaSnapshotAsOfChapter(persona.chapterStates, asOf) : null;
    return {
      name: persona.name,
      line: formatPersonaSnapshotPromptLine(persona.name, record, persona.state),
      asOfChapterNo: record?.chapterNo ?? null,
    };
  });
}
