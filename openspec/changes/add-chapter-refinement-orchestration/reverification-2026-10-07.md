# 章节精修编排修复复验（2026-10-07）

## 结论

**本轮仍未通过工程验收。** 已确认多项主要反例修复有效，但 F1～F6 各自仍有原合同要求未闭合的分支；W1～W4 的核心问题关闭，W5 未关闭。不能将“新增测试通过”直接等同于原报告全部缺口关闭。

本次对照 `remediation-2026-10-07.md`、原验收报告和现行规格复验本地工作树。没有修改产品代码或任务勾选，没有调用真实模型或发布/归档。AQ-386 仍排除在本轮范围外。

## 独立运行结果

| 检查 | 本轮结果 |
|---|---|
| `openspec validate add-chapter-refinement-orchestration --strict` | PASS |
| `pnpm -r lint` | PASS |
| `pnpm -r typecheck` | PASS |
| `pnpm -r build` | PASS；包括实际 `nest build && prisma generate`，未遇到回填所述删除保护阻塞 |
| `pnpm -r test` 正式入口 | FAIL；本机 Node v20.19.0 / Windows 下引号 glob 仍作为字面量路径传入 |
| API 显式枚举文件 | 563 PASS / 0 FAIL / 1 SKIP；564 个测试，默认跳过专用 URL 未设置的 PG 测试 |
| Web 显式枚举文件 | 187 PASS / 0 FAIL |
| Orchestrator 显式枚举文件 + force-exit | 173 PASS / 0 FAIL；不等于句柄问题修复 |
| Config / model-providers / worker | 47 / 10 / 8 PASS |
| 上述现有测试合计 | 988 PASS / 1 SKIP；不重复累计单独的 PG 复跑 |
| 正式 repository 测试 + 真实本地临时 PG | 2 PASS / 0 FAIL / 0 SKIP；Map/PG 两分支，W1 关闭 |
| GS-R offline-structured | PASS；32 计分 / 2 跳过，Recall@10/30、MRR@10 均 1.0 |
| 无真实模型的浏览器完整作者路径 | 未执行；现有脚本仍需凭据、后端且会启动真实生成，W5 未关闭 |

本机日志：`.scratch/refinement-reverification/` 的 `lint.log`、`typecheck.log`、`build.log`、`test-entry.log`、`api-test.log`、`web-test.log`、`rag-test.log`、三个其他包的 `*-test.log`、`pg-test.log`、`gs-r.log`、`probes.log`。

真实 PG 检查复用隔离封装，仅对随机临时 schema 执行迁移、断言和清理，没有操作业务 schema。此次 PG 原测试确实通过；不再沿用上一轮的失败结论。

## 修复项逐项判定

| 项 | 已确认有效的修复 | 尚未关闭 |
|---|---|---|
| F1 | 接受单位后 checkpoint 落库；取消保留已接受稿；迟到提交隔离 | 调用、恢复和补修名额在发起前未落库；取消/重启可重置这些消耗；诊断成果也未提交 |
| F2 | 已知 Fact→null/遗漏会违规；已有错误引文不被覆盖 | 回填仍没有场景作用域过滤，跨场证据可被接受 |
| F3 | 单位 review / repair-review 未完成会暂停；最终检查可分组 | 最终修复/回退后没有针对最终实际候选重检；未完成最终 repair-review 也可回退后放行 |
| F4 | 路由随 engine→gateway→orchestrator 下发并被使用 | 人物/知识/文风样本等实际参考材料仍未冻结 |
| F5 | 有据事实进入 checkpoint 和后续提示；review 有已接受前文 | 历史原文状态可被当成当前散场状态；被记为阻断的状态冲突仍进入可应用终态 |
| F6 | 重试实际调用数不越总上限；在途调用新增活动时间截止；最终分组 | 只有部分调用做输入预算；供应商限额硬编码；运行时注入材料未计入；预期输出可能被静默压低 |
| W1 | 正式真实 PG 契约通过 | 已关闭本项；不代表真实 PG 中途引擎恢复测试已齐备 |
| W2 | 真实 composable 测试通过；新运行轮换 key、失败创建重试复用 | 核心问题关闭；浏览器路径仍属 W5 |
| W3 | 材料改用 publishedText 或 defaultText，相应测试通过 | 核心问题关闭 |
| W4 | 创建方法显式 `@HttpCode(202)`，元数据及处理器测试通过 | 核心问题关闭；新增测试是元数据/直接调用测试，不是回填声称的实际 HTTP 请求测试 |
| W5 | 有显式枚举等价测试证据 | 标准入口不兼容支持的 Node 20 / Windows；force-exit 只收口；假网关浏览器闭环未补 |

## 尚需修复的行为与证据

### F1 · P1：已接受稿能保住，但已消耗名额与用量仍会丢失

位置：`services/api/src/modules/projects/chapter-refinement.engine.ts:404–416,494–496,857–863,1200–1221,1611–1623`；`chapter-refinement.service.ts:691–704`。

`commitCheckpoint` 只在计划冻结及单位完成后执行；额外 plan、单位 repair、最终 seam repair 名额先在局部变量加一，然后直接调用网关，没有在调用前提交。每次实际调用的 usage 也只有下次单位完成才落库。

真实 service + 真实 engine 探针：第一单位已接受，第二单位开始 repair 时取消。已接受变更保留为 1，说明本次成果保存修复有效；但实际已调用 7 次，仓库只记录 4 次，repair 已开始 1 次，持久化 `repairCount=0`。继续或进程重启仍有机会重新取得该单位的补修名额，违反 R8 的次数不可重置要求。

诊断阶段的 inspections 仍为局部数组，没有阶段提交；plan 额外调用期间取消也会失去恢复名额与诊断成果。`commitCheckpoint` 的 catch 吞掉存储异常，服务层也不检查 CAS 返回值，未能确认持久化成功时仍继续执行。

修复/补测：发起每个有消耗的调用前，原子保留并持久化调用/恢复/补修名额；诊断阶段记录已验证结果和当前位置。存储失败应明确停止或重试，不能继续声称可恢复。补真实 service+engine 的“repair 在途 cancel/resume”和真实临时 PG 重建 service 测试，断言名额、历史用量、诊断均不重置。

### F2 · P1：缺字段回填仍能从另一个场景复制证据

位置：`chapter-refinement.util.ts:825–897`，尤其 `:852` 的全局 key/value 匹配。

复现：s1 的有证据 Fact 位于 b0；s2 允许的 sourceBlockIds 只有 b1，却声明同 key/value 的 Fact 且遗漏来源字段。程序从 s1 的全局唯一索引回填 b0，最终 `violations=0`。这一点在原报告 F2 中已明确要求作用范围过滤，`plan-contract-recovery.md` 也限定场景内事实的证据范围。

修复/补测：回填和最终校验均使用已验证的事实身份及允许读取范围。局部场景的证据候选先按其 sourceBlockIds/合同范围过滤，再判断唯一性；全章保护事实单独处理。增加当前反例、跨场同值多来源，以及合法跨范围只读依赖的显式合同测试，不能仅用 key/value 相同推导作用范围相同。

### F3 · P1：最终回退后的检查覆盖仍属于旧稿

位置：`chapter-refinement.engine.ts:1548,1587–1718,1721–1740`。

最终检查后先置 `finalCheckCompleted=true`。后续 repair 失败、repair-review 失败或预算不足均可执行 revertRange；循环最后重新拼接候选，但没有清除旧检查完成标记，也没有对回退后的真实接缝重新检查。相邻修复的检查上下文仍由重建前的 acceptedDraft 生成。

探针：两个单位正常 review 完成，第三次 review（最终检查）报出可定位阻断缺口，repair 连续失败。范围回退后仍为 `ready_with_issues`；review 总调用数 3，**回退后检查调用数 0**。这违反 R7“回退原文并重检接缝”和 R11“完成最终检查才能应用”。

修复/补测：检查完成记录绑定 candidate revision/hash；最终候选任何修复或回退后使受影响检查失效。按最终实际拼接结果重检相邻接缝，失败或预算不足则暂停；不新增第二轮创作。测试相邻两个范围同时修复、最终 repair-review 失败、回退与扩写前文冲突。

### F4 · P1：模型路由修复了，实际参考材料尚未冻结

位置：`chapter-refinement.types.ts:193–208`、`chapter-refinement.materials.ts`、`chapter-refinement.gateway.ts:65–91`；`services/rag-orchestrator/src/main.ts:1088–1101,1252–1270`。

snapshot 和 materials 仍只有 Prompt、路由等字段，没有实际注入的人物/知识/文风材料及来源。gateway 没有传冻结证据或冻结文风上下文；orchestrator 仍在每次调用中从当前 projectCtx 检索、选择样本。新 gateway 测试证明路由出现在请求体，不覆盖材料冻结。

这不是新要求：原 F4 和 design.md 的冻结面明确包含实际参考文本及来源。运行中修改角色卡/样本仍可能改变后续单位或续跑的指导。

修复/补测：构建 run 开始时的实际参考材料，保存文本及来源，通过新模板专用合同传到实际 prompt assembly；续跑复用。使用假 provider 捕获最终完整消息，创建后修改角色卡、知识文档、样本，断言消息仍为冻结版本；不止断言 API 网关 body 字段。

### F5 · P1/P2：有引文命中不等于当前散场状态成立

位置：`chapter-refinement.util.ts:1115–1138`、`chapter-refinement.engine.ts:1360–1389,1726–1734`；`chapter-refinement.engine.test.ts:1698–1754`。

当前函数允许 Fact 的 value/quote 仅在原文出现，就作为当前确定状态。探针：原文“甲拿着钥匙入场，散场时把钥匙留在桌上”，候选“甲把钥匙留在桌上，独自走出门”，却返回入场时“拿着钥匙”的散场 Fact；验证得到 `evidence/original`，可以进入后续单位提示。引用历史动作无法证明散场仍成立。

另一个新测试主动生成无法验证的 crowd 状态，代码记为 `continuity/unresolved`，测试却断言最终 `ready_with_issues`。回填将其称为阻断问题，但终态选择没有阻断 unresolved；R11 要求可应用稿不能留未解决阻断冲突。

修复/补测：状态证据绑定实际接受候选及散场位置。原文作为状态证据只能用于已确认保留的状态，不能覆盖候选已改变的过程。证据不足时保持 unknown 或明确处理冲突；若判为阻断，必须不可应用。若只是模型提取误报，应明确降为非阻断提示且不传播，而非记 unresolved 后放行。补“入场持有、散场放下”和前后相反状态测试。

### F6 · P1：完整输入预算仍未覆盖所有调用及实际模型限额

位置：`chapter-refinement.engine.ts:473–492,675–693,734–738,1211–1221,1502–1534,1623–1666`；`chapter-refinement.util.ts:50–97`。

输入预算仅在调用传 desiredOutputChars 时执行；inspect/plan/repair/最终 repair-review 仍有未传的路径。探针加入 20 万字符冻结项目指导，inspect 实际收到 **201114 字符**输入后才在后续阶段暂停，说明 oversized 输入已经送到网关，未在准入处拒绝。

“供应商保守常量”直接假定 128000 上下文、65536 输出，并未读取实际冻结模型的能力；对限额更小的可配置模型没有安全保证。预算也未包含 orchestrator 随后追加的人物/检索/样本材料。available 不足预期输出时函数仍返回 ok 并压低 maxTokens，可能制造后续截断；最终分组只计算范围原文+候选，未计算公共事实、系统提示及两侧邻文。

修复/补测：对所有实际调用计算最终完整消息 + 预期输出，使用显式模型能力/配置；未知限额按已约定的不可判断路径处理。输入或必要输出装不下应重新规划安全范围或暂停。预留最终检查也须在每个重试准入处落实。补 inspect/plan/repair 大输入、模型小限额、运行时附加材料、输出余量不足和最终公共上下文测试。总调用上限已经修好，无需重复改这部分。

### W5 · P2：正式测试入口与无模型浏览器闭环仍不成立

位置：根 `package.json` 的 `engines.node >=20.0.0`，各包 test script；`apps/web/e2e/chapter-refinement-author-path.spec.ts`。

本机正式 `pnpm -r test` 输出 `Could not find ...\'src\**\*.test.ts'`。不能以在另一个 Node 版本通过为理由宣布支持的 Node 20 / Windows 门禁已修。建议使用跨平台的测试入口脚本显式收集文件，或明确变更受支持运行时并同步工程约定。

现有完整作者路径仍没有假模型网关/假后端闭环，W5 回填自己标“部分修”。这不依赖真实模型，应在 AQ-385 内补齐关闭重开、取消继续、再次启动、检查失败不可应用、版本冲突与应用后正文刷新。force-exit 只能作为有记录的临时收口措施。

## 交接与复现

复现文件：`evidence/reverification-probes.ts`；观察结果：`evidence/reverification-observations-2026-10-07.json`；本轮核心源文件指纹：`evidence/reverification-source-manifest-2026-10-07.json`。

```powershell
# 在 services/api 下执行；固定中性数据、假网关，真实 engine/service
node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/reverification-probes.ts
```

脚本包含四个修复通过观察和五个剩余问题观察。剩余问题探针断言当前缺陷以提供复现；脚本 exit 0 不表示验收通过。正式修复测试应断言合同要求的正确行为。

下一轮优先补调用前 checkpoint、最终修复/回退重检和材料冻结，再完成事实作用域/散场验证与完整预算；W1～W4 不必重复开发。回填应区分“某个反例已修”和“整个 F 项已关闭”，随后重复确定性门禁及假模型浏览器路径，再进入 AQ-386。
