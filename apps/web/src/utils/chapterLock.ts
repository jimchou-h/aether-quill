import type { ChapterItem } from '../services/api';

export function chapterLockActionLabel(isLocked: boolean | undefined): string {
  return isLocked === true ? '解锁' : '锁定';
}

export interface ChapterLockTarget {
  projectId: string;
  chapterNo: number;
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
