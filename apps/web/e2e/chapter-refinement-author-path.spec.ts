import { test, expect } from '@playwright/test';
import { goChapters, loginViaUi, openFirstProject, requireE2eCredentials } from './helpers';

/**
 * AQ-385（6.1）：智能精修接入现有章节优化 UI 的作者路径与旧 mode 隔离。
 *
 * 覆盖 tasks.md 6.1 验收：
 *  - 入口与旧 mode（方案改写 / 直接改写 / 自动循环）并列且互不干扰；
 *  - 编辑器有未保存改动时，打开文笔优化必须先保存或返回编辑器；
 *  - 启动后展示运行关联信息（runId / attemptId / 冻结模板版本）。
 *
 * 与其它 e2e 相同，需要 E2E_EMAIL / E2E_PASSWORD 与可用后端；改用例不改写章节正文、
 * 不应用候选，避免污染真实数据。
 */
test.describe('chapter refinement author path (AQ-385)', () => {
  test.beforeAll(() => {
    requireE2eCredentials();
  });

  test('entry coexists with legacy modes and surfaces run correlation', async ({ page }) => {
    await loginViaUi(page);
    const projectId = await openFirstProject(page);

    await page.goto(`/projects/${projectId}/chapters?refinement=1`);
    await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });

    const chapter2Tab = page.locator('.chapter-tab', { hasText: '第2章' }).first();
    if (await chapter2Tab.isVisible().catch(() => false)) {
      await chapter2Tab.click();
    }

    await page
      .getByRole('button', { name: /章节优化|文笔优化/ })
      .first()
      .click();

    const optimizeDialog = page
      .locator('.ant-modal')
      .filter({ hasText: /文笔优化/ })
      .first();
    await expect(optimizeDialog).toBeVisible({ timeout: 15_000 });

    // 旧 mode 与新入口并存，入口独立于 mode 切换组
    await expect(optimizeDialog.getByRole('button', { name: '方案改写' })).toBeVisible();
    await expect(optimizeDialog.getByRole('button', { name: '直接改写' })).toBeVisible();
    await expect(optimizeDialog.getByRole('button', { name: '自动循环' })).toBeVisible();
    const refinementEntry = optimizeDialog
      .getByRole('button', { name: /智能精修（草稿）/ })
      .first();
    await expect(refinementEntry).toBeVisible();

    // 打开旧 mode 不影响入口存在性（旧链路行为不变）
    await optimizeDialog.getByRole('button', { name: '直接改写' }).click();
    await expect(refinementEntry).toBeVisible();
    await optimizeDialog.getByRole('button', { name: '方案改写' }).click();

    await refinementEntry.click();
    const refinementPanel = page.locator('.refinement-panel').first();
    await expect(refinementPanel).toBeVisible({ timeout: 15_000 });

    await refinementPanel
      .locator('#chapter-refinement-instruction')
      .fill('收紧节奏，减少解释性叙述，保持剧情与人物状态不变。');
    await refinementPanel.getByRole('button', { name: /开始智能精修/ }).click();

    // 运行启动后：关联信息块可见，且包含 runId / 模板版本字段
    const correlation = refinementPanel.locator('.refinement-correlation');
    await expect(correlation).toBeVisible({ timeout: 30_000 });
    await correlation.locator('summary').click();
    await expect(correlation).toContainText('runId');
    await expect(correlation).toContainText('attemptId');
    await expect(correlation).toContainText('冻结模板版本');
  });

  test('unsaved editor change blocks optimize entry until saved or returned', async ({ page }) => {
    await loginViaUi(page);
    const projectId = await openFirstProject(page);
    await goChapters(page, projectId);

    const chapter2Tab = page.locator('.chapter-tab', { hasText: '第2章' }).first();
    if (await chapter2Tab.isVisible().catch(() => false)) {
      await chapter2Tab.click();
    }

    // 进入编辑并制造未保存改动
    const editButton = page.getByRole('button', { name: /编辑/ }).first();
    await expect(editButton).toBeVisible({ timeout: 15_000 });
    await editButton.click();
    const contentBox = page.locator('textarea').first();
    await expect(contentBox).toBeVisible({ timeout: 15_000 });
    const original = await contentBox.inputValue();
    await contentBox.fill(`${original}\n\n（e2e 未保存改动标记）`);

    // 点击文笔优化：应先弹出未保存改动保护
    await page
      .getByRole('button', { name: /章节优化|文笔优化/ })
      .first()
      .click();
    const guard = page.locator('.ant-modal-confirm').filter({ hasText: /未保存的章节改动/ });
    await expect(guard).toBeVisible({ timeout: 15_000 });
    await expect(guard.getByRole('button', { name: /返回编辑器/ })).toBeVisible();

    // 返回编辑器：不打开优化弹窗，编辑器内容仍在
    await guard.getByRole('button', { name: /返回编辑器/ }).click();
    await expect(page.locator('.ant-modal').filter({ hasText: /文笔优化/ })).toHaveCount(0);
    await expect(contentBox).toHaveValue(/e2e 未保存改动标记/);

    // 还原，避免影响后续用例
    await contentBox.fill(original);
  });
});
