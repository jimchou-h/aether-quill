# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chapter-refinement-closed-loop.spec.ts >> chapter refinement closed loop with scripted model (B4) >> 3) 完成后再次开始：新 run 新 clientRequestId；创建响应丢失后重试复用原 key
- Location: e2e\chapter-refinement-closed-loop.spec.ts:241:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.refinement-panel').first().getByText(/发起智能精修失败/).first()
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('.refinement-panel').first().getByText(/发起智能精修失败/).first() with timeout 30000ms
  - waiting for locator('.refinement-panel').first().getByText(/发起智能精修失败/).first()

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
        - /url: /projects/1791379110315/workbench
      - link "知识库":
        - /url: /projects/1791379110315/knowledge
      - link "人物设定":
        - /url: /projects/1791379110315/personas
      - link "关系事件":
        - /url: /projects/1791379110315/relation-events
      - link "事件卡":
        - /url: /projects/1791379110315/event-cards
      - link "章节":
        - /url: /projects/1791379110315/chapters
      - link "设置":
        - /url: /projects/1791379110315/settings
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
    - paragraph: 规则摘要 更新于 10/7/2026, 9:18:34 PM
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
    - paragraph: 摘要更新于 10/7/2026, 9:18:34 PM
    - heading "正文" [level=5]
    - paragraph: 未生成结构化信息，无法匹配知识库。可点击上方「解析结构化信息」基于正文生成。
    - text: 第一章 院里的两个人 甲在院里等了很久，直到门被推开。乙从门外进来，把手里的东西放在石桌上，两个人开始低声说话。 天色渐晚，院子里只剩下风声。甲送乙到门口，看着对方走远，才转身回屋，把门轻轻关上。
- dialog "文笔优化 · 第1章":
  - document:
    - button "Close":
      - img "close"
    - text: 文笔优化 · 第1章
    - banner:
      - paragraph: 根据自由要求先生成编辑方案，再按方案改写；成稿后自动做连续性自检，有缺口最多自动修一刀。你可再标记残留问题修复。只有确认应用后才会覆盖原文。
      - radiogroup "文笔优化模式":
        - button "方案改写"
        - button "直接改写"
        - button "自动循环"
      - button "智能精修（草稿）"
      - list:
        - listitem: 1. 优化要求 待确认
        - listitem: 2. 优化方案
        - listitem: 3. 正文对比
    - text: 文笔优化要求
    - textbox "文笔优化要求":
      - /placeholder: 例如：收紧节奏，减少解释性叙述，加强人物之间的张力，同时保持剧情和人物设定不变。
    - contentinfo:
      - button "取消"
      - button "生成优化方案" [disabled]
- dialog "智能精修 · 第1章":
  - document:
    - button "Close":
      - img "close"
    - text: 智能精修 · 第1章
    - banner:
      - text: 存储：PostgreSQL 持久化 候选已就绪（含提示）
      - paragraph: 整章精修：冻结原文后分窗通读 → 跨窗合并场景 → 整章统筹 → 逐范围改写与检查， 产出完整候选；确认应用复用旧入口并保留摘要。
    - paragraph: 已启动智能精修；可以关闭面板，稍后回来查看结果。
    - text: 本章精修要求
    - textbox "本章精修要求":
      - /placeholder: 例如：收紧节奏，减少解释性叙述，加强人物之间的张力，保持剧情与人物状态不变。
      - text: 收紧节奏，保持剧情与人物状态不变。
    - text: 改写权限
    - combobox "改写权限":
      - option "保留剧情" [selected]
      - option "场内创编"
    - text: 保留剧情：允许改表达、节奏、对话组织与场内铺陈，保留必要事件与范围首尾状态。
    - button "开始智能精修"
    - text: 启动后可以关闭面板；精修在后台继续，重新打开会自动恢复。 已完成 100%
    - paragraph: 整章候选已就绪（含提示或保留原文）
    - paragraph: 第 2 / 2 个范围
    - paragraph: 调用 5 次 · 活跃 0s · 用量不可用
    - paragraph: 原文 100 字 · 已处理 100 字 · 保留原文 88 字 · 未处理 0 字
    - button "放弃并清理"
    - text: 关闭面板不会取消精修；取消会中止当前调用并保留成果。
    - heading "候选对比" [level=4]
    - heading "冻结原文" [level=4]
    - text: 第一章 院里的两个人 甲在院里等了很久，直到门被推开。乙从门外进来，把手里的东西放在石桌上，两个人开始低声说话。 天色渐晚，院子里只剩下风声。甲送乙到门口，看着对方走远，才转身回屋，把门轻轻关上。
    - heading "候选稿（只读）" [level=4]
    - textbox [disabled]: （脚本改写一） 甲在院里等了很久，直到门被推开。乙从门外进来，把手里的东西放在石桌上，两个人开始低声说话。 天色渐晚，院子里只剩下风声。甲送乙到门口，看着对方走远，才转身回屋，把门轻轻关上。
    - button "生成对照"
    - paragraph: 文稿已改动，对照已清除；确认后点击生成。
    - heading "应用候选稿" [level=4]
    - list:
      - listitem: 中等 自然段 2~3 未被任何场景覆盖，保留原文
    - button "应用候选稿"
    - text: 复用旧应用入口：锁定冻结版本（冲突返回 1307）、保留摘要，成功后刷新编辑器。
    - heading "运行历史" [level=4]
    - list:
      - listitem:
        - button "候选已就绪（含提示） 10/7/2026, 9:18:41 PM"
      - listitem:
        - button "候选已就绪（含提示） 10/7/2026, 9:18:41 PM"
      - listitem:
        - button "候选已就绪（含提示） 10/7/2026, 9:18:41 PM"
    - group: 运行关联信息（排查用）
```

# Test source

```ts
  192 |     page,
  193 |   }) => {
  194 |     // 停靠点：第一段改写完成并被接受，第二段在途
  195 |     await control({
  196 |       script: { rewrite: ['（脚本改写一）', '（脚本改写二）'] },
  197 |       hangAfterNth: { [REWRITE_KEY]: 1 },
  198 |     });
  199 |     await loginViaUi(page);
  200 |     await openRefinementPanel(page, fixture.projectId);
  201 |     await startRefinement(page);
  202 | 
  203 |     await expect
  204 |       .poll(async () => countCalls(await calls(), REWRITE_KEY) >= 2, { timeout: 60_000 })
  205 |       .toBe(true);
  206 | 
  207 |     const runId = await panel(page).getAttribute('data-run-id');
  208 |     await panel(page)
  209 |       .getByRole('button', { name: /取消精修/ })
  210 |       .first()
  211 |       .click();
  212 |     // 取消是二次确认：必须显式点「确认取消」
  213 |     const confirmDialog = page.locator('.ant-modal-confirm').filter({ hasText: '取消智能精修' });
  214 |     await expect(confirmDialog).toBeVisible({ timeout: 15_000 });
  215 |     await confirmDialog.getByRole('button', { name: '确认取消' }).click();
  216 | 
  217 |     await expect(
  218 |       panel(page)
  219 |         .getByRole('button', { name: /继续精修/ })
  220 |         .first()
  221 |     ).toBeVisible({
  222 |       timeout: 60_000,
  223 |     });
  224 |     const attemptBefore = await panel(page).getAttribute('data-attempt-id');
  225 |     const callsBefore = (await calls()).length;
  226 | 
  227 |     await panel(page)
  228 |       .getByRole('button', { name: /继续精修/ })
  229 |       .first()
  230 |       .click();
  231 |     await expect
  232 |       .poll(async () => (await calls()).length > callsBefore, { timeout: 60_000 })
  233 |       .toBe(true);
  234 | 
  235 |     expect(await panel(page).getAttribute('data-run-id')).toBe(runId);
  236 |     expect(await panel(page).getAttribute('data-attempt-id')).not.toBe(attemptBefore);
  237 |     // 取消时不覆盖正文
  238 |     expect((await readChapter(fixture)).content).toBe(NEUTRAL_CHAPTER_CONTENT);
  239 |   });
  240 | 
  241 |   test('3) 完成后再次开始：新 run 新 clientRequestId；创建响应丢失后重试复用原 key', async ({
  242 |     page,
  243 |   }) => {
  244 |     const createKeys: string[] = [];
  245 |     await page.route(CREATE_RUN_PATH, async (route) => {
  246 |       const post = route.request().postDataJSON() as { clientRequestId?: string } | null;
  247 |       if (post?.clientRequestId) {
  248 |         createKeys.push(post.clientRequestId);
  249 |       }
  250 |       await route.continue();
  251 |     });
  252 | 
  253 |     await control({ script: { rewrite: ['（脚本改写一）'] } });
  254 |     await loginViaUi(page);
  255 |     await openRefinementPanel(page, fixture.projectId);
  256 |     await startRefinement(page);
  257 |     await waitForApplyReady(page);
  258 |     const firstRunId = await panel(page).getAttribute('data-run-id');
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
> 292 |     ).toBeVisible({ timeout: 30_000 });
      |       ^ Error: expect(locator).toBeVisible() failed
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
```