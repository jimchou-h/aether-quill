# 章节精修编排工程验收（2026-10-07）

## 结论与范围

**结论：工程验收未通过。** AQ-380～AQ-385 有可运行实现，基础静态门禁及大部分现有自动化测试通过，但存在六组违反 MUST 合同的功能缺口。这些问题可用确定性网关复现或由实际调用链确认，无需真实模型。

本次检查 `add-chapter-refinement-orchestration` 的本地工作树，基准 HEAD 为 `c848ce040ebc3b075ae9f5b9d6f04af8d784bb83`。工作树还包含其他未提交改动，不能将所有全仓回归结果归因于本 change。未修改产品代码、任务 checkbox、发布状态或生产默认配置，未归档 change。

验收依据：`specs/chapter-refinement-orchestration/spec.md`、`design.md`、`tasks.md`、`api-contract.md`、`plan-contract-recovery.md`，以及仓库质量基线。AQ-386 的真实模型长章稳定性、文学质量盲评、GS-G/GS-C 及正式发布不在本次范围，仍为待验收。

## 执行证据

| 检查 | 结果 | 说明 |
|---|---|---|
| `openspec validate add-chapter-refinement-orchestration --strict` | PASS | 规格结构合法，不代表实现满足规格 |
| OpenSpec 实施任务 | 6/7 勾选 | 第 7.1 项未完成；前六项的完成声明需要以下修复与补测支持 |
| `pnpm -r lint` | PASS | 全 workspace |
| `pnpm -r typecheck` | PASS | 全 workspace |
| `pnpm -r build` | PASS | 全 workspace；前端有构建体积提示 |
| 原始 `pnpm -r test` | FAIL（测试入口） | 当前 Windows/Node 环境未展开 `src/**/*.test.ts`，收到字面量路径 |
| API 显式枚举测试文件 | 540 PASS / 0 FAIL / 1 SKIP | 跳过的是未设置专用 URL 的真实 PG 测试 |
| Web 显式枚举测试文件 | 180 PASS / 0 FAIL | 未包含浏览器作者路径 E2E |
| Orchestrator 显式枚举测试文件 | 173 PASS / 0 FAIL | 普通运行不退出；使用 `--test-force-exit` 才收口，不能据此证明句柄清理正确 |
| Config / model-providers / worker | 47 / 10 / 8 PASS | 模型供应商测试使用假响应，不调用真实模型 |
| 现有显式枚举测试合计 | 958 PASS / 1 SKIP | 不包含后续单独执行的 PG 诊断，不把复跑重复累计 |
| 实际本地 PG 临时 schema 契约 | 原测试 FAIL | 首次及三次复跑均在幂等错误的 `instanceof` 断言失败；详情见 W1 |
| 隔离工程探针 | 六个观察结果均复现 | 探针断言的是当前缺陷表现，exit 0 不表示功能验收通过 |
| GS-R 离线结构评测 | PASS | 34 条（32 计分 / 2 跳过），Recall@10/30、MRR@10 均 1.0；不是生成质量证明 |
| 浏览器作者路径 E2E | 未执行 | 现有脚本依赖登录凭据与可用后端，启动会进入真实生成；应补假网关的浏览器路径 |

Windows 下等价的测试文件枚举方式（分别在对应包目录执行）：

```powershell
$suiteFiles = @(rg --files src -g '*.test.ts')
node --import tsx --test $suiteFiles
# orchestrator 本次收口方式：node --import tsx --test --test-force-exit $suiteFiles
```

原始日志保存在工作区 `.scratch/refinement-acceptance/`：`lint.log`、`typecheck.log`、`build.log`、`test.log`、各包 `*-test.log`、`pg-test.log`、`pg-recheck-*.log`、`pg-in-place-detail.log`、`probes.log`、`gs-r.log`。这些本机日志不能代替提交到 CI 的正式证据。

可随 change 交接的中性复现与观察结果位于 `evidence/engineering-probes.ts`、`evidence/engineering-probes-2026-10-07.json`；核心源文件 SHA-256 记录于 `evidence/source-manifest-2026-10-07.json`。复现命令（从 API 包目录执行）：

```powershell
node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/engineering-probes.ts
```

探针使用两段虚构的开门、放钥匙文本，调用真实 engine/service 和 Map repository，网关返回固定 JSON；不读取作者章节、不请求模型、不写章节正文。

## 阻断项：必须修复后复验

### F1 · P1 / CRITICAL：中途没有持久化 checkpoint，取消丢掉已接受稿

来源：`services/api/src/modules/projects/chapter-refinement.service.ts:667–728`、`:795–813`；`chapter-refinement.engine.ts` 的运行输入及局部 checkpoint 构造。对应 R8/R9/R10、AQ-384，也影响 AQ-382 的中间进度。

实际 service 的 `onStage` 只发 SSE，不保存阶段/单位成果；只有整个 `engine.run()` 返回后才写入其 checkpoint。`cancelRun` 先使存储记录暂停并清空 attemptId，随后真实 engine 返回的部分成果因 attemptId 不匹配被丢弃。

复现：第一单位 rewrite/review 已完成，阻塞第二单位调用；此时仓库仍为初始原文、`changes=0`、`phase=reading`。明确 cancel 后仍为原文、零变更、无 resumeState。PG 即使能保存记录，服务重启也只能恢复最近实际落库的初始状态。

影响：关闭后重开看不到真实已接受成果；取消或进程重启损失前面的工作；继续可能重新诊断、重新改写，并丢失尚未持久化的恢复次数和用量。

修复要求：为 engine 增加可等待的 checkpoint 提交接口，至少覆盖诊断完成、plan 冻结、单位接受、修复名额占用和暂停。service 以 attemptId/revision 执行 CAS；明确取消需保存最后有效 checkpoint，同时拒绝取消后新产生的候选。不能仅去掉迟到回调隔离。

补测：真实 service + 真实 engine + 可控网关，在第二单位阻塞时断言第一单位已落库；cancel/resume 不重做第一单位；真实临时 PG 在该 checkpoint 后重建 service，恢复前一单位且等待人工继续。不能只用返回固定 checkpoint 的假 engine 验证恢复。

### F2 · P1 / CRITICAL：plan 恢复可以把已知 Fact 改 null，且回填覆盖已有错误字段

来源：`services/api/src/modules/projects/chapter-refinement.util.ts:119`、`:285–305`、`:734–759`、`:866–887`、`:1053–1061`。对应 R4/R8、AQ-383、`plan-contract-recovery.md` 第 3～5 节。

初始和恢复提示均要求不能复制引文时改 `value=null`；解析接受 null 或缺失 value，验证随后跳过它。没有冻结必要事实集合并验证重试前后保留关系。

复现 A：inspect 给出有证据的钥匙事实；初次 plan 对该 protectedFact 引用错误来源，第二次改成 null；引擎继续 rewrite 并得到 `ready`。这正是合同禁止的“降为 unknown 放行”。

复现 B：仅缺 sourceBlockId，但 anchorQuote 已提供且错误；回填同时覆盖两个字段，错误引文被换成索引引文，最终 `violations=0`。这是覆盖已有错误字段，不是新增合同允许的“逐字引文唯一重锚”。当前索引匹配只比较 key/value，也没有在匹配处限制已验证场景作用范围。

修复要求：冻结并保留已验证必要事实/锁的身份及范围；重试不得把已知必要事实变为 unknown 或删除。unknown 只表示源材料确实未知。确定性回填只补缺字段，已有非法值须进入唯一一次重试或暂停；引文唯一重锚遵守其单独的逐字唯一、范围和审计要求。同步修正提示与校验，不能只改提示措辞。

补测：已知必要 Fact→null、整项删除、遗漏 value、缺来源但已有错误引文、跨场同 key/value、多个来源；均不能通过静默覆盖或丢事实进入写作。

### F3 · P1 / CRITICAL：必要 review 未完成仍接受；最终回退后的接缝没有重检

来源：`chapter-refinement.engine.ts:975–1010`、`:1123–1163`、`:1405–1488`。对应 R7/R11、AQ-383。

单位 review 无法解析两次后被转成普通警告，候选继续接受；单位 repair 后复检失败也显式接受补修稿并设置已解决。虽然随后存在最终检查调用，但其输入只有整章意图、全章 protectedFacts 与范围对照，没有覆盖缺失检查的完整 SceneBrief/首尾状态/checks，不能证明等价补齐必要检查。

复现：首单位 review 连续非法 JSON，后续 review 与最终检查返回合法空问题列表；终态为可确认应用的 `ready_with_issues`，同时保留“检查未完成”警告。完成检查与完成后仍有非阻断提示是两种状态，不应混用。

最终定位修复失败会回退范围；多范围修复/回退在循环后才重建完整候选，没有对重建后的实际相邻接缝再检查。逐项复检用的是重建前上下文，相邻范围都改变时尤其不可靠。

修复要求：保存逐场/接缝检查完成清单；必要检查失败应暂停，或在预算内执行具有全部目标和证据的等价完整补检。最终修复/回退后按最终候选重新覆盖受影响接缝，仍失败则暂停；不再增加无限修复轮次。`ready_with_issues` 仅用于检查已完成且无阻断冲突的稿件。

补测：review/repair-review 连续违约必须不可应用；相邻两个单位同时修复；修复失败回退原文后与扩写前文冲突；检查预算不足。断言检查针对最终实际候选，而非旧邻文。

### F4 · P1 / CRITICAL：冻结模型路由只是存下来，参考材料也未实际冻结

来源：`chapter-refinement.types.ts:192–208`、`chapter-refinement.engine.ts:405–415`、`chapter-refinement.gateway.ts:20–33,59–77`、`services/rag-orchestrator/src/main.ts:1027–1041,1197–1208`。对应 R1/R12、AQ-381/AQ-384。

snapshot 记录 writing/utility modelRoutes，但 gateway 请求接口及实际发送字段没有模型路由。orchestrator 仍从当前 projectCtx 解析路由。snapshot 没有实际知识/人物/文风样本快照；网关未传冻结证据，orchestrator 继续根据当前项目检索并注入文风样本。

探针确认：虽然 snapshot 指定了固定 provider/model/temperature，所有 engine 请求均未携带这些值。代码调用链同时说明参考材料仍由运行时项目状态提供。任务记录“运行时不再读全局默认”仅对已覆盖的 Prompt 文本成立。

影响：运行中或 resume 前编辑模型设置、人物资料、参考材料，后续单位就可能使用不同材料；不能保证同一冻结 run 的一致性和复现。

修复要求：经 Contract First 建立冻结材料和模型路由传递合同，覆盖 gateway → orchestrator 实际模型调用及样本选择。只冻结标识/文本，不冻结或记录密钥；路由不可用应明确暂停，不能悄悄切回当前设置。

补测：创建后修改路由、角色卡、样本和知识文档，捕获实际 provider 请求与完整上下文，断言首次和续跑均使用冻结值。只检查 snapshot 中有字段不够。

### F5 · P1 / CRITICAL：散场事实输出被丢弃，缺少有证据的状态传递

来源：`chapter-refinement.util.ts:1000`、`:1092–1116`；`chapter-refinement.engine.ts` 的 review 消费点。对应 R6、AQ-381/AQ-382。

review 解析出 `exitStateFacts`，引擎只读取 issues，没有验证、保存或传递这些状态。常规单位 review 输入也没有真实已接受前文，只带当前原文、候选和未来只读文本。rewrite 收到已接受正文这一点已实现，但不能替代设计要求的状态证据链。

影响：review 凭空报出物件无法触发状态校验；跨单位共享的实际散场事实没有可恢复的证据，无法完整满足同一长场连续动作与状态管理合同。

修复要求：对输出状态引用在当前候选/允许原文范围中逐字验证，区分未知、冲突及确定状态；写入 checkpoint，后续单位使用有证据的当前状态，并给 review 真实已接受前文。若决定移除此层，应先修订规格及设计并说明替代机制，不能继续宣称已完成 R6。

补测：凭空声称持有钥匙的状态不得被接受；合法状态可落库、续跑保留并进入下一单位上下文；前文扩写后 review 读取新的真实前文。

### F6 · P1 / CRITICAL：重试可越过调用上限，完整上下文与活动时间保护不足

来源：`chapter-refinement.engine.ts:386–435`、`:1284–1298`、`callParse`；`chapter-refinement.util.ts` 的 `resolveRefinementRewriteMaxTokens`。对应 R5/R8、AQ-383。

预算在外围阶段检查，真正的 `callModel` 没有调用上限/时间检查。网络及解析重试再次直接进入 callModel。

复现：`maxCallsPerAttempt=1`，首个 inspect 返回非法 JSON，实际调用两次，之后才暂停。累计调用数有加一，仍不能阻止越预算；预留最终检查也会被这种重试消耗。

活动时间只在阶段检查；没有按本次剩余活动时间中止正在执行的调用。写作输出预算是字数乘系数，没有联动完整系统提示、原文、邻文、事实、实际参考材料及供应商上下文/输出限额。最终检查将全部已接受范围原文与候选一次性拼进同一个 Prompt，没有预算不足时的分组覆盖机制。

修复要求：统一每一次实际调用前的原子预算准入，所有重试共用；为当前调用设置剩余活动时间截止。按完整输入加预期输出做保守预算，未知供应商限额明确处理。最终检查可分组，但必须保留覆盖完成记录。不能删用户要求、必要事实或目标原文凑预算。

补测：上限 1 时至多一次实际调用；网络/解析/合同重试叠加仍不越限；最终检查预留不可被写作重试占用；可控时钟下单个长调用到时中止；长 Prompt 的系统指导/样本/邻文均计入，最终分组检查覆盖所有相关场景和接缝。

## 其他需要修复或补证的项目

### W1 · P2 / WARNING：真实 PG 原测试稳定失败，原因是类身份判断

来源：`chapter-refinement-run.repository.test.ts:70,168–199`。原测试初次及三次复跑都失败。相同目录的临时诊断副本打印：PG 返回 `name=RefinementRunConflictError`、`kind=idempotency_key`，但 `error instanceof RefinementRunConflictError=false`；内存分支为 true。

该测试对 repo 类使用静态 import，对 PG 实现使用动态 import。在本机 tsx/Node 模块加载环境下出现类身份不一致。另一个统一解析方式的隔离副本完成了全部 Map/PG 契约，两项通过。**因此不能据此断言 PG 幂等分类或迁移实现错误，也不能将原始测试标为通过。**

统一测试加载路径/模块方式后，必须用正式测试再跑真实临时 PG。还要补 F1 所要求的真实 engine checkpoint 重启测试；仓库 round-trip 通过不等于中途恢复通过。本次 PG 只创建和清理随机临时 schema，没有对业务 schema 执行迁移或清空。

### W2 · P2 / WARNING：同面板再次启动复用旧 clientRequestId

来源：`apps/web/src/composables/useChapterRefinementRun.ts:54,73,82–98,228–245`；`ChapterRefinementPanel.vue` 未调用 reset。

ready 后可再次点击启动，但 clientRequestId 只在构造/reset 时刷新。修改要求再启动会带同一个幂等键产生冲突；相同要求可能返回旧 run，使用户以为已重新运行。

每个新的逻辑运行分配新 key；同一次创建请求的重试保留 key。补真实 composable + 假 API/浏览器连续创建测试，不只测独立的 ID 工具函数。

### W3 · P2 / WARNING：模板材料可以读取未发布草稿

来源：`chapter-refinement.materials.ts:58`。优先级为 publishedText → draftText → defaultText，与 R1 的已发布模板冻结合同不符。若发布态为空且草稿存在，未发布编辑会直接进入 run。

应按发布规则选择已发布文本或明确的发布默认版本；如需草稿试跑，应显式区分并纳入合同/版本记录。补“有草稿、无发布文本”的运行材料测试。

### W4 · P2 / WARNING：创建接口的 HTTP 成功状态未对齐

来源：`chapter-refinement.controller.ts:42–55` 及 `openapi/paths/projects/chapter-refinement-runs.yaml`。创建方法没有 `@HttpCode(202)`；Nest POST 默认成功状态为 201，合同约定 202。resume 方法已显式设置 202。

补 HTTP 层合同测试并对齐实际响应；纯 service 返回值测试不能覆盖控制器状态。

### W5 · WARNING：执行门禁及浏览器证据不足

原始全仓 test 命令的 Windows glob 问题和 orchestrator 不退出问题需修复或在 CI 中有正式、可重复的等价入口。现有 browser E2E 不能在本次“不使用真实模型”的范围内直接执行完整作者路径；应注入可控网关执行关闭重开、取消继续、重复启动、警告确认、应用版本冲突和编辑器刷新。

这属于工程验收缺口，不应统一留给 AQ-386 的文学质量评测。

## 需求覆盖判定

| 需求 | 本次结论 | 主要证据/缺口 |
|---|---|---|
| R1 独立冻结运行 | 部分满足 | 独立存储/权限已有；F4 实际路由及材料未冻结，W3 草稿选择 |
| R2 授权边界 | 部分满足 | 策略及范围约束已有；F2 必要事实可丢失，不能证明硬锁完整 |
| R3 精确诊断窗口 | 已有测试通过 | 换行、代理对及偏移工具测试覆盖；无需真实模型 |
| R4 整章先读后写 | 部分满足 | 顺序诊断/整章规划已有；F2 证据恢复违反合同 |
| R5 场景与预算边界 | 部分满足 | 场景/拍边界及原文偏移已有；F6 完整上下文预算缺失 |
| R6 替换及状态传递 | 部分满足 | 多长度 fixture、偏移替换与已接受前文已有；F5 状态未验证传递 |
| R7 有限补修 | 未通过 | F3 未完成复检接受及回退接缝重检不足 |
| R8 预算及恢复计数 | 未通过 | F2/F6、F1 中途计数未落库 |
| R9 观察与取消分离 | 部分满足 | 观察/调用取消和迟到隔离已有；F1 丢已接受成果，W2 再启动 |
| R10 持久化/重启 | 未通过 | repository/TTL/重启转 paused 有实现；F1 没有实际阶段/单位 checkpoint，W1 正式 PG 测试失败 |
| R11 完整检查后应用 | 未通过 | 旧 apply 复用及版本锁测试已有；F3 不满足完整验证前提，浏览器闭环待补证 |
| R12 分类与发布 | 待验收 | 分类注册测试通过、入口仍受控；冻结样本/发布文本有缺口，真实质量与发布属 AQ-386 |

## 建议复验顺序与交付要求

1. AQ-383/AQ-384：先补 F1/F2/F3/F6 的确定性反例测试，再修 checkpoint、Fact 恢复、完整检查和预算。不得通过放宽断言、吞错误或把暂停全部变 warning 使测试通过。
2. AQ-381/AQ-382/AQ-384：完成 F4/F5 的实际网关合同、冻结材料、状态证据链和续跑上下文，补捕获实际请求的集成测试。
3. AQ-380/AQ-385：修 W1～W4，完成使用假网关的 HTTP 与浏览器作者路径；正式 PG 测试应全过，并覆盖已经接受单位后的真实恢复。
4. 再运行 lint/typecheck/test/build、确定性长章及旧链路回归，记录标准命令或已明确的等价入口。六组阻断项均关闭且证据完整，才能宣布“除真实模型外工程验收通过”。
5. 随后执行 AQ-386。工程通过只能证明流程和保护可靠，不能保证文学质量；真实长章、重复稳定性及盲评仍决定能否发布。

本报告不替开发者修改完成记录。交付时应在同一 change 回填每个 F/W 的修复文件、正式测试和结果，历史看板只同步准确状态及链接。
