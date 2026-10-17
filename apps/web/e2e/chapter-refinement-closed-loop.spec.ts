/**
 * B4（AQ-385）：假模型下的**浏览器完整作者路径**闭环。
 *
 * 走真实 Web + 真实 API + 真实 service/engine + 真实 SSE + 真实 apply，
 * 只把「模型」替换为可控假编排器（`e2e/support/fake-orchestrator.mjs`）。
 * 不在浏览器侧 mock API 响应；网络 mock 只用于故障注入（创建响应丢失 / 接口失败）。
 *
 * 隔离：每套运行新建专用项目（`e2e-refinement-<ts>-<rand>`）与中性章节，
 * 套件结束删除该项目；每例开始重置章节正文并清理旧 run。不使用真实作者章节。
 *
 * 前置：
 * - `E2E_EMAIL` / `E2E_PASSWORD`：测试环境账号（仅用于建立/删除隔离项目）；
 * - `E2E_FAKE_ORCHESTRATOR_URL`：假编排器地址（默认 http://127.0.0.1:4409，
 *   与 `fake-orchestrator.mjs` 的默认端口一致；API 侧 `RAG_ORCHESTRATOR_URL` 必须指向它）；
 * - `E2E_BASE_URL`：已启动的 Web 地址（默认 http://127.0.0.1:5173）；
 * - `E2E_API_BASE_URL`：API 地址（默认 http://127.0.0.1:3000），用于隔离夹具。
 *
 * 缺少前置时整组 skip（不算通过）。控制时机一律用阶段屏障 / 等待条件，不用固定 sleep 代替断言。
 */

import { expect, test, type Page } from '@playwright/test';
import { loginViaUi } from './helpers';
import {
  createRefinementFixture,
  deleteRefinementFixture,
  discardRefinementRuns,
  NEUTRAL_CHAPTER_CONTENT,
  readChapter,
  readRefinementRunView,
  seedChapter,
  type RefinementFixture,
} from './support/refinement-fixture';

const FAKE_URL = process.env.E2E_FAKE_ORCHESTRATOR_URL?.trim() || 'http://127.0.0.1:4409';
const HAS_CREDENTIALS = Boolean(process.env.E2E_EMAIL?.trim() && process.env.E2E_PASSWORD?.trim());
const ENABLED = Boolean(HAS_CREDENTIALS);
const SKIP_REASON =
  '需要 E2E_EMAIL / E2E_PASSWORD（建立隔离项目用）与已启动的 Web / API / 假编排器';

const REWRITE_KEY = 'chapter.refinement.rewrite';
const CREATE_RUN_PATH = /\/optimize\/refinement\/runs$/;

/** E1 注入：一条无 anchorQuote 的高严重度阻断（不可定位 → 无法自动结案）。 */
const BLOCKING_REVIEW = JSON.stringify({
  issues: [
    {
      kind: 'continuity',
      severity: 'high',
      anchorQuote: '',
      expectedFact: '补回缺失的承接',
      sourceEvidence: '（脚本注入的不可定位阻断）',
      fixIntent: '补齐承接',
    },
  ],
  exitStateFacts: [],
});

/** ready_with_issues：低严重度未解决项不阻断，但需作者逐条确认。 */
const LOW_ISSUE_REVIEW = JSON.stringify({
  issues: [
    {
      kind: 'style',
      severity: 'low',
      anchorQuote: '风声',
      expectedFact: '补一处更具体的环境描写',
      sourceEvidence: '（脚本注入的低严重度提示）',
      fixIntent: '让环境更具体',
    },
  ],
  exitStateFacts: [],
});

interface ScriptPatch {
  script?: Record<string, unknown>;
  hang?: string[];
  fail?: string[];
  hangAfterNth?: Record<string, number>;
  failAfterNth?: Record<string, number>;
}

async function control(patch: ScriptPatch): Promise<void> {
  const response = await fetch(`${FAKE_URL}/__control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  expect(response.ok).toBeTruthy();
}

async function calls(): Promise<Array<{ templateKey: string }>> {
  const response = await fetch(`${FAKE_URL}/__calls`);
  const data = (await response.json()) as { calls: Array<{ templateKey: string }> };
  return data.calls;
}

async function reset(): Promise<void> {
  await fetch(`${FAKE_URL}/__reset`, { method: 'POST' });
}

/** 用夹具 JWT 直接读该章节的 run 摘要列表（服务端权威状态，独立于浏览器 UI）。 */
async function listRunSummaries(
  target: RefinementFixture
): Promise<Array<{ runId: string; status: string }>> {
  const response = await target.api.get(
    `/api/projects/${target.projectId}/knowledge/chapters/${target.chapterNo}/optimize/refinement/runs`
  );
  if (!response.ok()) {
    throw new Error(`读取精修运行列表失败 ${response.status()}`);
  }
  const text = await response.text();
  const payload = JSON.parse(text) as { data?: unknown };
  const list = Array.isArray(payload.data) ? payload.data : [];
  return list.map((item) => {
    const record = (item ?? {}) as { runId?: string; status?: string };
    return { runId: String(record.runId ?? ''), status: String(record.status ?? '') };
  });
}

function countCalls(list: Array<{ templateKey: string }>, key: string): number {
  return list.filter((item) => item.templateKey === key).length;
}

async function openRefinementPanel(page: Page, projectId: string): Promise<void> {
  // 智能精修是草稿入口：只有 URL 显式带 ?refinement=1 时才渲染（ChapterOptimizeDialog.vue）
  await page.goto(`/projects/${projectId}/chapters?refinement=1`);
  await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole('button', { name: /章节优化|文笔优化/ })
    .first()
    .click();
  const dialog = page
    .locator('.ant-modal')
    .filter({ hasText: /文笔优化/ })
    .first();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog
    .getByRole('button', { name: /智能精修/ })
    .first()
    .click();
  await expect(page.locator('.refinement-panel').first()).toBeVisible({ timeout: 15_000 });
}

async function startRefinement(page: Page): Promise<void> {
  const panel = page.locator('.refinement-panel').first();
  await panel.locator('#chapter-refinement-instruction').fill('收紧节奏，保持剧情与人物状态不变。');
  await panel.getByRole('button', { name: /开始智能精修/ }).click();
}

function panel(page: Page) {
  return page.locator('.refinement-panel').first();
}

/** 等到终态（ready / ready_with_issues）且应用按钮 enabled（不是仅可见）。 */
async function waitForApplyReady(page: Page): Promise<void> {
  // 先断言终态：面板 status 进入 ready / ready_with_issues，避免在 running/paused
  // 阶段就抢跑（此时按钮可见但禁用）。
  await expect
    .poll(async () => panel(page).getAttribute('data-status'), { timeout: 90_000 })
    .toMatch(/^(ready|ready_with_issues)$/);
  // 再等应用按钮真正可点（enabled）
  await expect(
    panel(page)
      .getByRole('button', { name: /应用候选稿/ })
      .first()
  ).toBeEnabled({
    timeout: 30_000,
  });
}

test.describe('chapter refinement closed loop with scripted model (B4)', () => {
  test.skip(!ENABLED, SKIP_REASON);

  let fixture: RefinementFixture;

  test.beforeAll(async () => {
    fixture = await createRefinementFixture();
  });

  test.afterAll(async () => {
    if (fixture) {
      await deleteRefinementFixture(fixture);
    }
  });

  test.beforeEach(async () => {
    // 先停掉上一例仍在后台的运行（discard 内部会中止在途尝试），
    // 避免跨例迟到请求污染本例的调用计数、预算与原文版本；再重置脚本与正文。
    await discardRefinementRuns(fixture);
    await reset();
    await seedChapter(fixture, NEUTRAL_CHAPTER_CONTENT);
  });

  test('1) 启动看到进度 → 刷新后同 run 恢复，临时稿不冒充接受稿', async ({ page }) => {
    await control({ hangAfterNth: { [REWRITE_KEY]: 0 } });
    await loginViaUi(page);
    await openRefinementPanel(page, fixture.projectId);
    await startRefinement(page);

    // 阶段屏障：确实发起了改写调用（进度已产生）
    await expect
      .poll(async () => countCalls(await calls(), REWRITE_KEY) >= 1, { timeout: 60_000 })
      .toBe(true);

    const runIdBefore = await panel(page).getAttribute('data-run-id');
    expect(runIdBefore).toBeTruthy();

    // 刷新后页面回到章节主页面，弹窗关闭（?refinement=1 只显示受控入口，不自动开弹窗）
    await page.reload();
    await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });
    await expect(panel(page)).toHaveCount(0);

    // 重开两层弹窗后，同 run 被恢复（restore 按 run 列表找回活动 run）
    await openRefinementPanel(page, fixture.projectId);
    await expect
      .poll(async () => panel(page).getAttribute('data-run-id'), { timeout: 30_000 })
      .toBe(runIdBefore);

    // 未确认应用的临时稿不得进入正文
    const persisted = await readChapter(fixture);
    expect(persisted.content).toBe(NEUTRAL_CHAPTER_CONTENT);
    await expect(page.locator('.content-text').first()).toContainText('甲在院里等了很久');
  });

  test('2) 取消（含确认弹窗）保留接受稿 → 继续后同 run 新 attempt，旧调用不覆写', async ({
    page,
  }) => {
    // 停靠点：第一段（b1）改写完成并被接受，第二段（b2）在途挂起。
    // 两场脚本由假编排器默认 plan 提供（标题 keep + 两段正文各自 rewrite），
    // 因此会真实产生两次 rewrite 调用；hangAfterNth=1 让第二次在途。
    await control({
      script: { rewrite: ['（脚本改写一）', '（脚本改写二）'] },
      hangAfterNth: { [REWRITE_KEY]: 1 },
    });
    await loginViaUi(page);
    await openRefinementPanel(page, fixture.projectId);
    await startRefinement(page);

    // 阶段屏障：第二次改写已发起（第一次已返回并被接受，第二次在途）
    await expect
      .poll(async () => countCalls(await calls(), REWRITE_KEY) >= 2, { timeout: 60_000 })
      .toBe(true);

    const runId = await panel(page).getAttribute('data-run-id');
    expect(runId).toBeTruthy();

    // 取消前：首个范围（改写一）的接受稿已随 checkpoint 持久化，未被未完成的第二段冲掉
    const viewBeforeCancel = await readRefinementRunView(fixture, runId!);
    expect(viewBeforeCancel.acceptedDraftText).toContain('（脚本改写一）');
    // 标题保持不动（keep），仍保留原标题
    expect(viewBeforeCancel.acceptedDraftText).toContain('第一章 院里的两个人');

    await panel(page)
      .getByRole('button', { name: /取消精修/ })
      .first()
      .click();
    // 取消是二次确认：必须显式点「确认取消」
    const confirmDialog = page.locator('.ant-modal-confirm').filter({ hasText: '取消智能精修' });
    await expect(confirmDialog).toBeVisible({ timeout: 15_000 });
    await confirmDialog.getByRole('button', { name: '确认取消' }).click();

    await expect(
      panel(page)
        .getByRole('button', { name: /继续精修/ })
        .first()
    ).toBeVisible({
      timeout: 60_000,
    });
    const attemptBefore = await panel(page).getAttribute('data-attempt-id');
    const callsBefore = (await calls()).length;

    // 取消后：已接受稿仍保留（不在途的迟到结果不得覆盖已接受的第一段）
    const viewAfterCancel = await readRefinementRunView(fixture, runId!);
    expect(viewAfterCancel.acceptedDraftText).toContain('（脚本改写一）');

    await panel(page)
      .getByRole('button', { name: /继续精修/ })
      .first()
      .click();
    await expect
      .poll(async () => (await calls()).length > callsBefore, { timeout: 60_000 })
      .toBe(true);

    expect(await panel(page).getAttribute('data-run-id')).toBe(runId);
    // 继续后是同一 run 的新一次执行尝试
    expect(await panel(page).getAttribute('data-attempt-id')).not.toBe(attemptBefore);
    // 取消时不覆盖章节正文（候选稿只存在于 run）
    expect((await readChapter(fixture)).content).toBe(NEUTRAL_CHAPTER_CONTENT);
    // 继续后首个范围的接受稿仍保留（resume 复用 checkpoint，不重跑已接受单位）
    const viewAfterResume = await readRefinementRunView(fixture, runId!);
    expect(viewAfterResume.acceptedDraftText).toContain('（脚本改写一）');
  });

  test('3) 完成后再次开始：新 run 新 clientRequestId；创建响应丢失后重试复用原 key', async ({
    page,
  }) => {
    const createKeys: string[] = [];
    await page.route(CREATE_RUN_PATH, async (route) => {
      const post = route.request().postDataJSON() as { clientRequestId?: string } | null;
      if (post?.clientRequestId) {
        createKeys.push(post.clientRequestId);
      }
      await route.continue();
    });

    await control({ script: { rewrite: ['（脚本改写一）'] } });
    await loginViaUi(page);
    await openRefinementPanel(page, fixture.projectId);
    await startRefinement(page);
    await waitForApplyReady(page);
    const firstRunId = await panel(page).getAttribute('data-run-id');

    // 按钮始终是「开始智能精修」，没有「重新开始 / 再次精修」
    await panel(page)
      .getByRole('button', { name: /开始智能精修/ })
      .click();
    await expect
      .poll(async () => panel(page).getAttribute('data-run-id'), { timeout: 60_000 })
      .not.toBe(firstRunId);
    await expect.poll(() => createKeys.length, { timeout: 30_000 }).toBe(2);
    expect(createKeys[0]).not.toBe(createKeys[1]);

    // 第二个 run 完成后「开始智能精修」按钮才重新可用（isBusy = starting || active）
    await expect
      .poll(async () => {
        const button = panel(page)
          .getByRole('button', { name: /开始智能精修/ })
          .first();
        return (await button.isEnabled().catch(() => false)) === true;
      }, { timeout: 90_000 })
      .toBe(true);

    // 制造「服务已创建但响应丢失」：先 route.fetch() 让请求**真实到达服务端**
    // （run 已落库），再 abort 丢弃响应——直接 abort 会在请求到达服务前断开，
    // 服务端根本没创建，重试就会新建第二个 run（等价于旧缺陷的反例）。
    let dropNextCreateResponse = true;
    await page.route(CREATE_RUN_PATH, async (route) => {
      const post = route.request().postDataJSON() as { clientRequestId?: string } | null;
      if (post?.clientRequestId) {
        createKeys.push(post.clientRequestId);
      }
      if (dropNextCreateResponse) {
        dropNextCreateResponse = false;
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await panel(page)
      .getByRole('button', { name: /开始智能精修/ })
      .click();
    await expect.poll(() => createKeys.length, { timeout: 60_000 }).toBe(3);
    // 前端报错（响应丢失），启动按钮重新可用
    await expect
      .poll(async () => {
        const button = panel(page)
          .getByRole('button', { name: /开始智能精修/ })
          .first();
        return (await button.isEnabled().catch(() => false)) === true;
      }, { timeout: 30_000 })
      .toBe(true);

    // 服务端确实已创建（响应丢失前请求已到达）：此时已有新 run 落库
    const runsAfterDrop = await listRunSummaries(fixture);
    expect(runsAfterDrop.length).toBeGreaterThanOrEqual(1);

    // 重试必须复用同一个幂等键（不是重放出新 run）
    await panel(page)
      .getByRole('button', { name: /开始智能精修/ })
      .click();
    await expect.poll(() => createKeys.length, { timeout: 60_000 }).toBe(4);
    expect(createKeys[3]).toBe(createKeys[2]);
    // 幂等命中已创建的 run：run 总数不变（没有第二个创建），面板展示的就是列表里的这个
    await expect
      .poll(async () => panel(page).getAttribute('data-run-id'), { timeout: 60_000 })
      .toBeTruthy();
    const runsAfterRetry = await listRunSummaries(fixture);
    expect(runsAfterRetry.length).toBe(runsAfterDrop.length);
    const retryRunId = await panel(page).getAttribute('data-run-id');
    expect(runsAfterRetry.some((item) => item.runId === retryRunId)).toBe(true);
  });

  test('4) E1 阻断与接口故障：应用按钮不可用，resume 失败不进入可应用', async ({ page }) => {
    await control({ script: { review: BLOCKING_REVIEW } });
    await loginViaUi(page);
    await openRefinementPanel(page, fixture.projectId);
    await startRefinement(page);

    // E1：账本存在不可定位的高严重度阻断 → 引擎暂停（boundary_conflict），
    // 绝不进入可应用终态（不能把 ready_with_issues 误当 E1 成功）。
    await expect
      .poll(async () => panel(page).getAttribute('data-status'), { timeout: 90_000 })
      .toBe('paused');

    // 应用按钮在 DOM（apply 区块随 run 渲染），但暂停态禁用
    const applyButton = panel(page)
      .getByRole('button', { name: /应用候选稿/ })
      .first();
    await expect(applyButton).toBeDisabled();

    // boundary_conflict 是可恢复暂停：「继续精修」按钮存在；注入 resume 500
    // 强制命中故障路径（不是可选 if——必须实际执行并观察到失败反馈）。
    await page.route(/\/optimize\/refinement\/runs\/[^/]+\/resume$/, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"code":1500,"msg":"注入的恢复失败"}',
      });
    });
    const resumeButton = panel(page)
      .getByRole('button', { name: /继续精修/ })
      .first();
    await expect(resumeButton).toBeVisible();
    await resumeButton.click();
    await expect(
      panel(page)
        .getByText(/失败|错误/)
        .first()
    ).toBeVisible({ timeout: 30_000 });

    // resume 失败后：状态仍是 paused、应用仍不可用、无任何真实 apply 请求
    await expect(panel(page)).toHaveAttribute('data-status', 'paused', { timeout: 30_000 });
    await expect(applyButton).toBeDisabled();
    const applyResponsePromise = page
      .waitForResponse(
        (response) => /\/knowledge\/chapters\/[^/]+\/optimize\/apply$/.test(response.url()),
        { timeout: 3_000 }
      )
      .then(() => 'seen' as const)
      .catch(() => 'none' as const);
    await applyButton.click({ force: true }).catch(() => undefined);
    expect(await applyResponsePromise).toBe('none');
  });

  test('5) 原文版本变化：真实 apply 走 1307，不覆盖新正文', async ({ page }) => {
    await control({ script: { rewrite: ['（脚本改写一）'] } });
    await loginViaUi(page);
    await openRefinementPanel(page, fixture.projectId);
    await startRefinement(page);
    // 必须等 ready 且 enabled 后再改源文，防止把 running 中 source_changed 暂停误作应用冲突
    await waitForApplyReady(page);

    // 真实章节保存接口（带 JWT），模拟其他操作更新正文
    const updated = '（其他操作更新后的正文）甲在院里等了很久。';
    await seedChapter(fixture, updated);
    expect((await readChapter(fixture)).content).toBe(updated);

    // 用 waitForResponse 纯观察真实 apply 响应（不拦截不重放），断言后端确实
    // 以 1307 拒绝。若 apply 请求根本没发出，waitForResponse 会超时失败。
    const applyResponsePromise = page.waitForResponse(
      (response) => /\/knowledge\/chapters\/[^/]+\/optimize\/apply$/.test(response.url()),
      { timeout: 60_000 }
    );

    // 导航离开再重开面板，确认新原文已被读到（sourceChanged 提示出现）
    await openRefinementPanel(page, fixture.projectId);
    await panel(page)
      .getByRole('button', { name: /应用候选稿/ })
      .first()
      .click();
    // 走真实确认流程（含提示确认）
    const confirmDialog = page.locator('.ant-modal-confirm').last();
    await expect(confirmDialog).toBeVisible({ timeout: 20_000 });
    await confirmDialog
      .getByRole('button', { name: /确认|确定|应用|我已阅读/ })
      .first()
      .click();

    const applyResponse = await applyResponsePromise;
    const applyStatus = applyResponse.status();
    const applyBody = (await applyResponse.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
    };

    // 后端以版本冲突拒绝，UI 报冲突文案，正文不被覆盖。
    // 注意 HttpExceptionFilter 会把业务 code 统一映射为 1503（Bad Request），
    // 「1307」的业务语义实际由 msg 文本承载（「已被其他操作更新」）。
    await expect(page.getByText(/1307|已被其他操作更新/).first()).toBeVisible({ timeout: 30_000 });
    expect(applyStatus).toBe(400);
    expect(String(applyBody.msg ?? '')).toContain('已被其他操作更新');
    // 新正文不被覆盖
    expect((await readChapter(fixture)).content).toBe(updated);
  });

  test('6) ready_with_issues → 明确确认 → 真实 apply：UI 与持久化正文全等且保留摘要', async ({
    page,
  }) => {
    await control({ script: { rewrite: ['（脚本改写一）'], review: LOW_ISSUE_REVIEW } });
    await loginViaUi(page);
    await openRefinementPanel(page, fixture.projectId);
    await startRefinement(page);
    await waitForApplyReady(page);

    const before = await readChapter(fixture);
    const runId = await panel(page).getAttribute('data-run-id');
    expect(runId).toBeTruthy();
    const candidateView = await readRefinementRunView(fixture, runId!);
    expect(candidateView.acceptedDraftText).toContain('（脚本改写一）');

    // 真实 apply 复用旧入口 /knowledge/chapters/:chapterNo/optimize/apply（不是
    // refinement/runs/:runId/apply）。拦截它捕获真实响应，强制断言请求已发出、
    // 成功响应已取得且正文非空——不能因为没捕获到响应就跳过全等断言。
    const applyPath = /\/knowledge\/chapters\/[^/]+\/optimize\/apply$/;
    let applyRequestSeen = false;
    let applyResponseStatus = 0;
    let appliedChapterContent = '';
    await page.route(applyPath, async (route) => {
      applyRequestSeen = true;
      const response = await route.fetch();
      applyResponseStatus = response.status();
      const body = (await response.json()) as {
        data?: { chapter?: { content?: string } };
        chapter?: { content?: string };
      };
      appliedChapterContent = String(
        body.data?.chapter?.content ?? body.chapter?.content ?? ''
      );
      await route.fulfill({ response });
    });

    await panel(page)
      .getByRole('button', { name: /应用候选稿/ })
      .first()
      .click();
    const confirmDialog = page.locator('.ant-modal-confirm').last();
    await expect(confirmDialog).toBeVisible({ timeout: 20_000 });
    await confirmDialog
      .getByRole('button', { name: /确认|确定|应用|我已阅读/ })
      .first()
      .click();

    // 应用成功后精修弹层被销毁并通知父级关闭，等章节主页面刷新，而非消失的面板。
    await expect(page.locator('.content-text').first()).toContainText('（脚本改写一）', {
      timeout: 60_000,
    });

    // 强制断言：真实 apply 请求确实发出，且成功响应已捕获到非空正文
    expect(applyRequestSeen).toBe(true);
    expect(applyResponseStatus).toBeGreaterThanOrEqual(200);
    expect(applyResponseStatus).toBeLessThan(300);
    expect(appliedChapterContent).toBeTruthy();
    expect(appliedChapterContent).toContain('（脚本改写一）');

    // 四路正文全等：运行候选、apply 响应、持久化正文、UI 展示
    const after = await readChapter(fixture);
    expect(after.content).toContain('（脚本改写一）');
    expect(after.content).toBe(candidateView.acceptedDraftText);
    expect(after.content).toBe(appliedChapterContent);
    // 摘要策略：保留摘要（未被清空）
    expect(after.summary).toBe(before.summary);

    // 刷新后仍一致
    await page.reload();
    await expect(page.locator('.content-text').first()).toContainText('（脚本改写一）', {
      timeout: 30_000,
    });
    expect((await readChapter(fixture)).content).toBe(after.content);
  });

  test('7) 旧入口回归：未保存改动时入口不可达（保护），保存后旧入口仍可用', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`/projects/${fixture.projectId}/chapters?refinement=1`);
    await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });

    // 真实操作：点「编辑」进入编辑态（正文是 <pre>，点击不进入编辑，必须点按钮）
    await expect(page.locator('.content-text').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '编辑' }).first().click();
    const editor = page.locator('textarea.field-textarea').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.fill(`${NEUTRAL_CHAPTER_CONTENT}\n（未保存的临时改动）`);

    // 未保存改动保护的实际行为：编辑态下优化入口不可达——「章节优化」「按场成稿」
    // 按钮不渲染（detail-actions 的 v-if/v-else 分支），无法在改动未保存时发起优化。
    await expect(page.getByRole('button', { name: '章节优化' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '按场成稿' })).toHaveCount(0);

    // 保存后退出编辑态，旧入口恢复
    await page.getByRole('button', { name: /保存/ }).first().click();
    await expect(page.locator('textarea.field-textarea').first()).toHaveCount(0, {
      timeout: 30_000,
    });
    // 章节页单独入口「按场成稿」回到 DOM（ChapterList 内，非文笔优化弹窗内）
    await expect(page.getByRole('button', { name: '按场成稿' }).first()).toBeVisible();

    // 打开文笔优化弹窗：方案改写 / 直接改写 / 自动循环 三个 mode 都在
    await page.getByRole('button', { name: '章节优化' }).first().click();
    const dialog = page
      .locator('.ant-modal')
      .filter({ hasText: /文笔优化/ })
      .first();
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole('button', { name: '方案改写' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '直接改写' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '自动循环' })).toBeVisible();

    // 智能精修（草稿）入口仍在弹窗内（?refinement=1 才可见）
    await expect(dialog.getByRole('button', { name: /智能精修/ })).toBeVisible();
  });

  test.afterAll(async () => {
    await reset();
  });
});
