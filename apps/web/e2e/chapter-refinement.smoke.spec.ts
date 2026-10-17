import { test, expect } from '@playwright/test';
import { goChapters, loginViaUi, openFirstProject, requireE2eCredentials } from './helpers';

/**
 * AQ-380 智能精修草稿入口：默认不公开、关闭弹窗后状态可恢复。
 *
 * 与 author-path.smoke.spec.ts 相同，需要 E2E_EMAIL / E2E_PASSWORD 与可用的后端 + PG。
 * 该用例覆盖 tasks.md 1.1 验收中的「草稿入口默认不公开」与「关闭再打开恢复状态」。
 */
test.describe('chapter refinement draft entry', () => {
  test.beforeAll(() => {
    requireE2eCredentials();
  });

  test('entry stays hidden without ?refinement=1 and restores run after reopening', async ({
    page,
  }) => {
    await loginViaUi(page);
    const projectId = await openFirstProject(page);

    // 不带 query：入口必须不渲染
    await goChapters(page, projectId);
    const chapter2Tab = page.locator('.chapter-tab', { hasText: '第2章' }).first();
    if (await chapter2Tab.isVisible().catch(() => false)) {
      await chapter2Tab.click();
    }
    await page
      .getByRole('button', { name: /章节优化|文笔优化/ })
      .first()
      .click();
    const optimizeDialog = page.locator('.ant-modal').filter({ hasText: /文笔优化/ });
    await expect(optimizeDialog.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /智能精修（草稿）/ })).toHaveCount(0);
    await page.locator('.ant-modal-close').first().click();
    await expect(optimizeDialog.first()).toBeHidden({ timeout: 10_000 });

    // 带 query：入口出现
    await page.goto(`/projects/${projectId}/chapters?refinement=1`);
    await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });
    const chapter2WithQuery = page.locator('.chapter-tab', { hasText: '第2章' }).first();
    if (await chapter2WithQuery.isVisible().catch(() => false)) {
      await chapter2WithQuery.click();
    }
    await page
      .getByRole('button', { name: /章节优化|文笔优化/ })
      .first()
      .click();
    await expect(optimizeDialog.first()).toBeVisible({ timeout: 15_000 });

    const refinementEntry = page.getByRole('button', { name: /智能精修（草稿）/ }).first();
    await expect(refinementEntry).toBeVisible({ timeout: 15_000 });
    await refinementEntry.click();

    const refinementPanel = page.locator('.refinement-panel').first();
    await expect(refinementPanel).toBeVisible({ timeout: 15_000 });

    const instruction = refinementPanel.locator('#chapter-refinement-instruction');
    await instruction.fill('收紧节奏，减少解释性叙述，保持剧情与人物状态不变。');
    await refinementPanel.getByRole('button', { name: /开始智能精修/ }).click();

    // keep-only 基线秒级完成：等待候选就绪徽标，而非只等「观察中」
    await expect(
      refinementPanel.locator('.refinement-badge').filter({ hasText: /候选已就绪/ })
    ).toBeVisible({
      timeout: 60_000,
    });

    // 关闭精修弹窗，再重新打开：必须恢复同一次 run（历史/候选仍在）
    // 注意：优化弹窗内含「智能精修（草稿）」按钮，按文案过滤会同时命中，故用面板定位。
    const refinementModal = page
      .locator('.ant-modal')
      .filter({ has: page.locator('.refinement-panel') });
    await refinementModal.locator('.ant-modal-close').first().click();
    await expect(refinementPanel).toBeHidden({ timeout: 10_000 });

    await refinementEntry.click();
    await expect(refinementPanel).toBeVisible({ timeout: 15_000 });
    await expect(
      refinementPanel.locator('.refinement-badge').filter({ hasText: /候选已就绪/ })
    ).toBeVisible({ timeout: 30_000 });
    await expect(refinementPanel.locator('.refinement-history-item').first()).toBeVisible();
  });
});
