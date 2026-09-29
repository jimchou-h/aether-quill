export const WRITING_OPTIMIZE_PASS_MIN = 1;
export const WRITING_OPTIMIZE_PASS_MAX = 3;
export const WRITING_OPTIMIZE_RUN_PREFS_STORAGE_KEY = 'aq.writingOptimize.runPrefs.v1';

export const WRITING_OPTIMIZE_PLAN_REFINE_FEEDBACK =
  '请在上一稿优化方案基础上按原始优化要求收紧：补足未覆盖的要求、删掉空泛项、让每条都可直接执行到正文。不得另起一套无关方案，不得输出章节正文。';

export interface WritingOptimizeRunPrefs {
  autoStartDraft: boolean;
  planPassCount: number;
  draftPassCount: number;
}

export const DEFAULT_WRITING_OPTIMIZE_RUN_PREFS: WritingOptimizeRunPrefs = {
  autoStartDraft: false,
  planPassCount: 1,
  draftPassCount: 1,
};

export function clampWritingOptimizePassCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return WRITING_OPTIMIZE_PASS_MIN;
  }
  return Math.min(
    WRITING_OPTIMIZE_PASS_MAX,
    Math.max(WRITING_OPTIMIZE_PASS_MIN, Math.round(numeric))
  );
}

export function parseWritingOptimizeRunPrefs(raw: unknown): WritingOptimizeRunPrefs {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_WRITING_OPTIMIZE_RUN_PREFS };
  }
  const record = raw as Record<string, unknown>;
  return {
    autoStartDraft: record.autoStartDraft === true,
    planPassCount: clampWritingOptimizePassCount(record.planPassCount),
    draftPassCount: clampWritingOptimizePassCount(record.draftPassCount),
  };
}

export function loadWritingOptimizeRunPrefs(
  storage: Pick<Storage, 'getItem'> | null | undefined = globalThis.localStorage
): WritingOptimizeRunPrefs {
  if (!storage) {
    return { ...DEFAULT_WRITING_OPTIMIZE_RUN_PREFS };
  }
  try {
    const raw = storage.getItem(WRITING_OPTIMIZE_RUN_PREFS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_WRITING_OPTIMIZE_RUN_PREFS };
    }
    return parseWritingOptimizeRunPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_WRITING_OPTIMIZE_RUN_PREFS };
  }
}

export function saveWritingOptimizeRunPrefs(
  prefs: WritingOptimizeRunPrefs,
  storage: Pick<Storage, 'setItem'> | null | undefined = globalThis.localStorage
): void {
  if (!storage) {
    return;
  }
  const normalized = parseWritingOptimizeRunPrefs(prefs);
  storage.setItem(WRITING_OPTIMIZE_RUN_PREFS_STORAGE_KEY, JSON.stringify(normalized));
}

export function formatWritingOptimizePassLabel(
  kind: 'plan' | 'draft',
  passIndex: number,
  passTotal: number
): string {
  const noun = kind === 'plan' ? '方案' : '正文';
  if (passTotal <= 1) {
    return kind === 'plan' ? '正在生成优化方案…' : '正在按方案改写正文…';
  }
  return `${noun}第 ${passIndex} / ${passTotal} 轮`;
}

export function resolveDraftSourceText(
  passIndex: number,
  previousDraft: string
): string | undefined {
  if (passIndex <= 1) {
    return undefined;
  }
  const trimmed = previousDraft.trim();
  return trimmed || undefined;
}
