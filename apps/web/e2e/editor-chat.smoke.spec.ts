import { test, expect, type Page } from '@playwright/test';

import { loginViaUi, requireE2eCredentials } from './helpers';
import {
  NEUTRAL_CHAPTER_TITLE,
  createRefinementFixture,
  deleteRefinementFixture,
  type RefinementFixture,
} from './support/refinement-fixture';

/**
 * issue #48 轻量 UI smoke：编辑对话的浏览器记忆与叠层。
 *
 * 只有「模型回答」这一段用 page.route 替身（本票验收的是前端记忆链路，
 * 模型接线已由 services/api 的真实入口测试覆盖）；登录、项目、章节、
 * IndexedDB 全部走真实实现。运行前提与其余 e2e 相同：
 * 真实 Web(5173) + API(3000) + PG，且 E2E_EMAIL / E2E_PASSWORD 就绪。
 */

/** 回答故意带 Markdown：面板要渲染成分点与引用条，复制则要拿到原始标记文本。 */
const ANSWER = [
  '- 开场节奏偏缓：拆信可提前到第 1 段。',
  '> 案上那封没有署名的信。',
  '- 人物动机缺一处支撑。',
].join('\n');
/** Playwright 的 toHaveText 会归一化空白，与元素文本内容比对用这个形态。 */
const ANSWER_TEXT = ANSWER.replace(/\s+/g, ' ').trim();
const WEB_ORIGIN = (process.env.E2E_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');

interface SentPayload {
  question: string;
  history?: Array<{ role: string; content: string }>;
  currentChapterNo?: number;
}

async function stubEditorChatStream(page: Page, sent: SentPayload[]): Promise<void> {
  await page.route('**/api/projects/*/editor-chat/stream', async (route) => {
    sent.push(route.request().postDataJSON() as SentPayload);
    const frames = [
      { event: 'start', traceId: 'e2e-editor-chat' },
      { event: 'content', data: ANSWER },
      { event: 'end', traceId: 'e2e-editor-chat', chapterNo: 1, completed: true, guidance: false },
    ]
      .map((payload) => `data: ${JSON.stringify(payload)}\n\n`)
      .join('');
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: frames,
    });
  });
}

async function openPanel(page: Page): Promise<void> {
  const panel = page.getByTestId('editor-chat-panel');
  if (await panel.isVisible().catch(() => false)) {
    return;
  }
  await page.getByTestId('editor-chat-trigger').click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
}

async function ask(page: Page, question: string): Promise<void> {
  await openPanel(page);
  await page.getByTestId('editor-chat-input').fill(question);
  await page.getByTestId('editor-chat-send').click();
  await expect(panelBodies(page).last()).toHaveText(ANSWER_TEXT, { timeout: 30_000 });
}

function panelBodies(page: Page) {
  return page.getByTestId('editor-chat-panel').locator('.editor-chat-message-body');
}

async function selectChapter(page: Page): Promise<void> {
  const workbenchButton = page.getByRole('button', { name: '按场成稿' });
  if (!(await workbenchButton.isVisible().catch(() => false))) {
    await page.getByText(NEUTRAL_CHAPTER_TITLE).first().click();
  }
  await expect(workbenchButton).toBeVisible({ timeout: 30_000 });
}

test.describe('editor chat browser memory (#48)', () => {
  let fixture: RefinementFixture;
  let sent: SentPayload[];

  test.beforeEach(async ({ page }) => {
    requireE2eCredentials();
    fixture = await createRefinementFixture();
    sent = [];
    await stubEditorChatStream(page, sent);
    await loginViaUi(page);
    await page.goto(`/projects/${fixture.projectId}/chapters`);
    await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });
  });

  test.afterEach(async () => {
    await deleteRefinementFixture(fixture);
  });

  test('keeps the conversation after a page reload and carries history into the follow-up', async ({
    page,
  }) => {
    await ask(page, '第 1 章有什么优化想法');
    // 刷新前收起面板：记忆不应依赖面板处于打开状态
    await page.getByTestId('editor-chat-close').click();

    await page.reload();
    await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });

    await openPanel(page);
    await expect(panelBodies(page), '刷新后应恢复上一轮的问答').toHaveCount(2);
    await expect(panelBodies(page).nth(0)).toHaveText('第 1 章有什么优化想法');
    await expect(panelBodies(page).nth(1)).toHaveText(ANSWER_TEXT);
    // Markdown 接线：分点成列表、`>` 原文成引用条，而不是把标记符号原样显示
    const assistantBody = panelBodies(page).nth(1);
    await expect(assistantBody.locator('li')).toHaveCount(2);
    await expect(assistantBody.locator('blockquote')).toHaveText('案上那封没有署名的信。');
    await expect(page.getByTestId('editor-chat-panel').locator('.editor-chat-anchor')).toHaveText(
      /第 1 章/
    );

    await page.getByTestId('editor-chat-input').fill('改完了，还有没有问题');
    await page.getByTestId('editor-chat-send').click();
    await expect(panelBodies(page).last()).toHaveText(ANSWER_TEXT, { timeout: 30_000 });

    expect(sent.length).toBe(2);
    expect(sent[1].question).toBe('改完了，还有没有问题');
    expect(sent[1].currentChapterNo).toBe(1);
    expect(sent[1].history?.map((m) => m.content)).toEqual(['第 1 章有什么优化想法', ANSWER]);
  });

  test('isolates conversations per project and never leaks across projects', async ({ page }) => {
    await ask(page, '第 1 章有什么优化想法');

    const other = await createRefinementFixture();
    try {
      await page.goto(`/projects/${other.projectId}/chapters`);
      await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({
        timeout: 30_000,
      });
      await openPanel(page);
      await expect(
        page.getByTestId('editor-chat-panel').locator('.editor-chat-empty')
      ).toBeVisible();
      await expect(panelBodies(page)).toHaveCount(0);

      await ask(page, '换个项目也只看这一章');
    } finally {
      await deleteRefinementFixture(other);
    }

    // 回到原项目：本地记录仍在，且不被第二个项目的对话污染
    await page.goto(`/projects/${fixture.projectId}/chapters`);
    await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });
    await openPanel(page);
    await expect(panelBodies(page)).toHaveCount(2);
    await expect(panelBodies(page).nth(1)).toHaveText(ANSWER_TEXT);
  });

  test('clearing removes the stored record so a reload does not bring it back', async ({
    page,
  }) => {
    await ask(page, '第 1 章有什么优化想法');

    await page.getByTestId('editor-chat-clear').click();
    await expect(panelBodies(page)).toHaveCount(0);
    await expect(page.getByTestId('editor-chat-clear')).toBeDisabled();

    await page.reload();
    await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });
    await openPanel(page);
    await expect(panelBodies(page), '清空后刷新不应再恢复旧对话').toHaveCount(0);
    await expect(
      page.getByTestId('editor-chat-panel').locator('.editor-chat-memory-note'),
      '空态需交代记忆只在本浏览器'
    ).toContainText('只保存在当前浏览器');
  });

  test('stays reachable above the fullscreen scene workbench modal', async ({ page }) => {
    await selectChapter(page);
    await page.getByRole('button', { name: '按场成稿' }).click();
    await expect(page.locator('.scene-workbench-fullscreen')).toBeVisible({ timeout: 15_000 });

    // click 会做命中测试：被弹窗遮挡时这里会失败
    await page.getByTestId('editor-chat-trigger').click();
    await expect(page.getByTestId('editor-chat-panel')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('editor-chat-input').fill('第 1 章有什么优化想法');
    await page.getByTestId('editor-chat-send').click();
    await expect(panelBodies(page).last()).toHaveText(ANSWER_TEXT, { timeout: 30_000 });
    await expect(page.locator('.scene-workbench-fullscreen')).toBeVisible();
  });

  test('copies an assistant answer to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB_ORIGIN });
    await ask(page, '第 1 章有什么优化想法');

    await page.getByTestId('editor-chat-copy').last().click();
    await expect(page.getByTestId('editor-chat-copy').last()).toHaveText('已复制');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ANSWER);
  });
});
