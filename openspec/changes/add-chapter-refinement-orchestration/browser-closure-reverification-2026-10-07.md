# R1 / R2 修复与 B4 浏览器闭环独立复验

日期：2026-10-07。任务：AQ-381 / AQ-383 / AQ-384 / AQ-385；change：`add-chapter-refinement-orchestration`。

## 结论

**R1 / R2 原始缺陷本轮已验证关闭；B4 尚不能签收，剩余并非只有选择器与时序。**

当前未发现这两项产品缺陷仍然存在。浏览器七例的失败大部分能解释为测试操作/等待与实际 UI 不符；但假模型脚本、夹具清理、应用响应捕获和必需路径覆盖也没有闭合，不能仅通过调选择器或延长等待验收。

本轮不开发产品，不改现有 E2E 或任务完成状态。新增独立中性探针与报告，保存观察/指纹。未调用真实模型，未登录或修改真实作者项目，未发布、归档。

## 独立执行结果

| 检查 | 结果 |
|---|---|
| `pnpm -r lint` | exit 0 |
| `pnpm -r typecheck` | exit 0 |
| `pnpm -r test` | exit 0；**1066 pass / 0 fail / 9 skip** |
| `pnpm -r build` | exit 0 |
| OpenSpec strict validate | valid，exit 0 |
| 单独配置本机 PG 随机临时 schema | **10 pass / 0 fail / 0 skip**：原仓库 2 + 服务重建 8，含新增权限撤销/冻结材料断言 |
| `batch-acceptance-probes-2026-10-07.ts` | exit 0，当前已改为正确行为回归 |
| 本轮 `browser-contract-audit-probes-2026-10-07.ts` | exit 0；验证下述测试资产缺口，**不算浏览器闭环 PASS** |

全仓通过数：config 47、web 192、model-providers 10、api 620、worker 8、orchestrator 189。默认 9 个 skip 是 PG 分支，另行配置 PG 已实际执行；不把重复用例累加为新增通过数。

日志：`.scratch/refinement-latest-acceptance/`。本轮读取开发者 `.scratch/refinement-b4/e2e-run7.log` 与七份 error-context，查看应用成功和刷新后页面截图。开发者最后一次 desktop 结果为 **7 failed**；本轮没有将这些旧截图当作独立浏览器通过证据，也没有重新启动其 Web/API 栈执行七例。

## 已关闭：R2 同句末态漏检

复跑中性原反例：`甲手里拿着钥匙走到门边后把钥匙放在桌上。`

结果由旧的 `evidence` 改为 `superseded`。真实 engine 的 checkpoint 不登记 holding=`拿着钥匙`，下一范围“前文已确认的当前状态”小节不出现该事实，正文邻文仍正常保留。

`chapter-refinement.util.ts:1546` 已从锚点末端 `candidate.slice(end)` 扫描剩余正文，同句尾部被覆盖；supersededBy 的顺序也按程序定位核对。API 新增判定/引擎回归通过。

## 已关闭：R1 实际阶段隔离

独立探针经**真实网关 → 隔离的真实 orchestrator HTTP 入口 → 本机假 provider**捕获最终消息：

| 阶段 | 冻结项目指导 | 冻结文风样本 | 任务合同 / 人物 / 知识 |
|---|---|---|---|
| inspect / plan / review | 不出现 | 不出现 | 保留 |
| rewrite / repair | 出现 | 出现 | 保留 |

`main.ts:1267` 已按精修模板键强制 omit，项目 override 不再重新打开 utility 指导；engine 只在 writing 下发项目指导。新增实际入口六例也纳入标准全仓测试并通过。上一轮“只在手工 context 下通过”的缺陷已关闭。

## B4 剩余缺口一：停靠脚本不可能产生第二次改写（P1，测试资产）

位置：`apps/web/e2e/support/fake-orchestrator.mjs:42`、`:61`；spec `:195`、`:204`。

隔离中性章节实际有三个 SourceBlock：b0 是标题，b1 / b2 是两段正文。假 inspect / plan 默认只返回 b0，第二例只改 rewrite 文本和 `hangAfterNth`，没有提供覆盖两场的 inspect / plan。

本轮用**真实 engine + 真实 gateway + 交付的假编排器**复现相同脚本，实际调用为 inspect → plan → **rewrite 一次** → review → review，最终 `ready_with_issues`，100 字中保留原文 88 字。不存在第二次 rewrite，因此等待 calls≥2 无论延长多久都不会通过。

这是测试前提错误，当前程序保留未覆盖正文的保护行为符合设计。修复应为该场景提供覆盖真实 block 的两场规划，必要时把标题设为 keep，再在第二个改写范围挂起。必须在取消前断言首个范围的接受稿已保存，继续后断言同 run、新 attempt、接受稿保留与迟到结果不覆盖。

## B4 剩余缺口二：每例清理旧 run 实际失效（P1，测试资产）

位置：`apps/web/e2e/support/refinement-fixture.ts:155`；service `chapter-refinement.service.ts:270`、`:517`。

1. listRuns 的真实 `data` 是 `RefinementRunSummary[]`。夹具却按 `{ runs: [...] }` 解包，`data.runs ?? []` 恒为空，所以不发任何 discard。
2. 即使改正列表形状，当前 discard POST 没有传必需的 `expectedRunRevision`，真实服务会返回 1400。
3. HTTP 4xx 不会自动 reject Playwright request；夹具没有检查 `.ok()`，失败被当清理成功。

独立探针调用真实夹具函数，用符合实际接口的假 API 响应核对：数组响应下 discard 次数为 0；提供它期望的合成 `{runs}` 后则发送无 body 的 POST，HTTP 400 仍正常返回。

因此“每例独立初态”尚未建立。上一例仍在后台的运行可能污染新例调用计数、预算与原文版本。修复列表解包，读取新 revision、按合同 discard，检查响应并核实旧运行均已终止/清理；在 reset 假服务计数和重置正文之前先停掉旧运行，避免跨例迟到请求。

## B4 剩余缺口三：应用一致性断言目前可以被跳过（P1，测试资产）

位置：spec `:375`、`:379`、`:402`；`apps/web/src/services/api.ts:1519`。

测试拦截 `/optimize/refinement/runs/:runId/apply`，真实精修仍复用 `/knowledge/chapters/:chapterNo/optimize/apply`，所以拦截永远不会命中。即使修路径，还要读取统一包装的 `data.chapter.content`。当前 `if (appliedContent)` 会在没捕获到响应时跳过完整相等断言。

第六例截图显示正文已更新、弹窗已关闭，说明它当次实际走到了应用后的页面；这不能代替 API 返回值、候选、持久化正文完整相等的证据。失败原因是应用成功后继续等已经销毁的 `.refinement-panel` 提示（`ChapterOptimizeDialog.vue:162` 明确关闭弹层并通知父级）。

修复：监听真实 apply 响应，强制断言请求已发出、成功响应已取得且正文非空；比较运行候选、`data.chapter.content`、持久化 content 和 UI 正文。保留摘要断言，成功后等待章节主页面刷新，而非消失的面板。

## 七例 UI / 时序问题与尚未证明的行为

| 例 | 现有失败或遗漏 | 应按实际合同验证 |
|---|---|---|
| 1 刷新恢复 | 刷新后直接等面板；截图是章节主页面 | 页面初态 `showWritingOptimizeModal=false`，`?refinement=1` 只显示受控入口，不会自动开弹窗。刷新后重开两层弹窗，再核对同 run、接受稿/临时稿与后台继续 |
| 2 取消继续 | calls≥2 超时 | 先修两场脚本与清理；补首段接受稿及迟到结果断言，当前仅比较 run/attempt/原文不足以证明保留稿 |
| 3 幂等与响应丢失 | 等面板内“发起智能精修失败”，实际 start.catch 通过全局反馈报告 | 等正确的请求结果/反馈及启动按钮重新可用。`route.abort()` 当前在请求到达服务前断开，不能证明“服务已创建但响应丢失”；应让真实创建完成后丢弃响应，重试并核对相同 run、相同 key、仅创建一次 |
| 4 E1/接口失败 | 期待按钮不存在，但实际按钮存在且禁用 | 禁用符合保护要求；按状态、禁用及无 apply 请求断言。已知不可定位阻断应暂停，不应接受 `ready_with_issues` 为 E1 成功。resume 错误分支是可选 if，可能完全没执行；另造可恢复暂停并强制命中该故障路径 |
| 5 原文冲突 | 点击禁用按钮超时 | `waitForApplyReady` 只等可见，面板在 running/paused 也有此按钮；必须等 ready 且 enabled 后再改源文，防止把运行中 source_changed 暂停误作应用冲突。再通过真实 apply 检查 1307、正文不被覆盖，并完成实际确认流程 |
| 6 应用 | 正文已更新，但等消失面板的成功提示 | 修真实 apply 响应捕获与强制完整相等断言，验证 ready 和 ready_with_issues 两条路径 |
| 7 旧入口/未保存 | 点正文 pre 不会进入编辑，等待 textarea 超时 | 点击实际“编辑”按钮；制造未保存改动、触发保护、返回编辑器、保存后重开。按场成稿是章节页单独入口，不能在文笔优化弹窗里查找；原有四种生成/应用的实际行为仍需回归 |

共用 `waitForApplyReady` 应先断言终态（ready / ready_with_issues），然后等应用按钮 enabled。仅可见会让后续操作抢在检查完成前发生。

### 原收口计划里仍缺的覆盖

- checkpoint 保存失败还没有浏览器/服务集成故障路径证据；resume HTTP 500 不能替代。可在隔离测试服务中替换 repository 的保存行为做故障注入，沿用现有服务故障测试；不要求新增生产环境故障开关。
- 旧方案改写、直接改写、循环、按场成稿仍主要检查入口可见，未完成计划要求的实际旧链路回归。
- 既有 desktop 七例全失败，narrow 与 Settings 真实编辑/发布/回滚的浏览器证据也未补齐。

上述都是上一轮 R3/B4 既定验收目标的遗漏，不新增产品功能范围。

## 下一步

优先修 B4 的**清理合同 → 两场脚本 → 终态等待 → 正确 UI 操作 → 真实响应与故障断言**，随后在隔离项目实际跑完浏览器闭环并回填证据。核心 R1/R2 已关闭，B3 已有通过证据，继续保留回归即可；工程检查点 A/B 通过后再做 AQ-386 真实模型质量评测。

复现源与观察：

- `evidence/browser-contract-audit-probes-2026-10-07.ts`
- `evidence/browser-contract-audit-observations-2026-10-07.json`
- `evidence/browser-closure-reverification-manifest-2026-10-07.json`

本轮报告区分“已独立执行通过”“开发者已有失败证据”和“代码中未覆盖的断言”，不将静态用例资产视为浏览器验收通过。
