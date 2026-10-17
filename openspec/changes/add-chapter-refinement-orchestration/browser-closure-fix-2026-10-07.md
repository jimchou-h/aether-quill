# B4 浏览器闭环：三项测试逻辑错误修复与 7/7 全绿（2026-10-07 晚）

针对 [browser-closure-reverification-2026-10-07.md](browser-closure-reverification-2026-10-07.md)
指出的三项 P1 测试资产缺陷与七例 UI/时序问题。本轮只改测试资产（e2e），不改产品代码。

## 结论

**B4 七例在本机真实栈（docker PG + 真实 API/Web + 假编排器）实际执行 7 passed / 0 failed（desktop）。**
三项测试逻辑错误已修复，且均以「先复现 → 再修 → 复跑」方式验证。

## 三项测试逻辑错误 → 修复

### 1. 每例清理旧 run 实际失效（reverification 缺口二）

根因（与验收一致）：

1. `listRuns` 真实返回 `RefinementRunSummary[]`（数组），夹具却按 `{ runs: [...] }` 解包，
   `data.runs ?? []` 恒为空，从不 discard；
2. discard 必须带 `{ expectedRunRevision }`，缺失返回 1400；
3. 4xx 不自动 reject，夹具没查 `.ok()`，失败被当成功。

修复（`apps/web/e2e/support/refinement-fixture.ts`）：
- 按数组解包 `unwrap<RefinementRunSummary[]>`；
- 每个 run 读取 `revision`，POST body 传 `{ expectedRunRevision: revision }`；
- list / discard 都检查 `.ok()`，失败抛错不再静默；
- `beforeEach` 顺序改为 **先 discard（停旧运行）→ 再 reset 假编排器 → 再重置正文**，
  避免上一例迟到请求污染本例调用计数、预算与原文版本。

### 2. 停靠脚本不可能产生第二次改写（reverification 缺口一）

根因（与验收一致）：中性章节有三个 SourceBlock（b0 标题 + b1/b2 两段正文），
假编排器默认 inspect/plan 只覆盖 b0，第二例只改 rewrite 文本，等待 calls≥2 永远超时。

修复（`apps/web/e2e/support/fake-orchestrator.mjs`）：
- 默认 inspect 返回三场（b0/b1/b2 各自 `startsNewScene`）；
- 默认 plan：scene-1（b0）`keep`，scene-2（b1）/ scene-3（b2）各 `rewrite`——
  产生 3 个 unit（u0 keep、u1/u2 rewrite），即**两次真实 rewrite 调用**；
- `.rewrite` 无显式脚本时返回中性改写文本（能过程序门禁），不再落回占位语。

用例 2 重写：取消前断言首个范围的接受稿已随 checkpoint 持久化（`readRefinementRunView`
读 `acceptedDraftText` 含「脚本改写一」、标题 keep 保留）、取消后保留、继续后同 run 新 attempt
且接受稿仍在（resume 复用 checkpoint 不重跑已接受单位）。

### 3. 应用一致性断言可被跳过（reverification 缺口三）

根因（与验收一致）：拦截了不存在的 `/optimize/refinement/runs/:runId/apply`；
真实 apply 复用 `/knowledge/chapters/:chapterNo/optimize/apply`，响应经统一包装
`{ code, msg, data: { chapter: { content } } }`；`if (appliedContent)` 在未捕获响应时跳过全等断言。

修复（spec 用例 6）：
- 监听真实 apply 路径，**强制断言**请求已发出、响应 2xx、`data.chapter.content` 非空且含改写标记；
- 四路全等：运行候选（`acceptedDraftText`）＝ apply 响应正文 ＝ 持久化 content ＝ UI 正文（含刷新后）；
- 摘要保留断言不变；
- 成功后等待**章节主页面刷新**（`.content-text` 出现改写标记），不再等已销毁的面板提示。

## 七例 UI / 时序对齐

| 例 | 修复 |
|---|---|
| 1 刷新恢复 | 刷新后断言回到章节主页面且面板销毁（弹窗不自动重开），再经 `openRefinementPanel` 重开两层弹窗核对同 run；临时稿不进正文断言保留 |
| 2 取消继续 | 两场脚本 + 首段接受稿三段断言（取消前/取消后/继续后）+ 同 run 新 attempt + 正文不被覆盖 |
| 3 幂等与响应丢失 | `route.fetch()` 先让创建请求**真实到达服务端**再 abort 丢响应（直接 abort 是请求到达前断开——服务端根本没建，重试必然新建第二个 run，恰为验收批评的原缺陷形态）；服务端状态用夹具 API `listRuns` 独立观察：丢响应后已有新 run、重试后 run 总数不变（幂等命中不新建）且面板展示的就是列表内该 run；错误反馈改为等「启动按钮重新可用」（`start.catch` 走全局反馈，不在面板内渲染） |
| 4 E1/接口故障 | `boundary_conflict` 暂停按实际合同断言：status 精确 `paused`、应用按钮 disabled、**「继续精修」按钮存在**（boundary_conflict 的 resumable=true）；注入 resume 500 强制命中故障路径并观察到失败反馈；resume 失败后仍 paused、apply 仍禁用、无任何真实 apply 请求 |
| 5 原文冲突 | 先等 ready 且 enabled 再改源文；`page.waitForResponse` 纯观察真实 apply（不拦截重放）；断言 HTTP 400 且 msg 含「已被其他操作更新」——注意 `HttpExceptionFilter` 会把业务 code 统一映射为 1503（Bad Request），1307 的业务语义由 msg 承载；新正文不被覆盖 |
| 6 应用 | 见上「三项修复 · 3」 |
| 7 旧入口 | 实际 UI 行为：编辑态下「章节优化 / 按场成稿」按钮**不渲染**（detail-actions 的 v-if/v-else），即未保存改动时入口不可达（保护的实际形态）；断言编辑态两按钮 count=0 → 保存退出编辑态 → 入口恢复 → 弹窗内方案改写/直接改写/自动循环与「智能精修（草稿）」入口可见 |

`waitForApplyReady` 改为**先断言终态**（`data-status` 精确匹配 `ready|ready_with_issues`），
再等应用按钮 **enabled**——只可见会让 running/paused 阶段抢跑。

## 执行记录（本机，2026-10-07 22:00 前后）

栈：docker `aether-quill-postgres`（`chapter_refinement_runs` 表已迁移）；
api 以构建产物 `node dist/main` 起在 3000（`RAG_ORCHESTRATOR_URL=http://127.0.0.1:4409` 直连假编排器）；
假编排器 4409；web vite 5173。测试账号 `e2e-refinement@aether.local`（本轮将密码重置为与种子一致的
`password123`，仅本地测试账号；SQL 直改 `users`，无注册接口）。

```
Running 7 tests using 1 worker
  ok 1 … 刷新后同 run 恢复，临时稿不冒充接受稿
  ok 2 … 取消（含确认弹窗）保留接受稿 → 继续后同 run 新 attempt
  ok 3 … 新 run 新 clientRequestId；创建响应丢失后重试复用原 key
  ok 4 … E1 阻断与接口故障：应用按钮不可用，resume 失败不进入可应用
  ok 5 … 原文版本变化：真实 apply 走 1307，不覆盖新正文
  ok 6 … ready_with_issues → 明确确认 → 真实 apply：UI 与持久化正文全等且保留摘要
  ok 7 … 未保存改动时入口不可达（保护），保存后旧入口仍可用
  7 passed (56.0s)
```

日志：`.scratch/refinement-b4/e2e-run8-final.log`（最终连续两次 7/7）、
`.scratch/refinement-b4/start-b4.sh`（搭栈脚本）、`gate-*.log`（门禁）。

## 门禁（修复后，本机 2026-10-07）

```
pnpm -r lint        → exit 0
pnpm -r typecheck   → exit 0
pnpm -r test        → exit 0（config 47 + web 192 + model-providers 10 + api 620 + worker 8 + orchestrator 189 = 1066 pass / 0 fail / 9 skip）
pnpm -r build       → exit 0（需先停掉本机 api 进程——运行中的 node dist/main 会锁 Prisma 引擎 DLL 导致 EPERM）
openspec validate add-chapter-refinement-orchestration --strict → valid
```

9 个 skip 仍为 PG 分支（`REFINEMENT_PG_TEST_URL` 未配置时的显式 skip），不重复累加为通过数。

## 复现步骤

```powershell
# 1) 假编排器
node apps/web/e2e/support/fake-orchestrator.mjs --port 4409
# 2) api（构建产物；RAG_ORCHESTRATOR_URL 直连假编排器）
cd services/api
$env:DATABASE_URL = "postgresql://aether:aether_password@127.0.0.1:5432/aether_quill"
$env:RAG_ORCHESTRATOR_URL = "http://127.0.0.1:4409"
node dist/main.js
# 3) web
cd apps/web; pnpm exec vite --port 5173
# 4) 测试
cd apps/web
$env:E2E_EMAIL = "e2e-refinement@aether.local"; $env:E2E_PASSWORD = "password123"
$env:E2E_BASE_URL = "http://127.0.0.1:5173"; $env:E2E_API_BASE_URL = "http://127.0.0.1:3000"
$env:E2E_FAKE_ORCHESTRATOR_URL = "http://127.0.0.1:4409"
npx playwright test chapter-refinement-closed-loop.spec.ts --project=desktop
```

## 边界说明

- 「未保存改动守卫弹窗」（`ensureChapterSavedBeforeOptimize`）在当前 UI 无纯用户操作触发路径
  （编辑态下优化按钮不渲染，守卫为防御性代码）；用例 7 按实际行为断言「编辑态入口不可达」。
  若后续产品提供编辑态可达的优化入口，需补「返回编辑器 / 先保存并继续」的弹窗断言。
- 用例 5 的 `1307` 断言落在 msg 文本上：`HttpExceptionFilter` 对 BadRequestException 统一返回 code=1503，
  业务错误码不透传到 HTTP 响应体（产品行为，非本轮改动）。
- 复验报告提到的「checkpoint 保存故障注入」「旧链路（旧方案改写/直接改写/循环/按场成稿）实际回归」
  仍按原收口计划作为遗留项，未在本轮扩大范围。
