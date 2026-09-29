import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  collectOverflowHints,
  goChapters,
  goSettings,
  loginViaUi,
  openFirstProject,
  requireE2eCredentials,
} from './helpers';

const ARTIFACT_DIR = path.resolve('e2e-artifacts');

test.describe('author-path visual audit', () => {
  test.beforeAll(() => {
    requireE2eCredentials();
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  });

  test('capture main surfaces + light AI', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const viewport = testInfo.project.name;
    const shot = async (name: string) => {
      await page.screenshot({
        path: path.join(ARTIFACT_DIR, `${viewport}-${name}.png`),
        fullPage: true,
      });
    };
    const notes: string[] = [];

    await loginViaUi(page);
    await shot('01-projects');

    const projectId = await openFirstProject(page);
    await goChapters(page, projectId);
    await shot('02-chapters');

    const tabs = page.locator('.chapter-tab');
    const tabCount = await tabs.count();
    let bestNo = 1;
    let bestLen = -1;
    for (let i = 0; i < tabCount; i += 1) {
      await tabs.nth(i).click();
      const text = (await page.locator('pre.content-text').innerText().catch(() => '')) || '';
      if (text.length > bestLen) {
        bestLen = text.length;
        const label = await tabs.nth(i).locator('.chapter-tab-no').innerText();
        const m = label.match(/(\d+)/);
        bestNo = m ? Number(m[1]) : i + 1;
      }
    }
    notes.push(`[${viewport}] longestChapter=${bestNo} chars=${bestLen}`);
    await page.locator('.chapter-tab', { hasText: `第${bestNo}章` }).first().click();
    await shot('03-chapter-selected');

    await page.getByRole('button', { name: '章节优化' }).click();
    const optimizeDialog = page.locator('.ant-modal').filter({ hasText: /文笔优化/ });
    await expect(optimizeDialog.first()).toBeVisible();
    await shot('04-writing-optimize-open');

    await page.locator('#writing-optimize-instruction').fill(
      '请给出简短文笔优化方案：收紧对话节奏，不要扩写剧情。'
    );
    const planStart = Date.now();
    await page.getByRole('button', { name: '生成优化方案' }).click();
    await expect(page.locator('#writing-optimize-plan')).toBeVisible({ timeout: 120_000 });
    notes.push(`[${viewport}][plan] elapsedMs=${Date.now() - planStart}`);
    await shot('05-writing-optimize-plan');
    notes.push(
      ...(await collectOverflowHints(page)).map((h) => `[${viewport}][writing-optimize] ${h}`)
    );
    await page.locator('.ant-modal-close').first().click();
    await expect(optimizeDialog.first()).toBeHidden({ timeout: 15_000 });

    await page.getByRole('button', { name: '按场成稿' }).click();
    const wb = page.locator('.ant-modal').filter({ hasText: /按场成稿/ });
    await expect(wb.first()).toBeVisible();
    await shot('06-workbench-open');

    const frozen = page.locator('#scene-workbench-frozen');
    await expect(frozen).toBeVisible();
    const selectEnd = Math.min(400, Math.max(80, bestLen));
    await frozen.evaluate((el, end) => {
      const ta = el as HTMLTextAreaElement;
      ta.focus();
      ta.setSelectionRange(0, end);
      ta.dispatchEvent(new Event('select', { bubbles: true }));
      ta.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, selectEnd);

    await page.locator('#scene-workbench-instruction').fill('理顺这段节奏，不要扩写。').catch(async () => {
      await page.locator('.instruction-input').first().fill('理顺这段节奏，不要扩写。');
    });

    const wbStart = Date.now();
    await page.getByRole('button', { name: '生成范围成稿' }).click();
    await Promise.race([
      expect
        .poll(async () => page.locator('#scene-workbench-draft').inputValue(), { timeout: 120_000 })
        .toMatch(/\S/),
      page.getByText(/失败|请先|无效范围|几乎是原文/).first().waitFor({
        state: 'visible',
        timeout: 120_000,
      }),
    ]).catch(() => undefined);
    const draftVal = await page.locator('#scene-workbench-draft').inputValue().catch(() => '');
    notes.push(
      `[${viewport}][workbench-draft] elapsedMs=${Date.now() - wbStart} draftChars=${draftVal.length}`
    );
    await shot('07-workbench-after-generate');
    notes.push(...(await collectOverflowHints(page)).map((h) => `[${viewport}][workbench] ${h}`));
    await page.locator('.ant-modal-close').first().click();

    await goSettings(page, projectId);
    await expect(page.getByRole('heading', { name: '自定义禁用词' })).toBeVisible({
      timeout: 30_000,
    });
    await shot('08-settings');
    notes.push(...(await collectOverflowHints(page)).map((h) => `[${viewport}][settings] ${h}`));

    // eslint-disable-next-line no-console
    console.log(`AUDIT_FINDINGS_BEGIN\n${notes.join('\n')}\nAUDIT_FINDINGS_END`);
  });
});
