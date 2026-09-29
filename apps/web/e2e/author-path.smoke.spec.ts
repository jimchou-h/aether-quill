import { test, expect } from '@playwright/test';
import {
  collectOverflowHints,
  goChapters,
  goSettings,
  loginViaUi,
  openFirstProject,
  requireE2eCredentials,
} from './helpers';

test.describe('author-path smoke', () => {
  test.beforeAll(() => {
    requireE2eCredentials();
  });

  test('login → projects → chapters → settings; open optimize dialogs', async ({ page }, testInfo) => {
    const findings: string[] = [];
    const viewport = testInfo.project.name;

    await loginViaUi(page);
    findings.push(...(await collectOverflowHints(page)).map((h) => `[${viewport}][projects] ${h}`));

    const projectId = await openFirstProject(page);
    await goChapters(page, projectId);
    findings.push(...(await collectOverflowHints(page)).map((h) => `[${viewport}][chapters] ${h}`));

    // Prefer chapter 2 when present for later AI steps.
    const chapter2Tab = page.locator('.chapter-tab', { hasText: '第2章' }).first();
    if (await chapter2Tab.isVisible().catch(() => false)) {
      await chapter2Tab.click();
    }

    const optimizeBtn = page.getByRole('button', { name: /章节优化|文笔优化/ }).first();
    await expect(optimizeBtn).toBeVisible({ timeout: 20_000 });
    const openOptimizeStart = Date.now();
    await optimizeBtn.click();
    const optimizeDialog = page.locator('.ant-modal').filter({ hasText: /文笔优化/ });
    await expect(optimizeDialog.first()).toBeVisible({ timeout: 15_000 });
    findings.push(
      `[${viewport}][writing-optimize] openMs=${Date.now() - openOptimizeStart}`
    );
    findings.push(
      ...(await collectOverflowHints(page)).map((h) => `[${viewport}][writing-optimize] ${h}`)
    );
    await page.locator('.writing-optimize-fullscreen .ant-modal-close, .ant-modal-close').first().click();
    await expect(optimizeDialog.first()).toBeHidden({ timeout: 10_000 });

    const workbenchBtn = page.getByRole('button', { name: /按场成稿/ }).first();
    await expect(workbenchBtn).toBeVisible({ timeout: 15_000 });
    const openWbStart = Date.now();
    await workbenchBtn.click();
    const wbDialog = page.locator('.ant-modal').filter({ hasText: /按场成稿/ });
    await expect(wbDialog.first()).toBeVisible({ timeout: 15_000 });
    findings.push(`[${viewport}][workbench] openMs=${Date.now() - openWbStart}`);
    findings.push(...(await collectOverflowHints(page)).map((h) => `[${viewport}][workbench] ${h}`));
    await page.locator('.ant-modal-close').first().click();
    await expect(wbDialog.first()).toBeHidden({ timeout: 10_000 });

    await goSettings(page, projectId);
    await expect(page.getByRole('heading', { name: '自定义禁用词' })).toBeVisible({ timeout: 30_000 });
    findings.push(...(await collectOverflowHints(page)).map((h) => `[${viewport}][settings] ${h}`));

    // Surface overflow / timing in the report for audit-findings.
    // eslint-disable-next-line no-console
    console.log(`AUDIT_FINDINGS_BEGIN\n${findings.join('\n')}\nAUDIT_FINDINGS_END`);
  });
});
