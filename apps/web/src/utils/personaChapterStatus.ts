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
};

function displayFromRecord(record: PersonaStatusChapterRecord, fallbackState?: string | null): string {
  const summary = record.summaryLine?.trim();
  if (summary) {
    return summary;
  }
  return formatPersonaStateDisplay(fallbackState);
}

/**
 * Resolve persona status for Persona settings UI.
 * - latest: persona.state mirror
 * - asOfChapterNo N: latest chapterStates entry with chapterNo <= N (inclusive「截至第 N 章」)
 */
export function resolvePersonaStatusForView(
  persona: PersonaStatusViewInput,
  mode: PersonaStatusViewMode
): PersonaStatusViewResult {
  if (mode === 'latest') {
    return {
      text: formatPersonaStateDisplay(persona.state),
      sourceChapterNo: null,
    };
  }

  const asOf = mode.asOfChapterNo;
  const states = persona.chapterStates ?? [];
  if (!Number.isFinite(asOf) || asOf < 1 || states.length === 0) {
    return {
      text: formatPersonaStateDisplay(persona.state),
      sourceChapterNo: null,
    };
  }

  let best: PersonaStatusChapterRecord | null = null;
  for (const record of states) {
    if (record.chapterNo <= asOf && (!best || record.chapterNo > best.chapterNo)) {
      best = record;
    }
  }

  if (!best) {
    return {
      text: formatPersonaStateDisplay(persona.state),
      sourceChapterNo: null,
    };
  }

  return {
    text: displayFromRecord(best, persona.state),
    sourceChapterNo: best.chapterNo,
  };
}

export function collectPersonaStatusChapterOptions(
  personas: Array<{ chapterStates?: PersonaStatusChapterRecord[]; appearedChapterNos?: number[] }>
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
  return [...set].sort((a, b) => a - b);
}
