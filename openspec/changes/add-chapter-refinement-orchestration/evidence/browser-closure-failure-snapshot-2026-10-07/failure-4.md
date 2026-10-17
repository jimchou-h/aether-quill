# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chapter-refinement-closed-loop.spec.ts >> chapter refinement closed loop with scripted model (B4) >> 5) 原文版本变化：应用走 1307，不覆盖新正文
- Location: e2e\chapter-refinement-closed-loop.spec.ts:342:3

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: locator.click: Test timeout of 120000ms exceeded.
Call log:
  - waiting for locator('.refinement-panel').first().getByRole('button', { name: /应用候选稿/ }).first()
    - locator resolved to <button disabled type="button" data-v-c2becbdb="" class="primary-button">应用候选稿</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not stable
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not stable
    - retrying click action
      - waiting 100ms
    218 × waiting for element to be visible, enabled and stable
        - element is not enabled
      - retrying click action
        - waiting 500ms

```

# Test source

```ts
  259 | 
  260 |     // 按钮始终是「开始智能精修」，没有「重新开始 / 再次精修」
  261 |     await panel(page)
  262 |       .getByRole('button', { name: /开始智能精修/ })
  263 |       .click();
  264 |     await expect
  265 |       .poll(async () => panel(page).getAttribute('data-run-id'), { timeout: 60_000 })
  266 |       .not.toBe(firstRunId);
  267 |     await expect.poll(() => createKeys.length, { timeout: 30_000 }).toBe(2);
  268 |     expect(createKeys[0]).not.toBe(createKeys[1]);
  269 | 
  270 |     // 制造创建响应丢失：下一次创建请求直接断掉
  271 |     let failNextCreate = true;
  272 |     await page.route(CREATE_RUN_PATH, async (route) => {
  273 |       const post = route.request().postDataJSON() as { clientRequestId?: string } | null;
  274 |       if (post?.clientRequestId) {
  275 |         createKeys.push(post.clientRequestId);
  276 |       }
  277 |       if (failNextCreate) {
  278 |         failNextCreate = false;
  279 |         await route.abort('failed');
  280 |         return;
  281 |       }
  282 |       await route.continue();
  283 |     });
  284 |     await panel(page)
  285 |       .getByRole('button', { name: /开始智能精修/ })
  286 |       .click();
  287 |     await expect.poll(() => createKeys.length, { timeout: 60_000 }).toBe(3);
  288 |     await expect(
  289 |       panel(page)
  290 |         .getByText(/发起智能精修失败/)
  291 |         .first()
  292 |     ).toBeVisible({ timeout: 30_000 });
  293 | 
  294 |     // 重试必须复用同一个幂等键（不是重放出新 run）
  295 |     await panel(page)
  296 |       .getByRole('button', { name: /开始智能精修/ })
  297 |       .click();
  298 |     await expect.poll(() => createKeys.length, { timeout: 60_000 }).toBe(4);
  299 |     expect(createKeys[3]).toBe(createKeys[2]);
  300 |     await expect
  301 |       .poll(async () => panel(page).getAttribute('data-run-id'), { timeout: 60_000 })
  302 |       .toBeTruthy();
  303 |   });
  304 | 
  305 |   test('4) E1 阻断与接口故障：应用按钮不可用', async ({ page }) => {
  306 |     await control({ script: { review: BLOCKING_REVIEW } });
  307 |     await loginViaUi(page);
  308 |     await openRefinementPanel(page, fixture.projectId);
  309 |     await startRefinement(page);
  310 | 
  311 |     // E1：账本存在不可定位的高严重度阻断 → 不得给出可应用终态
  312 |     await expect
  313 |       .poll(async () => panel(page).getAttribute('data-status'), { timeout: 90_000 })
  314 |       .toMatch(/paused|ready_with_issues/);
  315 |     const applyButton = panel(page)
  316 |       .getByRole('button', { name: /应用候选稿/ })
  317 |       .first();
  318 |     if (await applyButton.isVisible().catch(() => false)) {
  319 |       await expect(applyButton).toBeDisabled();
  320 |     } else {
  321 |       await expect(applyButton).toHaveCount(0);
  322 |     }
  323 | 
  324 |     // 接口故障：注入 resume 失败，UI 必须报错且不进入可应用
  325 |     await page.route(/\/optimize\/refinement\/runs\/[^/]+\/resume$/, async (route) => {
  326 |       await route.fulfill({ status: 500, body: '{"message":"注入的恢复失败"}' });
  327 |     });
  328 |     const resumeButton = panel(page)
  329 |       .getByRole('button', { name: /继续精修/ })
  330 |       .first();
  331 |     if (await resumeButton.isVisible().catch(() => false)) {
  332 |       await resumeButton.click();
  333 |       await expect(
  334 |         panel(page)
  335 |           .getByText(/失败|错误/)
  336 |           .first()
  337 |       ).toBeVisible({ timeout: 30_000 });
  338 |       await expect(applyButton).toHaveCount(0);
  339 |     }
  340 |   });
  341 | 
  342 |   test('5) 原文版本变化：应用走 1307，不覆盖新正文', async ({ page }) => {
  343 |     await control({ script: { rewrite: ['（脚本改写一）'] } });
  344 |     await loginViaUi(page);
  345 |     await openRefinementPanel(page, fixture.projectId);
  346 |     await startRefinement(page);
  347 |     await waitForApplyReady(page);
  348 | 
  349 |     // 真实章节保存接口（带 JWT），模拟其他操作更新正文
  350 |     const updated = '（其他操作更新后的正文）甲在院里等了很久。';
  351 |     await seedChapter(fixture, updated);
  352 |     expect((await readChapter(fixture)).content).toBe(updated);
  353 | 
  354 |     // 导航离开再重开面板，确认新原文已被读到
  355 |     await openRefinementPanel(page, fixture.projectId);
  356 |     await panel(page)
  357 |       .getByRole('button', { name: /应用候选稿/ })
  358 |       .first()
> 359 |       .click();
      |        ^ Error: locator.click: Test timeout of 120000ms exceeded.
  360 |     await expect(page.getByText(/1307|已被其他操作更新/).first()).toBeVisible({ timeout: 30_000 });
  361 |     // 新正文不被覆盖
  362 |     expect((await readChapter(fixture)).content).toBe(updated);
  363 |   });
  364 | 
  365 |   test('6) ready_with_issues → 明确确认 → 真实 apply：UI 与持久化正文全等且保留摘要', async ({
  366 |     page,
  367 |   }) => {
  368 |     await control({ script: { rewrite: ['（脚本改写一）'], review: LOW_ISSUE_REVIEW } });
  369 |     await loginViaUi(page);
  370 |     await openRefinementPanel(page, fixture.projectId);
  371 |     await startRefinement(page);
  372 |     await waitForApplyReady(page);
  373 | 
  374 |     const before = await readChapter(fixture);
  375 |     const applyPath = /\/optimize\/refinement\/runs\/[^/]+\/apply$/;
  376 |     let appliedContent = '';
  377 |     await page.route(applyPath, async (route) => {
  378 |       const response = await route.fetch();
  379 |       const body = (await response.json()) as { content?: string; chapter?: { content?: string } };
  380 |       appliedContent = String(body.content ?? body.chapter?.content ?? '');
  381 |       await route.fulfill({ response });
  382 |     });
  383 | 
  384 |     await panel(page)
  385 |       .getByRole('button', { name: /应用候选稿/ })
  386 |       .first()
  387 |       .click();
  388 |     const confirmDialog = page.locator('.ant-modal-confirm').last();
  389 |     await expect(confirmDialog).toBeVisible({ timeout: 20_000 });
  390 |     await confirmDialog
  391 |       .getByRole('button', { name: /确认|确定|应用/ })
  392 |       .first()
  393 |       .click();
  394 | 
  395 |     await expect(
  396 |       panel(page)
  397 |         .getByText(/已应用|应用成功/)
  398 |         .first()
  399 |     ).toBeVisible({ timeout: 60_000 });
  400 |     const after = await readChapter(fixture);
  401 |     expect(after.content).toContain('（脚本改写一）');
  402 |     if (appliedContent) {
  403 |       // API 返回的正文与持久化正文必须完整相等
  404 |       expect(after.content).toBe(appliedContent);
  405 |     }
  406 |     // 摘要策略：保留摘要（未被清空）
  407 |     expect(after.summary).toBe(before.summary);
  408 | 
  409 |     // UI 展示与持久化一致（刷新后仍一致）
  410 |     await page.reload();
  411 |     await expect(page.locator('.content-text').first()).toContainText('（脚本改写一）', {
  412 |       timeout: 30_000,
  413 |     });
  414 |     expect((await readChapter(fixture)).content).toBe(after.content);
  415 |   });
  416 | 
  417 |   test('7) 旧入口回归：未保存改动保护与旧优化入口仍可用', async ({ page }) => {
  418 |     await loginViaUi(page);
  419 |     await page.goto(`/projects/${fixture.projectId}/chapters?refinement=1`);
  420 |     await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });
  421 | 
  422 |     // 真实操作：进入编辑、制造未保存改动，再尝试打开优化入口
  423 |     const contentText = page.locator('.content-text').first();
  424 |     await expect(contentText).toBeVisible({ timeout: 20_000 });
  425 |     await contentText.click();
  426 |     const editor = page.locator('textarea.field-textarea').first();
  427 |     await expect(editor).toBeVisible({ timeout: 20_000 });
  428 |     await editor.fill(`${NEUTRAL_CHAPTER_CONTENT}\n（未保存的临时改动）`);
  429 | 
  430 |     await page
  431 |       .getByRole('button', { name: /章节优化|文笔优化/ })
  432 |       .first()
  433 |       .click();
  434 |     const guard = page.locator('.ant-modal-confirm').filter({ hasText: '检测到未保存的章节改动' });
  435 |     await expect(guard).toBeVisible({ timeout: 20_000 });
  436 |     await guard.getByRole('button', { name: '返回编辑器' }).click();
  437 | 
  438 |     // 保存后旧入口仍可打开：方案改写 / 直接改写 / 自动循环 / 按场成稿都在
  439 |     await page.getByRole('button', { name: /保存/ }).first().click();
  440 |     await expect(page.locator('textarea.field-textarea').first()).toHaveCount(0, {
  441 |       timeout: 30_000,
  442 |     });
  443 |     await page
  444 |       .getByRole('button', { name: /章节优化|文笔优化/ })
  445 |       .first()
  446 |       .click();
  447 |     const dialog = page
  448 |       .locator('.ant-modal')
  449 |       .filter({ hasText: /文笔优化/ })
  450 |       .first();
  451 |     await expect(dialog).toBeVisible({ timeout: 20_000 });
  452 |     await expect(dialog.getByRole('button', { name: '方案改写' })).toBeVisible();
  453 |     await expect(dialog.getByRole('button', { name: '直接改写' })).toBeVisible();
  454 |     await expect(dialog.getByRole('button', { name: '自动循环' })).toBeVisible();
  455 |     await expect(dialog.getByRole('button', { name: '按场成稿' })).toBeVisible();
  456 |   });
  457 | 
  458 |   test.afterAll(async () => {
  459 |     await reset();
```