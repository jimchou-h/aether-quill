import { formatPersonaStateDisplay } from './personaStateDisplay';

export type PersonaStatusChapterRecord = {
  chapterNo: number;
  summaryLine?: string;
  snapshot?: unknown;
};

export type PersonaStatusViewInput = {
  state?: string | null;
  chapterStates?: PersonaStatusChapterRecord[];
};

export type PersonaStatusViewMode = 'latest' | { asOfChapterNo: number };

export type PersonaStatusViewResult = {
  text: string;
  sourceChapterNo: number | null;
  /** true when text comes from a chapterStates snapshot */
  usedSnapshot: boolean;
};

function displayFromRecord(
  record: PersonaStatusChapterRecord,
  fallbackState?: string | null
): string {
  const summary = record.summaryLine?.trim();
  if (summary) {
    return summary;
  }
  return formatPersonaStateDisplay(fallbackState);
}

function emptyAsOfText(asOfChapterNo: number): string {
  return `截至第${asOfChapterNo}章尚无快照`;
}

/**
 * Resolve persona status for Persona settings UI.
 * - latest: persona.state mirror
 * - asOfChapterNo N: latest chapterStates entry with chapterNo <= N (inclusive「截至第 N 章」)
 * - as-of with no matching snapshot: distinct empty text (not silent fallback to latest)
 */
export function resolvePersonaStatusForView(
  persona: PersonaStatusViewInput,
  mode: PersonaStatusViewMode
): PersonaStatusViewResult {
  if (mode === 'latest') {
    return {
      text: formatPersonaStateDisplay(persona.state),
      sourceChapterNo: null,
      usedSnapshot: false,
    };
  }

  const asOf = mode.asOfChapterNo;
  if (!Number.isFinite(asOf) || asOf < 1) {
    return {
      text: formatPersonaStateDisplay(persona.state),
      sourceChapterNo: null,
      usedSnapshot: false,
    };
  }

  const states = persona.chapterStates ?? [];
  let best: PersonaStatusChapterRecord | null = null;
  for (const record of states) {
    if (record.chapterNo <= asOf && (!best || record.chapterNo > best.chapterNo)) {
      best = record;
    }
  }

  if (!best) {
    return {
      text: emptyAsOfText(asOf),
      sourceChapterNo: null,
      usedSnapshot: false,
    };
  }

  return {
    text: displayFromRecord(best, persona.state),
    sourceChapterNo: best.chapterNo,
    usedSnapshot: true,
  };
}

/**
 * Dropdown chapters = 有快照的章 + 出场章 + 可选项目章节列表。
 * 无快照时 as-of 会显示「截至第N章尚无快照」，避免与「最新」看起来一样。
 */
export function collectPersonaStatusChapterOptions(
  personas: Array<{ chapterStates?: PersonaStatusChapterRecord[]; appearedChapterNos?: number[] }>,
  extraChapterNos: number[] = []
): number[] {
  const set = new Set<number>();
  for (const persona of personas) {
    for (const record of persona.chapterStates ?? []) {
      if (Number.isFinite(record.chapterNo) && record.chapterNo >= 1) {
        set.add(record.chapterNo);
      }
    }
    for (const chapterNo of persona.appearedChapterNos ?? []) {
      if (Number.isFinite(chapterNo) && chapterNo >= 1) {
        set.add(chapterNo);
      }
    }
  }
  for (const chapterNo of extraChapterNos) {
    if (Number.isFinite(chapterNo) && chapterNo >= 1) {
      set.add(chapterNo);
    }
  }
  return [...set].sort((a, b) => a - b);
}
