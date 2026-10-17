/**
 * B4 隔离夹具：专用项目 + 中性章节的可重复建立与清理。
 *
 * 每个测试跑在自己新建的项目里（项目名带随机后缀），章节正文是中性通用文本，
 * 不含真实作者内容；套件结束删除该项目。这样即使账号可用，也不会碰到首个真实项目。
 *
 * 章节保存走真实接口 `POST /api/projects/:id/knowledge/chapters`（带 JWT），
 * 不是 PATCH —— 浏览器 token 存在 localStorage，独立的 request fixture 必须显式带
 * Authorization 头，否则会被 401 拦掉（验收 R3 指出的缺口）。
 */

import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';

/** 中性章节正文：两场通用叙事，不含任何真实作品内容 */
export const NEUTRAL_CHAPTER_TITLE = '自动化中性样章';
export const NEUTRAL_CHAPTER_CONTENT = [
  '第一章 院里的两个人',
  '',
  '甲在院里等了很久，直到门被推开。乙从门外进来，把手里的东西放在石桌上，两个人开始低声说话。',
  '',
  '天色渐晚，院子里只剩下风声。甲送乙到门口，看着对方走远，才转身回屋，把门轻轻关上。',
].join('\n');

export interface RefinementFixture {
  token: string;
  projectId: string;
  chapterNo: number;
  api: APIRequestContext;
}

function requireBaseUrl(): string {
  // API 地址优先：E2E_BASE_URL 是 Web 地址（也能经 vite 代理打到 API，但直连更稳）
  const base =
    process.env.E2E_API_BASE_URL?.trim() ||
    process.env.E2E_BASE_URL?.trim() ||
    'http://127.0.0.1:3000';
  return base.replace(/\/$/, '');
}

async function loginToken(baseUrl: string): Promise<string> {
  const email = process.env.E2E_EMAIL?.trim();
  const password = process.env.E2E_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error('缺少 E2E_EMAIL / E2E_PASSWORD，无法建立隔离夹具');
  }
  const anonymous = await playwrightRequest.newContext({ baseURL: baseUrl });
  try {
    const response = await anonymous.post('/api/auth/login', { data: { email, password } });
    if (!response.ok()) {
      throw new Error(`登录失败 ${response.status()}：${(await response.text()).slice(0, 200)}`);
    }
    // 登录响应是统一包装：{ code, msg, data: { accessToken, refreshToken } }
    const data = (await response.json()) as {
      accessToken?: string;
      data?: { accessToken?: string };
    };
    const accessToken = data.accessToken ?? data.data?.accessToken;
    if (!accessToken) {
      throw new Error('登录响应缺少 accessToken');
    }
    return accessToken;
  } finally {
    await anonymous.dispose();
  }
}

/** API 统一响应包装：{ code, msg, data } —— 夹具里统一取 data。 */
function unwrap<T>(payload: unknown): T {
  const record = (payload ?? {}) as { data?: unknown };
  return (record.data ?? payload) as T;
}

/** 建立隔离项目与中性章节；返回带 JWT 的 API 上下文。 */
export async function createRefinementFixture(): Promise<RefinementFixture> {
  const baseUrl = requireBaseUrl();
  const token = await loginToken(baseUrl);
  const api = await playwrightRequest.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  const created = await api.post('/api/projects', {
    data: {
      name: `e2e-refinement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: '智能精修浏览器闭环自动化（临时，可删除）',
    },
  });
  if (!created.ok()) {
    throw new Error(
      `创建隔离项目失败 ${created.status()}：${(await created.text()).slice(0, 200)}`
    );
  }
  const project = unwrap<{ id?: string }>(await created.json());
  if (!project.id) {
    throw new Error('创建隔离项目响应缺少 id');
  }
  const fixture: RefinementFixture = { token, projectId: project.id, chapterNo: 1, api };
  await seedChapter(fixture, NEUTRAL_CHAPTER_CONTENT);
  return fixture;
}

/** 把章节正文重置为中性文本（每例独立初态）。 */
export async function seedChapter(fixture: RefinementFixture, content: string): Promise<void> {
  const response = await fixture.api.post(`/api/projects/${fixture.projectId}/knowledge/chapters`, {
    data: {
      chapterNo: fixture.chapterNo,
      title: NEUTRAL_CHAPTER_TITLE,
      content,
    },
  });
  if (!response.ok()) {
    throw new Error(
      `写入中性章节失败 ${response.status()}：${(await response.text()).slice(0, 200)}`
    );
  }
}

export interface PersistedChapter {
  content: string;
  title: string;
  summary: string | null;
  updatedAt: string | null;
}

export interface RefinementRunView {
  runId: string;
  status: string;
  revision: number;
  attemptId: string | null;
  acceptedDraftText: string;
  baseText: string;
  sourceCurrent: boolean;
}

/** 读取指定 run 的完整视图（含已接受候选稿与 revision），供断言首段接受稿 / 状态。 */
export async function readRefinementRunView(
  fixture: RefinementFixture,
  runId: string
): Promise<RefinementRunView> {
  const response = await fixture.api.get(
    `/api/projects/${fixture.projectId}/knowledge/chapters/${fixture.chapterNo}/optimize/refinement/runs/${encodeURIComponent(runId)}`
  );
  if (!response.ok()) {
    throw new Error(`读取精修运行 ${runId} 失败 ${response.status()}：${(await response.text()).slice(0, 200)}`);
  }
  const view = unwrap<{
    runId?: string;
    status?: string;
    revision?: number;
    attemptId?: string | null;
    acceptedDraftText?: string;
    baseText?: string;
    sourceCurrent?: boolean;
  }>(await response.json());
  return {
    runId: String(view.runId ?? runId),
    status: String(view.status ?? ''),
    revision: Number(view.revision ?? 0),
    attemptId: view.attemptId === undefined ? null : view.attemptId,
    acceptedDraftText: String(view.acceptedDraftText ?? ''),
    baseText: String(view.baseText ?? ''),
    sourceCurrent: view.sourceCurrent === true,
  };
}

/** 读取持久化章节（用于与 UI 展示、API 返回结果做全等比较）。 */export async function readChapter(fixture: RefinementFixture): Promise<PersistedChapter> {
  const response = await fixture.api.get(`/api/projects/${fixture.projectId}/knowledge`);
  if (!response.ok()) {
    throw new Error(`读取章节失败 ${response.status()}`);
  }
  const knowledge = unwrap<{ chapters?: Array<Record<string, unknown>> }>(await response.json());
  const chapter = (knowledge.chapters ?? []).find(
    (item) => Number(item.chapterNo) === fixture.chapterNo
  );
  if (!chapter) {
    throw new Error(`未找到第 ${fixture.chapterNo} 章`);
  }
  return {
    content: String(chapter.content ?? ''),
    title: String(chapter.title ?? ''),
    summary:
      chapter.summary === undefined || chapter.summary === null ? null : String(chapter.summary),
    updatedAt:
      chapter.updatedAt === undefined || chapter.updatedAt === null
        ? null
        : String(chapter.updatedAt),
  };
}

/**
 * 清理该章节上的历史精修运行（每例从干净状态开始）。
 *
 * 合同（对齐 `listRuns` / `discardRun`）：
 * - `GET .../runs` 返回 `RefinementRunSummary[]`（数组，不是 `{ runs: [...] }`），
 *   每项带 `runId` 与 `revision`；
 * - `POST .../runs/:runId/discard` 要求 body 带 `{ expectedRunRevision }`（正整数），
 *   缺失会 1400；revision 失配会 1409；
 * - 4xx 不会自动 reject Playwright request，必须检查 `.ok()`，否则失败被误当成功。
 *
 * 清理会先中止在途尝试（discard 内部 abort），确保上一例仍在后台的运行不会污染
 * 新例的调用计数、预算与原文版本。
 */
export async function discardRefinementRuns(fixture: RefinementFixture): Promise<void> {
  const list = await fixture.api.get(
    `/api/projects/${fixture.projectId}/knowledge/chapters/${fixture.chapterNo}/optimize/refinement/runs`
  );
  if (!list.ok()) {
    throw new Error(`读取精修运行列表失败 ${list.status()}：${(await list.text()).slice(0, 200)}`);
  }
  const runs = unwrap<Array<{ runId?: string; revision?: number }>>(await list.json());
  for (const run of runs) {
    if (!run.runId) {
      continue;
    }
    const revision = Number(run.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error(`精修运行 ${run.runId} 缺少有效 revision，无法安全丢弃`);
    }
    const response = await fixture.api.post(
      `/api/projects/${fixture.projectId}/knowledge/chapters/${fixture.chapterNo}/optimize/refinement/runs/${run.runId}/discard`,
      { data: { expectedRunRevision: revision } }
    );
    if (!response.ok()) {
      throw new Error(
        `丢弃精修运行 ${run.runId} 失败 ${response.status()}：${(await response.text()).slice(0, 200)}`
      );
    }
  }
}

/** 删除隔离项目。 */
export async function deleteRefinementFixture(fixture: RefinementFixture): Promise<void> {
  await fixture.api.delete(`/api/projects/${fixture.projectId}`).catch(() => undefined);
  await fixture.api.dispose().catch(() => undefined);
}
