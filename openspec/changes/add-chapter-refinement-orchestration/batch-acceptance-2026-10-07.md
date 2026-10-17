# B1～B5 收口工作独立验收

日期：2026-10-07。任务绑定：AQ-381 / AQ-383 / AQ-384 / AQ-385；变更：`add-chapter-refinement-orchestration`。

## 结论

**本轮仍未通过工程验收，检查点 A / B 均不能签收。** 已确认 B1 原反例关闭、B3 新增真实 PG 重建测试通过；B2 原反例通过但同句后续变化仍漏检并实际污染下一范围；B5 项目指导隔离未进入生产调用链；B4 不仅未运行，现有测试还存在接口、操作步骤与断言缺失。

本次仅验收，新增独立中性探针、观察记录与报告，更新入口索引；未修改产品实现、任务完成状态、项目配置或作者章节，未调用真实模型、发布或归档。

| 批次 | 本轮判定 | 证据与限制 |
|---|---|---|
| B1 应用门禁 | 原反例与当前确定性回归通过 | E1 的无 unitId 保留提示无法豁免全章阻断；原 D1 / D2 / D3 探针通过 |
| B2 散场证据 | **部分通过，仍有缺陷** | 逗号分隔的原 W6 反例、重复引文、版本失效用例通过；同句锚点后的内容被跳过，错误状态登记并传播 |
| B3 PG 重建 | **新增六例实际通过** | 本机 PostgreSQL 随机临时 schema，真实 repository/service/engine 重建；加原仓库两例，共 8/8、0 skip。通用断言覆盖的限制见后文 |
| B4 浏览器闭环 | **未通过** | 静态发现 14 条（7 场景 × 2 视口）；实际运行被自动审批拦截。测试资产还缺关键步骤与行为断言 |
| B5 Prompt 入口与隔离 | **部分通过，隔离未生效** | Settings 分组单测通过；冻结文风样本阶段筛选生效；项目指导仍进入全部五阶段 |

## 独立运行结果

基于当前工作区未提交源码，HEAD：`c848ce040ebc3b075ae9f5b9d6f04af8d784bb83`。具体文件 hash 与日志 hash 见 `evidence/batch-acceptance-manifest-2026-10-07.json`，HEAD 不能单独代表本次工作区。

| 检查 | 结果 |
|---|---|
| `pnpm -r lint` | exit 0 |
| `pnpm -r typecheck` | exit 0 |
| `pnpm -r test` | exit 0；1056 pass / 0 fail / 7 skip |
| `pnpm -r build` | exit 0 |
| `openspec validate add-chapter-refinement-orchestration --strict` | valid，exit 0 |
| 另行配置本机临时 PG | 原仓库 2 + 新增重建 6，共 8 pass / 0 fail / 0 skip |
| `fourth-verification-probes-2026-10-07.ts` | exit 0；当前已改为 B1/B2 原反例的正确行为断言 |
| `final-acceptance-probes-2026-10-07.ts` | exit 0 |
| 本轮独立 `batch-acceptance-probes-2026-10-07.ts` | exit 0，**含缺陷观察断言，不能算功能通过** |
| Playwright `--list chapter-refinement-closed-loop` | 14 条，exit 0；不代表浏览器执行通过 |

全仓分包通过数：config 47、model-providers 10、web 192、api 610、worker 8、orchestrator 189。全仓 API 跳过的 7 项是 PG 分支；另行 PG 执行覆盖了这些分支，仓库测试同时包含一个内存分支，勿将重复测试累加为新增通过数。

日志位于 `.scratch/refinement-batch-acceptance/`：`lint.log`、`typecheck.log`、`test.log`、`build.log`、`pg.log`、`fourth-probes.log`、`final-probes.log`、`batch-probes.log`、`e2e-list.log`、`openspec.log`。

## R1：B5 项目写作指导隔离只存在于测试输入（P1）

实际链路：

1. `chapter-refinement.engine.ts:738` 对全部阶段发送 `snapshot.systemPromptText`。
2. `chapter-refinement.gateway.ts:83` 对全部阶段发送 `projectSystemPromptOverride`。
3. `services/rag-orchestrator/src/main.ts:1253` 读取 override，随后在 1257 强制设 `omitProjectSystemPrompt=false`。
4. 新增 `refinement-stage-injection.test.ts:85` 则手工设置 `omitProjectSystemPrompt: !stage.writingTier`，没有经过上述实际 HTTP 入口。因此其绿灯仅证明 assembler 在理想 context 下正确，不证明生产阶段隔离。

独立探针使用**真实 OrchestratorRefinementGateway → 隔离的真实 main.ts HTTP 服务 → 本机假模型 provider**，直接捕获最终 messages。临时进程使用无真实凭据的独立环境与临时工作目录，无真实项目数据、无真实模型请求。

| 阶段 | 最终 system 含冻结项目指导 | 最终 user 含冻结样本 | 任务合同 / 人物 / 知识 |
|---|---|---|---|
| inspect | **是，应为否** | 否 | 均保留 |
| plan | **是，应为否** | 否 | 均保留 |
| rewrite | 是 | 是 | 均保留 |
| review | **是，应为否** | 否 | 均保留 |
| repair | 是 | 是 | 均保留 |

修复要求：将模板对应的项目指导注入策略接入真实 context 组装，避免被 override 重新开启；维持 writing 阶段冻结语义及 utility 阶段必要事实。预算同步按该阶段实际发送材料计算。新增回归必须经过实际入口捕获 provider messages，不能再手工设正确的 omit 标志证明自己。

## R2：B2 锚点所在句的后半句被整体跳过（P1）

中性复现正文：`甲手里拿着钥匙走到门边后把钥匙放在桌上。`

review 提取：value=`拿着钥匙`，anchorQuote 与 exitAnchorQuote 均为 `甲手里拿着钥匙`。

实际判定：`evidence / start=0 / end=7 / basis=exit_confirmation`。随后真实 engine 将 holding=`拿着钥匙` 写入 checkpoint，并在第二范围的 **“前文已确认的当前状态（有证据，须保持一致）”** 中发送该错误事实；整章结果为 ready。

原因：`chapter-refinement.util.ts:1541` 只检查 `segment.start >= end` 的句段。锚点位于句中时，该句段起点在锚点之前，于是锚点之后的“把钥匙放在桌上”也一起被丢弃。这是短句中的位置扫描错误，复现使用相同“钥匙”字面词，**不需要新增语义识别能力**。

B2 文档已承认长句语义近似的局限，但本例不能据此标 W6 完全关闭；原逗号分隔反例确实已修，本项是同一证据验证问题的遗漏分支。

修复要求：检查锚点结束之后的实际正文，覆盖与锚点同句的剩余部分；保留重复定位、对白、候选版本与不确定性处理。对模型已报告的 supersededBy 校验其引用位置与锚点的先后关系。添加同句后续转移的引擎测试，同时断言 checkpoint 不登记错误确定状态、下一范围的确定状态小节不出现它；不要仅断言全文不含词，因为已接受邻文正常包含历史动作。

## R3：B4 资产未形成可签收的浏览器闭环（P1，验收缺口）

正式执行命令被自动审批拒绝。原因为：用例尚未证明隔离项目，若环境变量已配置可能登录并修改首个真实项目/章节；验收授权不覆盖潜在真实业务数据变更。未绕过审批，也没有启动会写作者正文的测试。

这不只是缺一个账号。`apps/web/e2e/chapter-refinement-closed-loop.spec.ts` 当前有以下可定位缺口：

| 场景 / 位置 | 当前代码 | 缺失或错误 |
|---|---|---|
| 公共入口 57；helpers `openFirstProject` | 可指定 E2E_PROJECT_ID，否则取首个项目 | 不创建隔离夹具，也不证明指定项目只含测试正文；每例未建立独立初态/清理旧运行 |
| 取消继续 132～144 | 点击取消后立即等待“继续” | 实际 `ChapterRefinementPanel.vue:110` 先打开确认弹窗，测试没有确认取消；脚本也没有在“已接受一段、下一段在途”停靠 |
| 重开与幂等 151～175 | 查找“重新开始 / 再次精修”；仅查历史 calls 中任意 inspect | 实际开始按钮一直是“开始智能精修”；未记录/比较 clientRequestId，未制造创建响应丢失与同 key 重试，也未证明新 run |
| 检查/E1/存储故障 177～191 | 只让 review 上游失败 | 没有 E1 注入、没有 checkpoint 保存故障，题名中的两条路径未覆盖 |
| 原文冲突 194～201 | PATCH `/api/projects/:id/chapters/1`，无 Authorization | 实际章节保存是带 JWT 的 POST `:id/knowledge/chapters`（controller 1264）；浏览器 token 在 localStorage，不会自动进入独立 request fixture；且导航离开后未重开面板，未检查持久化新原文 |
| apply 一致性 203～233 | 查询 `.chapter-editor, .chapter-content` 包含标记 | 实际正文展示是 `ChapterList.vue:552` 的 textarea / `.content-text`；未比较 API 返回正文与持久化正文完整相等/候选 hash，未验证摘要策略，未覆盖 ready_with_issues |
| 旧入口 236～249 | 只检查三类按钮可见 | 没有实际方案改写、直接改写、循环、按场成稿执行或未保存改动保护动作 |

此外，B4 操作文档宣称假编排器默认端口 8787，实际 `fake-orchestrator.mjs:28` 默认 4409，需统一。静态发现 14 条不等于 14 条有效闭环。

修复要求：提供可重复建立专用账号/项目/中性章节的隔离启动与清理方法，再按上述合同/实际 UI 修正操作与断言。使用明确阶段屏障控制已接受稿、在途调用和取消确认；收集 runId/attemptId/clientRequestId/源候选 hash、完整内容一致性与故障注入证据。实际执行后再签收，不将 skip 或 `--list` 算通过。

## B3 已通过分支的覆盖边界（W1）

本轮已用本机 PG 临时 schema 独立执行，**无需再以“不是正式验收数据库”为由否定已通过的六例**。确实重建了 repository/service/engine，并覆盖四个停靠点、源版本冲突和 E1 恢复阻断。

不过当前 createLifecycle 的 `checkAccess` 固定返回 editor，材料快照也固定不变；只在诊断重建例中核对了 templateVersions。计划里的“重建后权限撤销拒绝继续”“模型/参考材料仍用冻结版本”尚没有在 PG 重建链中被完整联合断言。现有非 PG service 权限测试通过，但不能替代该联合证据。建议在现有重建用例补断言，保留已通过证据，无需新增一套恢复架构。

## 后续顺序与复验标准

1. 修 R2 同句尾部证据扫描；原 W6 与同句变体均不得传播失效状态。
2. 补 B4 隔离夹具、实际操作与行为断言并运行，同时补 B3 通用断言。
3. 修 R1 的真实阶段隔离，并捕获全五阶段最终模型消息；重新跑工程门禁。
4. 工程检查点 A / B 通过后再做 AQ-386 真实模型样章评测。工程通过仍不能保证文学质量。

没有新增产品需求；以上均回到已批准 B1～B5 收口计划的既有行为与证据要求。

独立复现源：`evidence/batch-acceptance-probes-2026-10-07.ts`。观察：`evidence/batch-acceptance-observations-2026-10-07.json`。探针 exit 0 表示当前两个缺陷成功复现；修复后应将缺陷观察断言改为正确行为回归。
