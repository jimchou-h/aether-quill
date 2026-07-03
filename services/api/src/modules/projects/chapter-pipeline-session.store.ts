/**
 * 分步精修 Session 内存存储（V1）
 */

import type { FinalPolishResult } from './chapter-pipeline.util';
import type { ChapterPipelineSession } from './chapter-pipeline.util';

const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const sessions = new Map<string, ChapterPipelineSession>();
const finalPolishCache = new Map<string, FinalPolishResult>();

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

/** 取本章最近一次未过期的创作精修 session（含一键终稿 pipeline session） */
export function findLatestPipelineSessionForChapter(
  projectId: string,
  chapterNo: number
): ChapterPipelineSession | undefined {
  let latest: ChapterPipelineSession | undefined;
  for (const session of sessions.values()) {
    if (session.projectId !== projectId || session.chapterNo !== chapterNo) {
      continue;
    }
    if (Date.now() - session.createdAt.getTime() > SESSION_TTL_MS) {
      continue;
    }
    if (!latest || session.createdAt.getTime() > latest.createdAt.getTime()) {
      latest = session;
    }
  }
  return latest;
}

export function clearPipelineSessionsForTest(): void {
  sessions.clear();
  finalPolishCache.clear();
}

export function buildFinalPolishCacheKey(
  projectId: string,
  chapterNo: number,
  fingerprint: string
): string {
  return `${projectId}:${chapterNo}:${fingerprint}`;
}

export function getFinalPolishCache(
  projectId: string,
  chapterNo: number,
  fingerprint: string
): FinalPolishResult | undefined {
  return finalPolishCache.get(buildFinalPolishCacheKey(projectId, chapterNo, fingerprint));
}

export function putFinalPolishCache(
  projectId: string,
  chapterNo: number,
  result: FinalPolishResult
): void {
  finalPolishCache.set(
    buildFinalPolishCacheKey(projectId, chapterNo, result.fingerprint),
    result
  );
}
