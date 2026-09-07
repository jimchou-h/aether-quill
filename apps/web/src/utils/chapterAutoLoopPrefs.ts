/**
 * 自动优化循环的运行偏好（openspec: add-chapter-auto-optimize-loop）
 *
 * 与 `writingOptimizeMultiPass` 的 pass 偏好分开存：那边是「方案/正文各跑几遍」，
 * 这边是「复诊-改写循环跑几轮」，语义不同，混在一个 key 里会互相污染。
 */

export const AUTO_LOOP_ROUND_BUDGET_MIN = 1;
export const AUTO_LOOP_ROUND_BUDGET_MAX = 3;
export const AUTO_LOOP_ROUND_BUDGET_DEFAULT = 2;
export const CHAPTER_AUTO_LOOP_PREFS_STORAGE_KEY = 'aq.chapterAutoLoop.prefs.v1';

export interface ChapterAutoLoopPrefs {
  roundBudget: number;
}

export const DEFAULT_CHAPTER_AUTO_LOOP_PREFS: ChapterAutoLoopPrefs = {
  roundBudget: AUTO_LOOP_ROUND_BUDGET_DEFAULT,
};

/** 与后端 `clampAutoLoopRoundBudget` 同带宽，前端先夹一次以免无谓的 400 往返。 */
export function clampAutoLoopRoundBudget(value: unknown): number {
  // null / '' 是「未提供」而非 0：`Number(null) === 0` 会把缺省值夹成下限 1
  if (value === undefined || value === null || value === '') {
    return AUTO_LOOP_ROUND_BUDGET_DEFAULT;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return AUTO_LOOP_ROUND_BUDGET_DEFAULT;
  }
  return Math.min(
    AUTO_LOOP_ROUND_BUDGET_MAX,
    Math.max(AUTO_LOOP_ROUND_BUDGET_MIN, Math.round(numeric))
  );
}

export function parseChapterAutoLoopPrefs(raw: unknown): ChapterAutoLoopPrefs {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CHAPTER_AUTO_LOOP_PREFS };
  }
  const record = raw as Record<string, unknown>;
  return { roundBudget: clampAutoLoopRoundBudget(record.roundBudget) };
}

export function loadChapterAutoLoopPrefs(
  storage: Pick<Storage, 'getItem'> | null | undefined = globalThis.localStorage
): ChapterAutoLoopPrefs {
  if (!storage) {
    return { ...DEFAULT_CHAPTER_AUTO_LOOP_PREFS };
  }
  try {
    const raw = storage.getItem(CHAPTER_AUTO_LOOP_PREFS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_CHAPTER_AUTO_LOOP_PREFS };
    }
    return parseChapterAutoLoopPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_CHAPTER_AUTO_LOOP_PREFS };
  }
}

export function saveChapterAutoLoopPrefs(
  prefs: ChapterAutoLoopPrefs,
  storage: Pick<Storage, 'setItem'> | null | undefined = globalThis.localStorage
): void {
  if (!storage) {
    return;
  }
  storage.setItem(
    CHAPTER_AUTO_LOOP_PREFS_STORAGE_KEY,
    JSON.stringify(parseChapterAutoLoopPrefs(prefs))
  );
}
