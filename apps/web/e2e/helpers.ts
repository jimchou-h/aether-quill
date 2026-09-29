import { expect, type Page } from '@playwright/test';

export function requireE2eCredentials(): { email: string; password: string } {
  const email = process.env.E2E_EMAIL?.trim() || '';
  const password = process.env.E2E_PASSWORD?.trim() || '';
  if (!email || !password) {
    throw new Error(
      'Missing E2E_EMAIL / E2E_PASSWORD. Set them in the environment before running e2e:smoke.'
    );
  }
  return { email, password };
}

export async function loginViaUi(page: Page): Promise<void> {
  const { email, password } = requireE2eCredentials();
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /登录/ }).click();
  await expect(page).toHaveURL(/\/projects/, { timeout: 30_000 });
}

export async function openFirstProject(page: Page): Promise<string> {
  const projectIdOverride = process.env.E2E_PROJECT_ID?.trim();
  if (projectIdOverride) {
    await page.goto(`/projects/${projectIdOverride}/chapters`);
    await expect(page).toHaveURL(new RegExp(`/projects/${projectIdOverride}/`));
    return projectIdOverride;
  }

  await page.goto('/projects');
  const firstLink = page.locator('a[href*="/projects/"]').first();
  await expect(firstLink).toBeVisible({ timeout: 30_000 });
  const href = await firstLink.getAttribute('href');
  if (!href) {
    throw new Error('No project link found on /projects');
  }
  await firstLink.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+/);
  const match = page.url().match(/\/projects\/([^/]+)/);
  if (!match?.[1]) {
    throw new Error(`Could not parse project id from ${page.url()}`);
  }
  return match[1];
}

export async function goChapters(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/chapters`);
  await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({
    timeout: 30_000,
  });
}

export async function goSettings(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}/settings`);
  await expect(page.getByRole('heading', { name: '项目设置' })).toBeVisible({ timeout: 30_000 });
}

/** Collect rough layout overflow signals for audit notes. */
export async function collectOverflowHints(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hints: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 2) {
      hints.push(`horizontal-page-overflow:${doc.scrollWidth - doc.clientWidth}px`);
    }
    const candidates = Array.from(document.querySelectorAll('body *')).slice(0, 800);
    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      if (style.overflow === 'hidden' || style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      if (rect.right > window.innerWidth + 4) {
        const tag = el.tagName.toLowerCase();
        const cls = typeof el.className === 'string' ? el.className.slice(0, 40) : '';
        hints.push(`overflow-right:${tag}.${cls}@${Math.round(rect.right)}`);
        if (hints.length >= 8) break;
      }
    }
    return hints;
  });
}
