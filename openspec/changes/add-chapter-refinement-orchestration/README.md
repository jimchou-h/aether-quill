# 章节精修编排：设计与开发入口

设计日期：2026-10-06；更新：2026-10-07。状态：**开发进行中，尚未发布；真实成稿质量未验收**。tasks.md 已登记 AQ-380～AQ-385 完成（4.1 主体：严格流完成／预算／单位补修／整章最终接缝修复／警告暂停 UI；5.1：取消／继续／放弃、迟到回调隔离、PG 重启恢复、终态 TTL 清理与运行历史恢复 UI；6.1：入口整合与旧 mode 分离、未保存改动保护、运行关联信息、旧链路回归；已知遗留：token 实际用量采集与 E2E 待补）。

本 change 服务于已有章节的改写润色，重点覆盖 10000～20000 字长章。作者设置一次目标，系统分窗阅读、整章统筹、范围改写、有限补修，最后提供一份完整候选稿供确认应用。效果目标是人物表达、情绪推进、感官具体性与文笔质量；这些是需要评测的目标，不是模型能够保证的承诺。

开发执行者预计为 DeepSeek-v4-flash；这不代表本 change 更换产品运行时的模型或供应商。

2026-10-07 独立工程验收：**未通过**。基础 lint/typecheck/build 及显式枚举的 958 项测试通过，但 checkpoint、Fact 恢复、检查完成条件、冻结材料、状态传递和预算存在六组阻断缺口。详见 [工程验收报告与复现证据](verification-2026-10-07.md)。

2026-10-07 验收阻断项修复回填：六组阻断项（F1～F6）与五项告警（W1～W5）已按报告逐条修复并补确定性测试，详见 [修复回填](remediation-2026-10-07.md)。要点：引擎中途 checkpoint + 服务以 attemptId/revision CAS 落库；plan 恢复只补缺失字段、必要事实降级/漏项不可放行；单位必要检查未完成即暂停、整章检查分组并登记覆盖；冻结模型路由经网关→orchestrator 真正下发（缺失即暂停）；散场状态事实按证据核验并经 checkpoint 传递；每次真实调用前原子预算准入并按完整输入做保守预算。W1 真实临时 PG 契约测试两分支全过。W5 的 Windows glob 与 orchestrator 收口已修（引号 glob + `--test-force-exit`）；浏览器作者路径 E2E 仍待跑。AQ-386 真实模型评测仍待进行。

2026-10-07 修复后独立复验：**仍未通过**。已确认已接受稿落库、Fact 降级拒绝、单位检查失败暂停、路由下发及 W1～W4 修复有效；全仓 lint/typecheck/build 和显式枚举 988 项测试通过，真实临时 PG 契约通过。但 F1～F6 仍有未闭合分支，标准 test 入口及假网关浏览器路径也未完成。详见 [修复复验报告](reverification-2026-10-07.md)，不以回填的“已修”声明替代验收。

2026-10-07 剩余路径修复收口：针对复验列出的 F1～F6 未闭合分支与 W5 正式测试入口逐条修复——F1 每次消耗前原子持久化（含诊断逐窗落库、存储失败即停）；F2 回填/校验按场景 sourceBlockIds 过滤并新增 `fact_out_of_scope`；F3 修复/回退后按最终候选重检相邻接缝、仍阻断即暂停；F4 run 开始时冻结人物/知识/文风材料并经网关下发、orchestrator 用冻结块组装最终消息；F5 状态证据绑定候选、仅原文命中记 `historical` 非阻断提示；F6 `desiredOutputChars` 必填、按显式模型能力做完整输入预算、未知能力走不可判断路径；W5 新增跨平台测试入口脚本并移除 force-exit（`pnpm -r test` 在 Node v20.19.0 / Windows 通过）。确定性复现 `evidence/remediation-probes-2026-10-07.ts` 通过。详见 [剩余路径修复收口](remediation-closure-2026-10-07.md)。余项：假模型浏览器作者路径 E2E 与真实临时 PG 的 service 重建断言仍待补。

## 文档阅读顺序

2026-10-07 真实试用阻断修复：`deepseek/deepseek-v4-pro` 能力表漏项已补齐；新建/零调用暂停续跑回归通过，API 623 pass / 9 skip、lint/typecheck/Nest 编译通过。标准 build 的 Prisma 步骤受运行中服务 DLL 占用阻挡，详见 [V4 Pro 能力登记修复](v4-pro-capability-fix-2026-10-07.md)。真实模型质量及既定工程余项仍待验收。

2026-10-07 最新浏览器独立复验：**本轮具体修复通过；完整非模型签收仍待既定证据**。正式桌面/窄屏 14/14；补充严格应用探针 4/4（ready 与真实 ready_with_issues，UI 全文相等）；全仓门禁 1066 pass / 9 skip、临时 PG 10/10。仍待 checkpoint 保存故障集成、四条旧写作链路实际执行、Settings 五模板发布回滚实操。详见 [浏览器闭环最终独立复验](browser-final-verification-2026-10-07.md)，其中保留了正式第六例未真正进入 ready_with_issues 的覆盖反例及修正后的独立证据。

2026-10-07 最新 R1/R2 与 B4 复验：**R1/R2 原反例已关闭，B4 仍未签收**。全仓 1066 pass / 9 skip，独立 PG 10/10。浏览器余项还包括单范围假脚本、旧 run 清理合同与 apply 响应捕获错误，不能仅归为选择器/时序。详见 [浏览器闭环独立复验](browser-closure-reverification-2026-10-07.md)。

2026-10-07 B1～B5 最新独立验收：**仍未通过**。B1 原反例关闭，新增真实 PG 重建 6/6 通过；B2 同句后续变化仍被误登记并传播，B5 实际调用链仍在 utility 阶段注入项目长指导，B4 浏览器资产存在操作/合同/断言缺口且未安全执行。全仓门禁通过（1056 pass / 7 skip，另行 PG 8/8）。详见 [B1～B5 独立验收报告](batch-acceptance-2026-10-07.md)。

2026-10-07 剩余工作的执行规划见 [验收收口执行计划](acceptance-closure-plan-2026-10-07.md)：B1 应用门禁 → B2 散场证据 → B3 真实 PG 恢复 → B4 假模型浏览器闭环 → 工程检查点 A → B5 Prompt 设置与阶段隔离 → 工程检查点 B → AQ-386。当前只规划，未开发、发布或归档。

2026-10-07 第四轮修复独立验证：D1/D2/D3 原始反例均通过；全仓 lint/typecheck/build 通过，全量测试复跑 1028 PASS，冻结模型路由下的 1～2 万字测试通过。但 D3 的全章记录缺失 unitId 时会把另一场保留提示错误用于豁免全章未解决阻断，工程验收仍未完成；W6 和非模型浏览器/PG 服务重建验证仍待补。详见 [第四轮验证报告与证据](fourth-verification-2026-10-07.md)，保留了标准 test 首跑失败及复跑通过的完整记录。

2026-10-07 第三轮修复独立复验：**仍未通过**。上一轮最终稿覆写/回退复活、输出静默裁剪、未知模型放行、前端类型错误和当前章样本排除的具体反例已关闭；全仓 lint/typecheck/build 通过，1025 项测试通过，真实临时 PG 仓库测试通过。但默认 3500 字范围被 8192 输出上限拒绝后无改写即就绪、最终 repair-review 保存失败被吞成回退、阻断暂停后继续仍携带 unresolved 进入可应用终态。末态锚点和非模型浏览器/PG 服务重建验证仍有缺口。详见 [第三轮独立复验与证据](third-verification-2026-10-07.md)。

2026-10-07 收口修复独立验收：**仍未通过**。标准 test 入口已修，1009 项测试通过，真实临时 PG 仓库两分支通过；但最终修复/回退后的候选被 checkpoint 写回旧稿，必要输出仍静默裁剪，未知模型仍按 provider 猜测能力，全仓 typecheck/build 因缺少 `persistence_failed` 前端映射失败。样本选择、末态证据及非模型集成验证仍有缺口。详见 [收口修复独立验收报告与复现](closure-verification-2026-10-07.md)。未修改产品代码或任务状态；Prompt 设置入口与阶段隔离问题留待上述工程验收闭合后处理。

2026-10-07 第三轮修复收口（C1～C4 / W6）：**本轮列出的缺陷已修复并通过确定性复现**。C1 最终候选合并后 `commitCheckpoint` 不再重派生正文，终态正文 / resume / 变更清单 / 落库候选四者一致，回退后无法定位的阻断暂停 `boundary_conflict`；C2 必要输出须同时装进上下文余量与单次输出上限、超额明确拒绝，能力按 provider+model 双键解析、未知组合不可判断；C3 前端补齐 `persistence_failed` 映射，`vue-tsc` / `vite build` 通过；C4 冻结文风样本按当前章排除并与编排器适用性选择同源、写作阶段才注入；W6 散场状态须携带末态锚点（exitAnchorQuote）且 value 落在锚点内才判 `evidence`，否则 `historical` 不传播。确定性复现 `evidence/closure-remediation-probes-2026-10-07.ts` exit 0；门禁：`pnpm -r test` 1026 项 0 FAIL、lint/typecheck/build/openspec 全绿。详见 [第三轮修复收口](closure-remediation-2026-10-07.md)。遗留：假模型浏览器作者路径 E2E、真实临时 PG service 重建断言、AQ-386 真实模型评测。

2026-10-07 第四轮修复收口（D1～D3）：**本轮三项缺陷已修复并通过确定性复现**。D1 必要输出估算由 2.5 改为 1.5 token/字（3500 字 → 5250 < 8192），且改写/补修/接缝补修三路显式处理 contextExhausted 与 budgetExhausted、暂停而非静默保留原文；D2 最终接缝复检失败统一走 pauseFromOutcome，保存失败暂停 persistence_failed，不再回退后放行；D3 完成守卫：仍生效候选携带 unresolved 高/中阻断即暂停 boundary_conflict（已回退原文的单位除外）。确定性复现 evidence/final-acceptance-probes-2026-10-07.ts exit 0；门禁：pnpm -r test 1029 项 0 FAIL、lint/typecheck/openspec 全绿。详见 [第四轮修复收口](final-acceptance-remediation-2026-10-07.md)。遗留：假模型浏览器作者路径 E2E、真实临时 PG service 重建断言、AQ-386 真实模型评测。

1. [proposal.md](proposal.md)：范围与非目标。
2. [design.md](design.md)：决策、分段、状态、恢复与复用边界。
3. [specs/chapter-refinement-orchestration/spec.md](specs/chapter-refinement-orchestration/spec.md)：可验收行为。
4. [api-contract.md](api-contract.md)：待实现的 API、SSE、状态与错误语义。
5. [prompt-design.md](prompt-design.md)：写作指导的位置、阶段输出与模板治理。
6. [evaluation.md](evaluation.md)：确定性测试、模型评测与发布门禁。
7. [tasks.md](tasks.md)：唯一开发任务清单，按竖切顺序执行。
8. [handoff.md](handoff.md)：代码导航、开工与交付约定。

当前优先阅读：[AQ-382 后的前置样章验证](early-sample-validation.md)。保持原任务编号，在投入更多外围完善前获取真实候选稿和作者反馈；必要的流完整性与预算保护可先完成 AQ-383 对应部分。

AQ-383 补充：[plan 合同违规的有界恢复](plan-contract-recovery.md)。保留严格校验，增加有证据字段回填及共享重试上限，不通过删除必要事实放行。

2026-10-07 本次文档调整：`openspec validate add-chapter-refinement-orchestration --strict` 通过；本地链接／代码围栏检查无错误，仍为 7 个实现任务、3 个已登记完成项。未修改代码、运行生成或复验开发者测试结果。

2026-10-07（5.1）本次文档调整：AQ-384（5.1 取消／继续／服务重启恢复）登记 DONE，`openspec validate add-chapter-refinement-orchestration --strict` 通过；`openspec list` 显示 `5/7 tasks`。新增三条 run 控制类 OpenAPI path 与三个请求 schema，engine 增加可续跑 checkpoint 重放，service 增加 cancel/resume/discard/cleanup/恢复预检，前端补齐控制按钮与运行历史恢复。详见 tasks.md 的 5.1 完成记录。

2026-10-07（6.1）本次文档调整：AQ-385（6.1 工作台整合与旧链路回归）登记 DONE，`openspec validate add-chapter-refinement-orchestration --strict` 通过；`openspec list` 显示 `6/7 tasks`。在现有章节优化 UI 接入智能精修入口并保持与旧 mode 分离；新增未保存章节改动保护（先保存或返回编辑器）；新增运行关联字段（`creationTraceId` / `frozenTemplateVersions`）与运行关联信息展示；补齐旧链路回归与 SSE 多订阅一致性测试。正式发布入口与真实模型验收仍属 7.1。详见 tasks.md 的 6.1 完成记录。

## 作者使用流程

打开章节 → 文笔优化中的「智能精修」入口 → 输入本章要求 → 点击开始 → 查看进度（可以关掉弹窗再回来）→ 原文与完整候选稿对比 → 确认应用。

默认「保留剧情」：允许改表达、节奏、对话组织和场内铺陈，保留必要事件、人物关系落点与范围首尾状态。可选「场内创编」：允许同场内部加减、并拍和重排；不授权跨场重排或改变后续剧情。

方案和内部诊断默认折叠展示，不要求逐项确认。阶段有不可自动解决的冲突时，系统保存进度并说明具体落点。最终应用仍由作者确认。

## 最关键的设计决策

- 一份整章改写意图贯穿全过程；不让每个窗重新发明目标。
- 诊断窗与改写范围分别规划；按场景优先、按长度和调用预算兜底。
- 所有范围由冻结原文的 UTF-16 偏移定位；只读邻接内容不参与替换。
- 模型只生成候选稿，程序负责拼接、保护原文锁与拒绝不完整输出。
- 初次改写后最多一次针对具体缺口的补修；不做固定多轮整章重写。
- 文笔评价是参考，不能把一个模型分数包装成文学质量保证。
- 新入口独立编排，旧方案改写、直接改写、自动循环、按场成稿保持现有行为。

## 文档校验状态

2026-10-06 设计阶段：本地 `openspec` CLI 与 `node_modules/.bin/openspec.cmd` 均不可用，按 unified-dev-workflow 的降级约定使用人工结构检查，`validate` 当时为 skipped。

2026-10-06 接管复验（开发开工）：`openspec` CLI（`C:\nvm4w\nodejs\openspec.ps1`）可用，`openspec validate add-chapter-refinement-orchestration --strict` **通过**；`openspec list` 显示本 change 为 `0/7 tasks`。原「CLI 不可用」结论已过期，据此更正。

2026-10-06 文档检查：10 个必备文件齐全，12 条 Requirement、30 个 Scenario、7 个未开始任务；人工对齐了首尾事实、范围索引、严格流完成、恢复与到期、最终 apply 和发布门禁。截至设计阶段未执行代码测试、数据库迁移或真实模型评测。

## 任务编号与 issue

| 任务 | AQ 编号 | issue | 状态 |
|---|---|---|---|
| 1.1 可运行的保留原文基线 | AQ-380 | 见 GitHub issue | DONE |
| 2.1 单场精修与应用 | AQ-381 | 见 GitHub issue | DONE |
| 3.1 整章顺序编排 | AQ-382 | 见 GitHub issue | DONE（tasks.md 登记） |
| 4.1 有限补修、严格流完成与预算 | AQ-383 | 见 GitHub issue | DONE（tasks.md 登记） |
| 5.1 取消、继续与服务重启恢复 | AQ-384 | 见 GitHub issue | DONE（tasks.md 登记） |
| 6.1 工作台整合与旧链路回归 | AQ-385 | 见 GitHub issue | DONE（tasks.md 登记） |
| 7.1 真实模型验收与受控发布 | AQ-386 | 见 GitHub issue | TODO |

进行中规格仍以此目录为 SSOT；旧看板只维护编号／状态与本 change 链接，不复制一套需求。分支：`feat/aq-380-refinement-orchestration`。
