/**
 * 自动优化循环会话内存存储（openspec: add-chapter-auto-optimize-loop）
 *
 * 循环单章要跑 5～15 分钟，而文笔优化弹窗是纯前端内存态：
 * 误关弹窗或刷新会丢掉全部成果。本 store 用于扛这类前端误操作。
 *
 * 已知限界：与 `chapter-pipeline-session.store` 同级——进程内 Map，不扛 API 重启。
 */

import type {
  AutoLoopResumeState,
  AutoLoopRoundResult,
  AutoLoopStoppedReason,
  AutoLoopResumeStage,
} from './chapter-auto-loop.engine';
import { summarizeAutoLoopResume } from './chapter-auto-loop.engine';
import type { AutoLoopPromptLabCall } from './chapter-auto-loop-prompt-lab';

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
  resumable?: boolean;
  resumeStage?: AutoLoopResumeStage;
  resumeRoundIndex?: number;
  resumeSegmentIndex?: number;
  resumeSegmentTotal?: number;
  resumeWindowIndex?: number;
  resumeWindowTotal?: number;
  inProgressItems?: AutoLoopRoundResult['items'];
  promptLabCalls?: AutoLoopPromptLabCall[];
  /** 仅服务端续跑使用，GET 时剥离 */
  resume?: AutoLoopResumeState;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicChapterAutoLoopSession = Omit<ChapterAutoLoopSession, 'resume'>;

const sessions = new Map<string, ChapterAutoLoopSession>();

function sessionKey(projectId: string, chapterNo: number, userId?: string): string {
  return `${projectId}:${chapterNo}:${userId ?? '-'}`;
}

export function putAutoLoopSession(session: ChapterAutoLoopSession): void {
  const summary = summarizeAutoLoopResume(session.resume);
  sessions.set(sessionKey(session.projectId, session.chapterNo, session.userId), {
    ...session,
    resumable: summary.resumable,
    resumeStage: summary.resumeStage,
    resumeRoundIndex: summary.resumeRoundIndex,
    resumeSegmentIndex: summary.resumeSegmentIndex,
    resumeSegmentTotal: summary.resumeSegmentTotal,
    resumeWindowIndex: summary.resumeWindowIndex,
    resumeWindowTotal: summary.resumeWindowTotal,
    inProgressItems: summary.inProgressItems,
  });
}

export function toPublicAutoLoopSession(
  session: ChapterAutoLoopSession
): PublicChapterAutoLoopSession {
  const { resume, ...publicSession } = session;
  void resume;
  return publicSession;
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
  const touchedAt = session.updatedAt?.getTime() ?? session.createdAt.getTime();
  if (Date.now() - touchedAt > AUTO_LOOP_SESSION_TTL_MS) {
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
