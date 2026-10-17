# 章节精修编排：验收阻断项修复回填（2026-10-07）

本文件回填 [工程验收报告](verification-2026-10-07.md) 中六组阻断项（F1～F6）与五项告警（W1～W5）的修复文件、正式测试与结果。修复不改写验收报告本身，也不替开发者勾选任务；AQ-386 的真实模型长章稳定性、文学质量盲评与正式发布仍不在本次范围。

## 修复与证据总览

| 项 | 结论 | 修复要点 | 主要测试 |
|---|---|---|---|
| F1 中途 checkpoint | 已修 | 引擎 `onCheckpoint` 钩子 + 服务以 attemptId/revision CAS 落库；checkpoint 改为快照（非引用） | engine F1；service F1×2 |
| F2 必要事实不丢 | 已修 | 只补缺失字段；降级/漏项记 `fact_downgraded`/`fact_dropped`；不回填覆盖错误字段 | util F2×5 |
| F3 检查未完成不接受 | 已修 | 单位 review/复检未完成即暂停；`reviewedUnitIds` 账本；整章检查分组 + 覆盖账本；无完成检查不判成功 | engine F3 |
| F4 冻结路由真正下发 | 已修 | 引擎按档传 `modelRoute` → 网关 `generationRouteOverride` → orchestrator 采用；路由缺失显式暂停 | engine F4×2；gateway F4×2 |
| F5 状态证据传递 | 已修 | `verifyRefinementStateFact` 判证据/未知/冲突；有据状态经 checkpoint 传给下游，凭空状态记为阻断 | util F5；engine F5 |
| F6 预算不越界 | 已修 | 每次真实调用前原子准入（含重试）；单次调用设剩余活动时间截止；按完整输入+预期输出保守预算；最终检查分组 | util F6×2；engine F6×2 |
| W1 真实 PG 测试 | 已修 | 统一静态 import，消除 tsx 下类身份不一致；真实临时 PG 契约测试全过 | repository.test（PG 分支） |
| W2 再次启动幂等键 | 已修 | 幂等键生命周期抽为可测逻辑；composable 注入假 API 真实驱动 | web composable×3 |
| W3 不冻结未发布草稿 | 已修 | 模板材料只取已发布文本或发布默认 | materials.test（含「有草稿、无发布文本」） |
| W4 创建接口 202 | 已修 | 控制器 `@HttpCode(202)` | controller HTTP 合同测试 |
| W5 门禁与等价入口 | 部分修 | Windows glob 改引号形式；orchestrator 加 `--test-force-exit`；浏览器作者路径 E2E 待跑 | 各包 test 脚本 |

## F1 · 中途没有持久化 checkpoint

- 引擎：`chapter-refinement.engine.ts`
  - 新增可注入的 `onCheckpoint(checkpoint)` 钩子与 `now()` 时钟。
  - 计划冻结后与**每个单位接受/保留后**调用 `commitCheckpoint`；`buildResumeState`/`buildCheckpoint` 返回**快照**（`changes`/`issues`/`replacements` 均复制），避免中途提交后被后续改写污染。
  - `commitCheckpoint` 前将 `acceptedDraftText` 更新为「已接受前缀 + 剩余原文」，中途落库即为真实进度。
- 服务：`chapter-refinement.service.ts`
  - 向 `engine.run` 传入 `onCheckpoint`：读取最新记录，`attemptId` 不匹配（取消 / 续跑后）即拒绝写入；匹配则以 `latest.revision` 做 CAS 落库并推进 revision。取消时 `stopRun` 保存最后有效 checkpoint。
- 测试
  - `chapter-refinement.engine.test.ts` `F1 计划冻结与每个已接受单位都提交 checkpoint，重启可从上一个已接受单位恢复`：断言计划冻结与 3 次「已接受」提交；以第 1 段后的 checkpoint 重新进入，重启不重跑 inspect/plan、不重做第 1 段。
  - `chapter-refinement.service.test.ts` `F1 中途 checkpoint 落库…`（取消后仓库仍保留已接受稿）、`F1 取消后的迟到 checkpoint 被拒绝…`。

## F2 · plan 恢复不得丢失或覆盖已证实必要事实

- `chapter-refinement.util.ts`：重写 `backfillFactList` 只补缺失字段；缺 `sourceBlockId` 且引文可由唯一索引佐证才补，否则记 `missing_fact_source`；同一 key/value 多来源记 `ambiguous_backfill`。新增 `verifyNecessaryFactsPreserved`，降级为 `null` 记 `fact_downgraded`、整项遗漏记 `fact_dropped`，并将二者纳入不可降级违规。
- 测试：`chapter-refinement.util.test.ts` F2 五项（降级、漏项、错误引文不覆盖、唯一佐证回填、歧义不猜）。

## F3 · 必要检查未完成不得接受；回退后须重检

- `chapter-refinement.engine.ts`：单位 review 未完成（上游持续失败 / 不可解析）即按 `pauseFromOutcome`（或 `budget_exhausted`）暂停，不再以 warning 继续接受；补修后复检未完成同样暂停。新增 `reviewedUnitIds` 账本记录已完成的必要检查。整章最终检查改为按字符预算 `groupRefinementRangesByBudget` 分组并登记 `finalCheckCoveredUnitIds`，任一分组未完成即暂停；存在已接受范围却未完成最终检查时兜底暂停，不判 `ready`/`ready_with_issues`。
- 测试：`chapter-refinement.engine.test.ts` `F3 必要 review 未完成：不得接受候选…`（暂停、候选等于原文、零变更）。

## F4 · 冻结模型路由与材料必须真正传到调用

- 引擎：按 `CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS` 分档，从 `snapshot.modelRoutes` 取 utility/writing 路由随每次调用传给网关；`snapshot.modelRoutes` 存在但档位不全时**显式暂停**，不静默回退。
- 网关：`chapter-refinement.gateway.ts` 将 `modelRoute` 转为 `context.generationRouteOverride`。
- Orchestrator：`services/rag-orchestrator/src/main.ts` 新增 `readGenerationRouteOverride`/`applyGenerationRouteOverride`，在解析生成档位后直接采用随请求下发的冻结 provider/model/temperature，不再读取当前设置。
- 测试：`chapter-refinement.engine.test.ts` F4×2（分档传入、不完整暂停）；新增 `chapter-refinement.gateway.test.ts` F4×2（本地 SSE 服务器捕获真实请求体，断言 `generationRouteOverride`）。

## F5 · 散场状态事实需有证据并经 checkpoint 传递

- `chapter-refinement.util.ts`：新增 `verifyRefinementStateFact`（`evidence`(candidate/original) / `unknown` / `conflict`）。
- `chapter-refinement.engine.ts`：单位接受后逐条核验 review 的 `exitStateFacts`；有据者写入 `stateFacts`（随 checkpoint 持久化）并注入后续单位的改写 / 检查提示；凭空状态记 `continuity` 阻断问题并拒绝传递；`unknown` 不作为确定状态。review 提示补入真实已接受前文与已确认状态。
- 类型：`chapter-refinement.types.ts` `RefinementStateFact`、`RefinementResumeState.stateFacts`。
- 测试：`chapter-refinement.util.test.ts` F5；`chapter-refinement.engine.test.ts` `F5 有据状态传递给后续单位，凭空状态被拒绝…`。

## F6 · 重试不得越过调用上限；完整输入预算

- `chapter-refinement.util.ts`：新增 `resolveRefinementCallBudget`（按完整输入 + 预期输出夹逼，输入超限明确拒绝）、`groupRefinementRangesByBudget`、`estimateRefinementInputTokens` 及供应商上下文/输出保守常量。
- `chapter-refinement.engine.ts`：每次实际发起（含所有重试）前做原子预算准入；为当前调用设置剩余活动时间截止（超时按 `budget_exhausted` 收束，区别于用户取消）；`callParse` 透传 `budgetExhausted`；改写/检查调用改按 `desiredOutputChars` 计预算；最终检查分组。
- 测试：`chapter-refinement.util.test.ts` F6×2；`chapter-refinement.engine.test.ts` F6×2（调用数不超过上限；预算不足在改写前原子拒绝）。

## W1～W5

- **W1**：`chapter-refinement-run.repository.test.ts` 改为从顶部静态 import `PgChapterRefinementRunRepository`（与 `RefinementRunConflictError` 同源），消除 tsx 下静态/动态 import 的类身份不一致。用本机真实 PG（`REFINEMENT_PG_TEST_URL`）运行，内存与 PG 两分支契约全过。
- **W2**：`apps/web/src/utils/chapterRefinement.ts` 新增 `createRefinementStartRequestIdTracker`；`useChapterRefinementRun.ts` 支持注入 `api`，`start()` 用 `begin()`/`commit()` 轮换幂等键，`reset()` 换新键。新增 `useChapterRefinementRun.test.ts`（真实 composable + 假 API）：再次启动分配新 key、创建失败重试复用同 key、reset 后新 key。
- **W3**：`chapter-refinement.materials.ts` 只取 `publishedText` 或 `defaultText`；`materials.test.ts` 增加「有草稿、无发布文本时冻结发布默认」。
- **W4**：`chapter-refinement.controller.ts` 创建接口补 `@HttpCode(202)`；新增 `chapter-refinement.controller.test.ts` HTTP 层合同测试。
- **W5**：各包 `test` 脚本改为引号包裹的 glob（`node --import tsx --test 'src/**/*.test.ts'`），Node 22 自行展开，规避 Windows shell 不展开 `**` 的问题；orchestrator 脚本加 `--test-force-exit` 以在句柄未释放时正常收口。浏览器作者路径 E2E（`apps/web/e2e/chapter-refinement-author-path.spec.ts`）保持待跑。

## 门禁结果（本机，2026-10-07）

| 检查 | 结果 |
|---|---|
| `services/api` test（引号 glob） | 564 tests / 563 pass / 1 skipped（未设 PG URL） |
| `services/api` test（设 `REFINEMENT_PG_TEST_URL`） | **564 pass / 0 fail / 0 skip**（repository 内存 + 真实 PG 两分支全过） |
| `services/rag-orchestrator` test | 173 pass / 0 fail，`--test-force-exit` 正常收口 |
| `apps/web` test | 187 pass / 0 fail（含新增 composable 3 项） |
| `packages/config` / `model-providers` / `services/worker` | 47 / 10 / 8 pass |
| `eslint`（api、web、orchestrator） | 全部 exit 0 |
| `tsc --noEmit`（api、orchestrator）、`vue-tsc`（web） | 通过 |
| `build` | shared-types / config / model-providers / web 通过；api `tsc` 编译落地成功，但 `nest build` 因本机对既有 `dist/`（633 文件）的批量删除保护被拦下（环境限制，非代码问题） |

## 未关闭项

- 浏览器作者路径 E2E 需 `E2E_EMAIL`/`E2E_PASSWORD` 与可用后端，本环境未执行，保留待跑。
- AQ-386（任务 7.1）：真实模型长章稳定性、文学质量盲评、模板冻结样本发布与正式入口开放，仍为待验收。
