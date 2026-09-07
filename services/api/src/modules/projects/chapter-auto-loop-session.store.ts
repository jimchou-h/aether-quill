/**
 * 自动优化循环会话内存存储（openspec: add-chapter-auto-optimize-loop）
 *
 * 循环单章要跑 5～15 分钟，而文笔优化弹窗是纯前端内存态：
 * 误关弹窗或刷新会丢掉全部成果。本 store 用于扛这类前端误操作。
 *
 * 已知限界：与 `chapter-pipeline-session.store` 同级——进程内 Map，不扛 API 重启。
 */

import type { AutoLoopRoundResult, AutoLoopStoppedReason } from './chapter-auto-loop.engine';

export const AUTO_LOOP_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface ChapterAutoLoopSession {
  projectId: string;
  chapterNo: number;
  userId?: string;
  instruction: string;
  roundBudget: number;
  /** 开跑时章节的 updatedAt，供 apply 走乐观锁 */
  baseUpdatedAt: string;
  storedContent: string;
  rounds: AutoLoopRoundResult[];
  finalDraft: string;
  stoppedReason: AutoLoopStoppedReason;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessions = new Map<string, ChapterAutoLoopSession>();

function sessionKey(projectId: string, chapterNo: number, userId?: string): string {
  return `${projectId}:${chapterNo}:${userId ?? '-'}`;
}

export function putAutoLoopSession(session: ChapterAutoLoopSession): void {
  sessions.set(sessionKey(session.projectId, session.chapterNo, session.userId), session);
}

/** 过期或不存在时返回 undefined——调用方应据此退回"可全新开始"，而非报错阻断 */
export function getAutoLoopSession(
  projectId: string,
  chapterNo: number,
  userId?: string
): ChapterAutoLoopSession | undefined {
  const key = sessionKey(projectId, chapterNo, userId);
  const session = sessions.get(key);
  if (!session) {
    return undefined;
  }
  if (Date.now() - session.createdAt.getTime() > AUTO_LOOP_SESSION_TTL_MS) {
    sessions.delete(key);
    return undefined;
  }
  return session;
}

export function deleteAutoLoopSession(projectId: string, chapterNo: number, userId?: string): void {
  sessions.delete(sessionKey(projectId, chapterNo, userId));
}

export function clearAutoLoopSessionsForTest(): void {
  sessions.clear();
}
