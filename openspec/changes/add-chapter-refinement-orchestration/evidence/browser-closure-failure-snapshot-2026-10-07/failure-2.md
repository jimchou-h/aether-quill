# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chapter-refinement-closed-loop.spec.ts >> chapter refinement closed loop with scripted model (B4) >> 2) 取消（含确认弹窗）保留接受稿 → 继续后同 run 新 attempt，旧调用不覆写
- Location: e2e\chapter-refinement-closed-loop.spec.ts:191:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
```

# Test source

```ts
  105 |   await page.goto(`/projects/${projectId}/chapters?refinement=1`);
  106 |   await expect(page.getByRole('heading', { name: '章节模块' })).toBeVisible({ timeout: 30_000 });
  107 |   await page
  108 |     .getByRole('button', { name: /章节优化|文笔优化/ })
  109 |     .first()
  110 |     .click();
  111 |   const dialog = page
  112 |     .locator('.ant-modal')
  113 |     .filter({ hasText: /文笔优化/ })
  114 |     .first();
  115 |   await expect(dialog).toBeVisible({ timeout: 15_000 });
  116 |   await dialog
  117 |     .getByRole('button', { name: /智能精修/ })
  118 |     .first()
  119 |     .click();
  120 |   await expect(page.locator('.refinement-panel').first()).toBeVisible({ timeout: 15_000 });
  121 | }
  122 | 
  123 | async function startRefinement(page: Page): Promise<void> {
  124 |   const panel = page.locator('.refinement-panel').first();
  125 |   await panel.locator('#chapter-refinement-instruction').fill('收紧节奏，保持剧情与人物状态不变。');
  126 |   await panel.getByRole('button', { name: /开始智能精修/ }).click();
  127 | }
  128 | 
  129 | function panel(page: Page) {
  130 |   return page.locator('.refinement-panel').first();
  131 | }
  132 | 
  133 | /** 等到应用按钮出现（ready / ready_with_issues 终态）。 */
  134 | async function waitForApplyReady(page: Page): Promise<void> {
  135 |   await expect(
  136 |     panel(page)
  137 |       .getByRole('button', { name: /应用候选稿/ })
  138 |       .first()
  139 |   ).toBeVisible({
  140 |     timeout: 90_000,
  141 |   });
  142 | }
  143 | 
  144 | test.describe('chapter refinement closed loop with scripted model (B4)', () => {
  145 |   test.skip(!ENABLED, SKIP_REASON);
  146 | 
  147 |   let fixture: RefinementFixture;
  148 | 
  149 |   test.beforeAll(async () => {
  150 |     fixture = await createRefinementFixture();
  151 |   });
  152 | 
  153 |   test.afterAll(async () => {
  154 |     if (fixture) {
  155 |       await deleteRefinementFixture(fixture);
  156 |     }
  157 |   });
  158 | 
  159 |   test.beforeEach(async () => {
  160 |     await reset();
  161 |     await discardRefinementRuns(fixture);
  162 |     await seedChapter(fixture, NEUTRAL_CHAPTER_CONTENT);
  163 |   });
  164 | 
  165 |   test('1) 启动看到进度 → 刷新后同 run 恢复，临时稿不冒充接受稿', async ({ page }) => {
  166 |     await control({ hangAfterNth: { [REWRITE_KEY]: 0 } });
  167 |     await loginViaUi(page);
  168 |     await openRefinementPanel(page, fixture.projectId);
  169 |     await startRefinement(page);
  170 | 
  171 |     // 阶段屏障：确实发起了改写调用（进度已产生）
  172 |     await expect
  173 |       .poll(async () => countCalls(await calls(), REWRITE_KEY) >= 1, { timeout: 60_000 })
  174 |       .toBe(true);
  175 | 
  176 |     const runIdBefore = await panel(page).getAttribute('data-run-id');
  177 |     expect(runIdBefore).toBeTruthy();
  178 | 
  179 |     await page.reload();
  180 |     await expect(panel(page)).toBeVisible({ timeout: 60_000 });
  181 |     // 同一个 run 被恢复
  182 |     await expect
  183 |       .poll(async () => panel(page).getAttribute('data-run-id'), { timeout: 30_000 })
  184 |       .toBe(runIdBefore);
  185 |     // 未确认应用的临时稿不得进入正文
  186 |     const persisted = await readChapter(fixture);
  187 |     expect(persisted.content).toBe(NEUTRAL_CHAPTER_CONTENT);
  188 |     await expect(page.locator('.content-text').first()).toContainText('甲在院里等了很久');
  189 |   });
  190 | 
  191 |   test('2) 取消（含确认弹窗）保留接受稿 → 继续后同 run 新 attempt，旧调用不覆写', async ({
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
> 205 |       .toBe(true);
      |        ^ Error: expect(received).toBe(expected) // Object.is equality
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
```