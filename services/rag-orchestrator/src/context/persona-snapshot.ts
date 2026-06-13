/**
 * 人物快照格式化（与 API `persona-snapshot.util.ts` 语义一致，编排层只读）
 *
 * `resolvePersonaSnapshotAsOfChapter`：取 currentChapterNo 之前最近一条按章状态记录。
 * `buildPersonaSnapshotSection`：输出【人物当前快照】段，供叙事上下文注入。
 */

export interface PersonaSnapshot {
  clothing?: string;
  appearance?: string;
  status?: string;
  location?: string;
  possessions?: string;
}

export interface PersonaChapterStateRecord {
  chapterNo: number;
  appeared: boolean;
  snapshot: PersonaSnapshot;
  summaryLine: string;
  updatedAt: string;
}

export interface PersonaContextPayload {
  name: string;
  profile: string;
  state: string;
  status: 'draft' | 'published';
  chapterStates?: PersonaChapterStateRecord[];
}

const SUMMARY_LINE_LIMIT = 120;

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

function formatPersonaSnapshotPromptLine(
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

export function buildPersonaSnapshotSection(input: {
  personas: PersonaContextPayload[];
  currentChapterNo?: number;
  mode?: 'all_published' | 'active_only';
}): { text: string; injectedCount: number; asOfChapterNo: number | null } {
  const mode = input.mode ?? 'all_published';
  const asOf =
    input.currentChapterNo && input.currentChapterNo > 0 ? input.currentChapterNo : null;
  const filtered =
    mode === 'all_published'
      ? input.personas.filter((persona) => persona.status === 'published')
      : input.personas;

  if (filtered.length === 0) {
    return { text: '', injectedCount: 0, asOfChapterNo: asOf };
  }

  const lines = filtered.map((persona) => {
    const record =
      asOf !== null ? resolvePersonaSnapshotAsOfChapter(persona.chapterStates, asOf) : null;
    return formatPersonaSnapshotPromptLine(persona.name, record, persona.state);
  });

  const anchor =
    asOf !== null && asOf > 1
      ? `（截至第 ${asOf - 1} 章结束，除非本章明确要求变化否则须保持一致）`
      : '（写首章时可自由设定，后续章节须与此保持一致）';

  return {
    text: `【人物当前快照】${anchor}\n${lines.join('\n')}`,
    injectedCount: lines.length,
    asOfChapterNo: asOf !== null && asOf > 1 ? asOf - 1 : null,
  };
}

export function clampSummaryLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.length > SUMMARY_LINE_LIMIT ? trimmed.slice(0, SUMMARY_LINE_LIMIT) : trimmed;
}
