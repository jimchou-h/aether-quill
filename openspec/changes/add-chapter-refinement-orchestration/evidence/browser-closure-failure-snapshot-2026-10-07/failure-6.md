# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chapter-refinement-closed-loop.spec.ts >> chapter refinement closed loop with scripted model (B4) >> 7) 旧入口回归：未保存改动保护与旧优化入口仍可用
- Location: e2e\chapter-refinement-closed-loop.spec.ts:417:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('textarea.field-textarea').first()
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('textarea.field-textarea').first() with timeout 20000ms
  - waiting for locator('textarea.field-textarea').first()

```

```yaml
- banner:
  - link "返回项目列表":
    - /url: /projects
    - text: Aether Quill
  - link "账户设置":
    - /url: /account/settings
    - text: 设置
  - text: E2E 精修自动化
  - button "退出登录"
- main:
  - complementary "项目导航":
    - link "全部项目":
      - /url: /projects
    - navigation:
      - link "写作工作台":
        - /url: /projects/1791379462306/workbench
      - link "知识库":
        - /url: /projects/1791379462306/knowledge
      - link "人物设定":
        - /url: /projects/1791379462306/personas
      - link "关系事件":
        - /url: /projects/1791379462306/relation-events
      - link "事件卡":
        - /url: /projects/1791379462306/event-cards
      - link "章节":
        - /url: /projects/1791379462306/chapters
      - link "设置":
        - /url: /projects/1791379462306/settings
  - main:
    - heading "章节模块" [level=2]
    - text: 1 章
    - paragraph: 查看小说正文与摘要，补录历史章节，并按章生成语义摘要或关系事件。
    - text: 暂无摘要任务
    - button "批量摘要"
    - button "更多操作":
      - img
    - button "新增章节"
    - text: 生成章节草稿时依赖「结构化信息」做知识库标题匹配；若未解析，将无法注入知识库文档。
    - button "关闭提示": ×
    - complementary:
      - heading "章节列表" [level=3]
      - textbox "搜索章节标题..."
      - spinbutton "章节号"
      - button "跳转"
      - tablist "章节列表":
        - tab "第1章 自动化中性样章" [selected]
    - heading "第1章 · 自动化中性样章" [level=4]
    - paragraph: 规则摘要 更新于 10/7/2026, 9:24:27 PM
    - button "编辑"
    - button "生成摘要"
    - button "解析结构化信息"
    - button "章节优化"
    - button "按场成稿"
    - button "更多":
      - text: 更多
      - img
    - button "删除章节"
    - heading "摘要" [level=5]
    - paragraph: 情节：第一章 院里的两个人 甲在院里等了很久，直到门被推开。乙从门外进来，把手里的东西放在石桌上，两个人开始低声说话。 天色渐晚，院子里只剩下风声。甲送乙到门口，看着对方走远，才转身回屋，把门轻轻关上。 人物：待补全 未收线：待补全
    - paragraph: 摘要更新于 10/7/2026, 9:24:27 PM
    - heading "正文" [level=5]
    - paragraph: 未生成结构化信息，无法匹配知识库。可点击上方「解析结构化信息」基于正文生成。
    - text: 第一章 院里的两个人 甲在院里等了很久，直到门被推开。乙从门外进来，把手里的东西放在石桌上，两个人开始低声说话。 天色渐晚，院子里只剩下风声。甲送乙到门口，看着对方走远，才转身回屋，把门轻轻关上。
```

# Test source

```ts
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
  359 |       .click();
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
> 427 |     await expect(editor).toBeVisible({ timeout: 20_000 });
      |                          ^ Error: expect(locator).toBeVisible() failed
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
  460 |   });
  461 | });
  462 | 
```