import type { ChapterItem } from '../services/api';

export function chapterLockActionLabel(isLocked: boolean | undefined): string {
  return isLocked === true ? '解锁' : '锁定';
}

export interface ChapterLockTarget {
  projectId: string;
  chapterNo: number;
}

/**
 * AQ-396：判断当前挂起的锁定目标是否就是刚完成的那个，按值比较 projectId + chapterNo。
 * 不能用引用相等：chapterLockTarget 是 ref()，其 value 是 reactive Proxy，与原始 target
 * 引用不等，=== 永远 false 会导致 finally 无法清空、按钮永久卡在「处理中」。
 */
export function isSameChapterLockTarget(
  current: ChapterLockTarget | null,
  completed: ChapterLockTarget
): boolean {
  return (
    current !== null &&
    current.projectId === completed.projectId &&
    current.chapterNo === completed.chapterNo
  );
}

/**
 * AQ-396：仅在服务端确认后回写锁定标记。请求期间用户可能已切换项目，
 * 过期项目的响应必须整体忽略；只替换目标章节的 isLocked，不动其余字段。
 */
export function applyChapterLockResult(
  chapters: ChapterItem[],
  target: ChapterLockTarget,
  currentProjectId: string,
  confirmed: { chapterNo: number; isLocked?: boolean }
): ChapterItem[] {
  if (target.projectId !== currentProjectId || confirmed.chapterNo !== target.chapterNo) {
    return chapters;
  }
  return chapters.map((chapter) =>
    chapter.chapterNo === target.chapterNo
      ? { ...chapter, isLocked: confirmed.isLocked === true }
      : chapter
  );
}
