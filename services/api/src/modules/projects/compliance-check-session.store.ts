/**
 * 终稿合规检验 Session 内存存储（V1）
 */

import type { ComplianceCheckSession } from './compliance-check.util';

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

const sessions = new Map<string, ComplianceCheckSession>();
const activeByChapter = new Map<string, string>();

function chapterKey(projectId: string, chapterNo: number): string {
  return `${projectId}:${chapterNo}`;
}

export function putComplianceSession(session: ComplianceCheckSession): void {
  sessions.set(session.sessionId, session);
  if (session.status !== 'applied' && session.status !== 'cancelled') {
    activeByChapter.set(chapterKey(session.projectId, session.chapterNo), session.sessionId);
  }
}

export function getComplianceSession(sessionId: string): ComplianceCheckSession | undefined {
  const session = sessions.get(sessionId);
  if (!session) {
    return undefined;
  }
  if (Date.now() - session.createdAt.getTime() > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    activeByChapter.delete(chapterKey(session.projectId, session.chapterNo));
    return undefined;
  }
  return session;
}

export function findActiveComplianceSession(
  projectId: string,
  chapterNo: number
): ComplianceCheckSession | undefined {
  const sessionId = activeByChapter.get(chapterKey(projectId, chapterNo));
  if (!sessionId) {
    return undefined;
  }
  return getComplianceSession(sessionId);
}

export function clearComplianceSessionsForTest(): void {
  sessions.clear();
  activeByChapter.clear();
}
