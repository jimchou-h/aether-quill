/**
 * 分步精修 Session 内存存储（V1）
 */

import type { ChapterPipelineSession } from './chapter-pipeline.util';

const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const sessions = new Map<string, ChapterPipelineSession>();

export function putPipelineSession(session: ChapterPipelineSession): void {
  sessions.set(session.sessionId, session);
}

export function getPipelineSession(sessionId: string): ChapterPipelineSession | undefined {
  const session = sessions.get(sessionId);
  if (!session) {
    return undefined;
  }
  if (Date.now() - session.createdAt.getTime() > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return undefined;
  }
  return session;
}

export function deletePipelineSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function clearPipelineSessionsForTest(): void {
  sessions.clear();
}
