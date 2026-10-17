## 实施约定

2026-10-08 AQ-383 事实及成稿输入合同修复本地完成（含同名首尾 unknown 误判）：专项 150 pass，API 648 pass / 9 skip / 0 fail，lint/typecheck/Nest 编译/OpenSpec strict 通过；最新完整 build 的 Prisma DLL 替换 EPERM。尚未提交/推送，保持 DOING。继续任务 4.1；范围与验收见 [事实合同修复](fact-contract-fix-2026-10-08.md)。此前交付记录保留，本次修复不代表 AQ-386 真实模型发布门禁通过。

2026-10-07 AQ-383 / AQ-386 运行缺陷修复：`deepseek/deepseek-v4-pro` 的能力登记已补齐；util/engine 125/125、API 623 pass / 9 skip、lint/typecheck/Nest 编译通过。标准 build 的 Prisma 步骤仍受运行中服务 DLL 占用阻挡，待释放后重跑。详见 [V4 Pro 能力登记修复](v4-pro-capability-fix-2026-10-07.md)；不勾选 7.1，不改变真实模型验收和发布门禁。

本文件是唯一实现任务清单。进度以各任务 checkbox 与交付记录为准，不因文档齐全而勾选任务。正式执行先按 handoff.md 完成接管与任务绑定，再按下列依赖推进；每个任务交付可在隐藏入口验证的端到端增量。

2026-10-07 验证顺序补充：AQ-382 后按 [early-sample-validation.md](early-sample-validation.md) 获取真实短场与长章候选及作者反馈；必要的流完整性与预算保护先完成 AQ-383 对应部分。此为开发中的检查点，不新增 checkbox、不更改既有票号或完成记录、不替代任务 7.1 的正式评测发布。

Contract First 适用于每个任务新增的接口、SSE、类型与错误语义。文档中的合同草案不能替代 openapi/ 的实际合同。默认测试先行；确需例外时在本 change 记录理由及补测证据。

### 1. 可运行的保留原文基线

- [x] 1.1 打通创建、读取、观察 run 与只读候选对比；以确定性 keep-only 策略贯穿冻结、checkpoint、ready 生命周期。

依赖：无。覆盖 R1、R9、R10 的最小路径。

范围：OpenAPI / 共享类型 → 独立 run repository（PG 表迁移与 Map 实现）→ service / controller → 前端隐藏入口、创建及进度视图。初始后台引擎返回完整原文候选，不调用模型、不开放应用。为后续阶段预留 DI seam，禁止伪装成已完成智能精修。

验收：
- 原文、版本、要求、策略和材料快照属于独立 run；章节及索引没有副作用。
- 有 creator 权限校验、clientRequestId 幂等和同章单活动 run 保护。
- SSE 只是观察，关闭面板不结束运行；快照可恢复已接受内容。
- UI 显示存储模式，草稿入口默认不公开；当前候选完整且可对比。

测试：repository 的 PG 与内存行为一致性；授权／幂等 API 集成测试；前端关闭再打开恢复状态的组件或 E2E 测试。PG 模式至少跑一次真实临时数据库迁移与 round-trip，不能仅 mock Prisma。

### 2. 一个完整场景的精修与应用

- [x] 2.1 实现单场 inspect → plan → rewrite → review → 程序门禁 → 完整候选，并复用旧 apply 完成作者确认。

依赖：1.1。覆盖 R1、R2、R4、R6、R11、R12 的单场路径。

范围：五个新模板 key 的 Settings 草稿与分类注册；gateway 模型路由与冻结覆盖；有证据的 brief、必要事实及状态；正文独立输出；原文／新稿对比、确认应用、应用结果刷新。repair 模板此时可以仅注册，在任务 4 接入。补齐所有模板镜像与已有发布／回滚路径，不自动发布新模板。

验收：
- `preserve-plot` / `scene-rewrite` 权限准确，越界要求不生成越界正文。
- utility 阶段不带长写作指导；writing 阶段使用冻结指导；当前章节不能作为自身文风样本。
- 使用当前范围原文、真实前后文和原文事实检查候选；不接受凭空生成的状态。
- apply 使用 baseUpdatedAt、planId=runId、preserveSummary=true；返回正文刷新编辑器。
- 保持旧 apply 的权限、1307、摘要及章节副作用，不增加 applied 状态或另一套 apply。

测试：有必要事件／锁定句／未知物件的单场 fixture；写作与检查上下文 assembly 测试；分类表覆盖测试；应用版本冲突及安全处理返回正文的 API／前端集成测试。

### 3. 一万至两万字的整章顺序编排

- [x] 3.1 实现 SourceBlock 索引、精确诊断窗、跨窗场景合并、拍边界范围规划与按原文偏移合并，前端展示整章范围进度。

依赖：2.1。覆盖 R3～R6。

范围：纯 range planner 与 engine；读取全文后生成唯一 ChapterBrief；每场 keep/patch/rewrite 覆盖；长场执行单位共享意图和进度；已接受前文与未来只读原文；当前 source 范围与候选修订范围独立定位。

验收：
- 诊断窗不直接成为创编场景；旧设置零和正值的行为符合合同。
- CRLF、空行、单换行、超长段及 UTF-16 代理对均保留；未修改部分逐码元一致。
- 同一场跨窗可合并；短独立场不能为凑字数合并；不可信边界降级或保留原文。
- 前一单位长度变化不导致后续替换漂移；后续输入确实使用已接受前文。
- 所有源范围有覆盖决策；章尾问题可处理；最终验证按场与接缝覆盖全文。

测试：evaluation.md 的 E01～E06、E10；10000、15000、20000 字脚本模型 fixture 的整章端到端测试；UI 已处理、保留、未处理范围展示测试。此处使用 mock 模型不代表真实模型质量验收。

### 4. 有限补修、严格流完成与资源预算

2026-10-07 验收收口补充：执行 [收口计划 B1/B2](acceptance-closure-plan-2026-10-07.md)，补齐问题处置/应用资格与散场证据；既有完成勾选不代表这些验收缺口已关闭。

**B1 已完成**：E1 缺陷关闭，见 [b1-closure-2026-10-07.md](b1-closure-2026-10-07.md)。
**B2 已完成**：W6 关闭（散场状态证据可信边界），见 [b2-closure-2026-10-07.md](b2-closure-2026-10-07.md)。

- [x] 4.1 接入带证据的 repair、候选接受策略、finishReason 完整性、调用与时间预算、最终定位修复，以及警告／暂停 UI。

依赖：3.1。覆盖 R5、R7、R8、R11。

范围：provider → orchestrator → API gateway 的可选 completion metadata 与新调用严格策略；完整 prompt 输入／预期输出预算；单单位一次补修与最终一轮接缝修复；暂停 checkpoint；ready_with_issues 的最终确认。

验收：
- 非空内容不等于成功；length、过滤、未知完成原因和断流不会成为可应用候选。
- 所有调用含失败重试都计入预算；预留最终检查，不够时暂停而非宣布成功。
- 补修针对 candidateRevision/hash/锚点；重复定位和过期修订拒绝。
- 主观评分和新增风格愿望不触发循环；回退原文后重检相邻接缝。
- 实际与估算用量区别展示；未知模型限额不靠模型名猜测。
- 原文尾部未处理或最终检查未完成的 run 不开放应用。
- plan 合同违规按 [plan-contract-recovery.md](plan-contract-recovery.md) 执行证据回填、最多一次额外调用及保守降级；恢复计数持久化。全章必要 Fact 无法验证时仍暂停，不能删除或改 unknown 放行。

测试：E07～E09、E11～E13、E20；可控时钟／计数器预算测试；provider end、length、断流、旧调用无新增字段的兼容测试；前端警告确认与 paused 禁止应用测试。E20 对应 plan-contract-recovery.md 的缺字段、证据歧义、连续违约、预算和恢复测试。

### 5. 取消、继续与服务重启恢复

2026-10-07 验收收口补充：执行 [收口计划 B3](acceptance-closure-plan-2026-10-07.md)，实际运行临时 PG 的 service/engine 重建用例；仓库 round-trip 不替代本项。

**B3 已完成并实际执行**：真实 PG（本地 docker）上 service/engine 中途重建 6/6 通过，
红灯反证（复用旧 service 不重建）5 fail / 1 pass，见 [b3-closure-2026-10-07.md](b3-closure-2026-10-07.md)。
注：正式验收库尚未执行同一分支，需在验收环境复跑。

- [x] 5.1 完成 cancel/resume/discard、迟到回调隔离、PG 重启恢复、终态清理和运行历史恢复 UI。

依赖：4.1。覆盖 R1、R8～R10。

范围：CAS revision/attemptId 状态更新、AbortController、阶段／单位 checkpoint、重启状态转换、7 天终态 TTL、run 列表和恢复操作。active 记录不得因普通终态 TTL 被误删。

验收：
- 取消中止当前调用，已接受稿保留；旧回调不能覆写新尝试。
- 继续从 checkpoint 进入实际未完成阶段，补修次数与历史用量不重置。
- PG 重启变为 paused/process_restart，等待作者继续；没有 PG 时明确说明进程重启丢失。
- 继续和每个新调用前重新验证当前权限与原文版本；变化时暂停并保留成果。
- 终态按 expiresAt 清理；discard 删除敏感候选材料后保留最小墓碑至到期，查询行为遵循合同。
- P0 单 API 限制被记录，不用进程 Map 声称支持多副本。

测试：E14～E19；真实 PG checkpoint 后重启恢复集成测试；取消／续跑／结束并发竞态测试；浏览器刷新恢复、权限撤销、版本变化及到期 UI 测试。

### 6. 工作台整合与旧链路回归

2026-10-07 验收收口补充：先执行 [收口计划 B4](acceptance-closure-plan-2026-10-07.md) 的假模型浏览器闭环；工程检查点 A 通过后执行 B5 的 Prompt 设置与阶段隔离。

**B4 状态（浏览器闭环复验修复后，2026-10-07 晚）**：独立复验指出的三项测试逻辑错误
（清理合同失效 / 两场脚本不可达 / apply 全等断言可跳过）已全部修复，七例在本机真实栈
（docker PG + 真实 API/Web + 假编排器）实际执行 **7 passed / 0 failed**。
见 [browser-closure-fix-2026-10-07.md](browser-closure-fix-2026-10-07.md)；
遗留（不扩大范围）：checkpoint 保存故障注入、旧链路（方案改写/直接改写/循环/按场成稿）的实际操作回归。
**B5 已完成（含验收 R1 修复）**：Settings 五模板入口（职责 + 档位）；阶段隔离已接入真实调用链
（orchestrator 按模板档位决定 omit 且 override 不得重新打开），新增经真实 HTTP 入口的五阶段回归。
见 [b5-closure-2026-10-07.md](b5-closure-2026-10-07.md)；档位验证规则写入 [prompt-design.md](prompt-design.md) §2.1。
**R2 修复**：同句锚点后内容纳入扫描、`supersededBy` 位置校验，见 [prompt-design.md](prompt-design.md) §6.1 与
[b3-closure-2026-10-07.md](b3-closure-2026-10-07.md)（B3 另补权限撤销/冻结材料通用断言，PG 8/8）。

- [x] 6.1 在现有章节优化 UI 接入智能精修入口、全程进度、只读完整对比与最终应用，完成旧功能回归及追踪。

依赖：5.1。覆盖 R9、R11、R12。

范围：组件复用、API composable、活动记录；新增入口与旧 mode 分离；request_id/trace_id、runId、attemptId、模板版本关联；历史文档仅补链接及必要事实修正，不复制 active change。

验收：
- 用户路径为一次要求、一次启动、异常时明确处理、一次最终确认；不强制逐场审批。
- 未保存章节改动要先保存或明确返回编辑器；不悄悄丢掉编辑器内容而使用旧正文。
- 关闭弹窗不取消，运行可重新打开；候选流与已接受稿分别展示。
- 方案改写、直接改写、自动循环、按场成稿、Settings 发布回滚行为不变。
- 当前仓库规定的 lint/typecheck/test/build 以及对应旧链路测试通过；实际不可运行项记录原因，不能标 PASS。

测试：完整作者路径 E2E；旧分段零／正值、from-plan/direct、自动循环 cancel、创编 5200 限制、应用 1307 与摘要的回归；必要的 SSE envelope 与多订阅一致性测试。

### 7. 真实模型验收与受控发布

- [ ] 7.1 完成 evaluation.md 的长章稳定性、盲评与既有 RAG 回归，记录运行模型配置及证据后发布新模板与开放入口。

依赖：6.1。覆盖 R12。

范围：固定测试集及非敏感 fixture、模型运行记录、盲评表、长度／调用预算分析、模板版本与回滚计划；不修改供应商或生产模型默认值来迁就结果。

验收：
- 确定性门禁及本 change 的真实长章门槛全部满足，既有 GS-R/GS-G/GS-C 回归按基线执行。
- 调用数量、耗时、截断／暂停、人工干预、盲评分均有原始记录；明确估算项。
- 没有足够真实模型结果时保持草稿和入口未发布，不将本任务标完成。
- 发布具体模板版本可追溯、可回滚；默认值调整必须同步设计和证据。

测试：重复运行冻结长章样本、对比现有最佳适用链路；自动评测脚本与人工盲评共同验收。公开交付结果不得包含作者私有正文及密钥。

## 完成记录位置

每个任务完成时在本 change 保存证据链接和简短结论，勾选对应 checkbox。若需绑定 AQ 编号／GitHub issue，只在此任务下记录编号和链接；旧看板仅维护对应状态与本 change 链接。不得把未实施的本设计整体登记为 DONE。

### 1.1 可运行的保留原文基线 — AQ-380（DONE）

- 分支：`feat/aq-380-refinement-orchestration`。
- 合同：`openapi/paths/projects/chapter-refinement-{runs,run-by-id,run-events}.yaml` + `openapi.yaml` 的 `Refinement*` schema；`packages/shared-types` 已对齐。
- 持久化：`ChapterRefinementRun` 模型 + 迁移 `20261006120000_aq380_chapter_refinement_runs`；`PgChapterRefinementRunRepository` 与 `MapChapterRefinementRunRepository` 共用契约。
- 后端：`chapter-refinement.{types,engine,event-bus,service,controller,run.repository}.ts`，DI 注册于 `projects.module.ts`；engine 为确定性 keep-only，不调用模型、不开放 apply。
- 前端：`utils/chapterRefinement.ts`、`composables/useChapterRefinementRun.ts`、`components/chapters/ChapterRefinementPanel.vue`；`ChapterOptimizeDialog.vue` 隐藏入口仅 `?refinement=1` 可见。
- 自检证据（2026-10-06，本机）：
  - `lint`：本次新增/修改文件通过（`ChapterOptimizeDialog.vue` 存在仓库既有 CRLF 与 2 处历史 prettier 报错，非本任务引入，见下）。
  - `typecheck`：`services/api` 与 `apps/web`（vue-tsc）通过。
  - `test`：api 全量 448 pass / 0 fail（含真实临时 schema 的 PG 迁移与 round-trip，`REFINEMENT_PG_TEST_URL` 指向本机 docker PG）；web 全量 166 pass / 1 fail（失败为既有 `utils/pageFeedback.test.ts` 的 node 环境 `document is not defined`，与本次改动无关）。
  - `build`：`nest build` 与 `vite build` 通过。
- 已知环境项：`ChapterOptimizeDialog.vue` 的 CRLF 报错源于 `core.autocrlf=true` 检出（仓库索引为 LF），提交时归一化；2 处历史 prettier 报错在 HEAD 同样存在，未在本任务修复以免混入无关改动。
- E2E：新增 `apps/web/e2e/chapter-refinement.smoke.spec.ts`（凭据门控），覆盖「无 query 不显示入口」与「关闭再打开恢复 run」；需 `E2E_EMAIL/E2E_PASSWORD` + 可用后端，当前环境未执行，保留为待跑项。

### 2.1 一个完整场景的精修与应用 — AQ-381（DONE）

- 分支：`feat/aq-380-refinement-orchestration`。
- 生成网关：新增 `chapter-refinement.gateway.ts`（`RefinementGenerationGateway` + `OrchestratorRefinementGateway`），DI token `CHAPTER_REFINEMENT_GATEWAY`，经 `streamPipelineGeneration` 调 orchestrator，`kind` 区分真实引擎。
- 冻结材料：新增 `chapter-refinement.materials.ts`（`DefaultChapterRefinementMaterialsProvider`），建 run 时解析并冻结 `systemPromptText`、5 个模板文本／版本／hash、writing/utility 模型路由，写入 `snapshot`，运行时不再读全局默认。
- 引擎：`chapter-refinement.engine.ts` 增加 `OrchestratedRefinementEngine`，实现单场 inspect → plan → rewrite → 程序门禁 → review 的确定性顺序，产出完整候选并推进 checkpoint；取消／异常按 pause 分流，不误判为 ready。
- 范围工具：`chapter-refinement.util.ts` 新增 `resolveRefinementFirstRange` / `spliceRefinementCandidate` / `resolveRefinementRangeMaxChars`，按冻结原文的 UTF-16 偏移定位与拼接。
- 模板治理：新增 5 个 key（`chapter.refinement.{inspect,plan,rewrite,review,repair}`），注册进 `packages/prompt-templates`、API 白名单 `task-prompt-defaults.ts`、orchestrator 回退与 `knowledge-retrieval.ts` 分类（诊断／规划／检查归 utility，改写／补修归 writing，均不注入下章开头／近期摘要／语义记忆）；`writing-style-samples` 把 rewrite/repair 纳入文风注入。
- 装配：`projects.module.ts` 把 `CHAPTER_REFINEMENT_ENGINE` 切到 `OrchestratedRefinementEngine`，注册 gateway 与 materials provider。
- 前端：`ChapterRefinementPanel.vue` 增加候选对比、问题清单与「应用候选稿」；`useChapterRefinementRun.ts` 增加 `apply` / `canApply` / `applyGate`，复用旧 `applyChapterOptimization`（baseUpdatedAt 锁版本、preserveSummary、1307 冲突语义、成功后刷新编辑器）。
- 自检证据（2026-10-06，本机）：
  - `lint`：本 change 触及文件逐一 eslint 均 exit 0（api / web / rag-orchestrator / config / prompt-templates / shared-types）；仓库既有 CRLF／prettier 债按既有决策不夹带进本 change（另见 #39）。
  - `typecheck`：api、web（vue-tsc）、rag-orchestrator、shared-types、prompt-templates、config 全部通过。
  - `test`：api 全量 466 pass / 0 fail / 1 skipped；rag-orchestrator 全量 173 pass / 0 fail（默认命令因既有未关闭句柄不退出，用 `--test-force-exit` 收口，与本次改动无关）；web 全量 169 pass / 1 fail（既有 `utils/pageFeedback.test.ts` 的 node 环境 `document is not defined`，已在 HEAD 复现，与本任务无关）。新增／更新测试：`chapter-refinement.engine.test.ts`、`chapter-refinement.materials.test.ts`、`chapter-refinement.util.test.ts`（范围／拼接）、`chapter-refinement.service.test.ts`、`chapter-refinement.openapi.test.ts`、`workbench-task-prompt-sync.test.ts`（白名单计数 11→16）、`apps/web/src/utils/chapterRefinement.test.ts`（applyGate 等）。
  - `build`：api（nest build）、web（vite build）、rag-orchestrator、shared-types、prompt-templates、config 全部通过。
- 边界说明：`workbench-task-prompt-sync.test.ts` 的模板计数断言由 11 改 16，因本任务新增 5 个白名单模板；`chapter-optimize.util.ts` 等既有文件的 CRLF 属仓库债，不纳入本任务提交。
- 未完成／待跑：真实模型评测与模板发布属任务 7.1，尚未发布；入口仍为 `?refinement=1` 草稿门控；E2E 需凭据与后端，当前未执行。repair 模板已注册但引擎侧补修在任务 4.1 接入。

### 3.1 一万至两万字的整章顺序编排 — AQ-382（DONE）

- 分支：`feat/aq-380-refinement-orchestration`。
- 范围工具：`chapter-refinement.util.ts` 新增 `planRefinementDiagnosisWindows`（按累计 UTF-16 长度切分、优先完整自然段、超长段退到句末边界，窗口首尾相接且拼接逐码元等于原文）、`mergeWindowSceneFragments`（仅按可验证 block 引用与连续性合并，不可验证降级/丢弃）、`planRefinementWriteUnits`（场景优先、已验证拍边界拆分、超长无边界整场保留、未覆盖 block 由程序补 keep，保证全覆盖）、`assembleRefinementCandidate`（按原文偏移合并替换、拒绝交叠、未命中区间逐码元保留）、`buildRefinementCoverage`（processed 为跨度合计、retainedOriginal 只计保留原文）。
- 引擎：`OrchestratedRefinementEngine` 由单场改为整章顺序编排——全文冻结后分诊断窗逐窗通读 → 跨窗合并场景 → 整章 plan 唯一交底（含 `alignSceneBriefsToScenes` 回退对齐）→ 逐单位顺序 rewrite/review → 按原文偏移合并完整候选，推进 `checkpoint.coverage` 与 `changes`。
- 前端：`ChapterRefinementPanel.vue` 文案与进度改为整章范围；`utils/chapterRefinement.ts` 的 `formatRefinementCoverage` 增加未处理字数展示。
- 自检证据（2026-10-07，本机）：
  - `typecheck`：api、web（vue-tsc）通过。
  - `lint`：本任务触及的 api 文件逐一 eslint exit 0。
  - `test`：api 全量 483 pass / 0 fail / 1 skipped；新增 `chapter-refinement.util.test.ts`（38 项，含诊断窗 CRLF／空行／单换行／超长段／代理对、跨窗合并降级、写作单位规划、偏移合并、覆盖面统计）、`chapter-refinement.engine.test.ts`（整章多场景顺序改写不漂移）、`chapter-refinement.long-chapter.test.ts`（10000／15000／20000 字整章端到端覆盖全文且偏移不漂移）；web `utils/chapterRefinement.test.ts` 12 pass。
  - `build`：web（vite build）通过。
- 边界说明：此处使用脚本化 mock 模型 fixture，不代表真实模型质量验收；真实模型长章稳定性与盲评属任务 7.1。

### 4.1 有限补修、严格流完成与资源预算 — AQ-383（DONE）

绑定 [plan-contract-recovery.md](plan-contract-recovery.md)。本节合并 4.1 主体（严格流完成、调用／时间预算、单位补修、最终整章接缝修复、警告／暂停 UI）与 AQ-383 plan 合同有界恢复的交付记录。

**4.1 主体（本次交付）**

- 严格流完成（R7 / design D9）：`resolveRefinementCompletionFailure` 只在显式 `finishReason=stop` 时判成功；`incomplete_stream`（缺 end／断流）、`truncated`（length）、`filtered`（content_filter）、`unknown_finish`（缺失或未知结束原因）一律不可作为可应用候选。`chapter-generation-stream.client.ts` 把 `end` 事件的 `completed`/`finishReason` 透传；gateway 据此置 `completionFailure`；引擎在 inspect／plan／rewrite／repair 及整章最终检查所有调用点统一走 `callParse` / `pauseFromOutcome`，非完整收束按 `upstream_failure` 暂停，绝不接受非空半成品。
- 调用／时间预算（R8 / design D9）：`attemptCallCount` 按「本次尝试」独立计费，每次实际发起（含重试）都 +1；`checkpoint.usage` 跨尝试累计仅用于展示，resume 不重置累计值也不占用本次额度。`budgetExhausted(reserve)` 为最终检查预留 `REFINEMENT_RESERVED_FINAL_CHECK_CALLS=1` 次调用；生成阶段用尽则暂停 `budget_exhausted` 并保留原文尾部，不宣布成功。默认 80 次调用 / 30 分钟活动时间。
- 单位有限补修（R7/R6）：review 产出**可定位**（anchorQuote 逐字命中候选）、非 style、severity 为 high/medium 且带 fixIntent 的缺口才触发；每单位最多一次（`REFINEMENT_MAX_REPAIR_PASSES=1` + `unitRecovery.repairedUnitIds` 防重复）。补修前后用 `hashRefinementCandidate` 校验候选未被改写（拒绝过期修订），补修稿需重新过程序门禁与复检；复检仍有可定位阻断缺口则回退该单位原文。计数持久化进 `checkpoint.unitRecovery`，resume 不重置。
- 最终整章接缝检查（R7/R11 / design D7/D8）：全部单位接受后，程序先校验整章覆盖（`plannedChars === baseText.length`）与逐字锁，再对已改写范围连同相邻接缝做一次模型复核（`buildFinalSeamReviewUserPrompt`）。可定位到唯一候选范围的 high/medium 阻断缺口触发**最多一轮**接缝定位修复（`seamRepairCount < 1`），修复稿同样过门禁与复检；修复未通过、名额或预算不足则回退该范围原文并重建整章候选。最终检查调用失败即暂停，未完成检查不得标 ready。
- 状态与警告／暂停 UI（R11）：`ready` = 全部目标范围已处理且检查完成；`ready_with_issues` = 检查完成但仍有未解决问题或保留原文。前端 `resolveRefinementApplyGate` 在 paused／未处理完／候选等于原文时禁止应用；`buildRefinementApplyConfirmCopy` 对 `ready_with_issues` 显式列出未解决问题数与保留原文字数，要求作者逐条阅读后再确认覆盖。
- plan 合同有界恢复（AQ-383）：见 [plan-contract-recovery.md](plan-contract-recovery.md)；确定性证据回填 + 引文唯一重锚 + 引文字形无关／对白拼接匹配 + 最多一次额外 plan 调用 + 保守整场 keep 降级，计数写入 `checkpoint.planRecovery`。

**验收收口批次（2026-10-07 起，按 [acceptance-closure-plan-2026-10-07.md](acceptance-closure-plan-2026-10-07.md) 五批执行；不新增任务编号）**

- B1 应用资格与问题生命周期（本项，AQ-383）：见 [b1-closure-2026-10-07.md](b1-closure-2026-10-07.md)。关闭 E1（无 unitId 的全章保留提示误豁免全章阻断）：移除推断豁免，改为「同单位 + 候选版本已被取代 / 回退」的显式结案；终态判定抽出 `evaluateTerminalEligibility()` 供正常完成与续跑共用；UI `resolveRefinementApplyGate` 与阻断账本同口径。证据：红灯 E1 用例（换回旧守卫复现 1 fail）+ 绿灯结案／保守续跑／真实 service+engine 用例；全仓 lint / typecheck / test exit 0（api 597 pass / 1 PG skip）。
- B2 散场状态证据（待执行，依赖 B1）、B3 真实 PG 恢复（待 B1/B2）、B4 假模型浏览器闭环（待 B1/B2）、B5 Prompt 入口与阶段隔离（待工程检查点 A）。

**4.1 自检证据（2026-10-07，本机）**

- `test`：api 精修相关 8 个测试文件 92 项 91 pass / 0 fail / 1 skipped。`chapter-refinement.engine.test.ts` 4.1 用例覆盖：补修成功接受（`repairCount=1`、缺口记为 resolved）、补修后复检仍冲突回退原文、补修门禁失败保留候选（`repairCount=1`、`seamRepairCount=1`）、纯 style 建议不触发补修、用量跨尝试累计但预算按本次尝试独立、inspect 未完整收束按上游失败暂停。`chapter-generation-stream.client.test.ts` 覆盖 end+stop / length / content_filter / 断流 / 旧调用无新增字段（completed=true、finishReason=null）兼容。web `chapterRefinement.test.ts` 16 pass（含应用门禁与 ready_with_issues 确认文案）。
- `lint`：`services/api`、`apps/web` eslint exit 0。
- `typecheck`：`services/api`（tsc）、`apps/web`（vue-tsc）通过。
- `build`：`apps/web`（vite build）通过；`services/api` 的 `nest build` 通过（exit 0）。`prisma generate` 因本机 `pnpm dev` 开发栈正在运行、占用 `query_engine-windows.dll.node` 而报 `EPERM` 重命名失败，属环境占用而非代码问题（Prisma client 已生成，`nest build` 正常）。

**4.1 已知遗留（不影响本次完成判定，登记待后续）**

- token 实际用量未采集：provider 流未回传 usage，`usage.tokenAccounting` 恒为 `unavailable`，`inputTokens`/`outputTokens` 未填充。显示层已支持 actual/estimated/mixed/unavailable 区分，且按 design D9 不以模型名猜限额；待 provider→orchestrator→gateway 回传 usage/tokenizer 后补齐。
- E2E（`chapter-refinement.smoke.spec.ts`）需 `E2E_EMAIL/E2E_PASSWORD` 与可用后端，当前环境未执行。
- 真实模型长章稳定性、盲评与模板发布属任务 7.1（AQ-386），本条不代替。

**AQ-383 真实样章前置验证证据与观察（2026-10-07）**

- plan 合同恢复已实施（`chapter-refinement.util.ts` / `chapter-refinement.engine.ts`）：
  - 确定性证据回填：候选 key/value 与已验证事实索引唯一精确匹配时补 `sourceBlockId`/`anchorQuote`，不覆盖已有字段。
  - 引文唯一重锚：声明 block 内找不到引文、而该引文在允许范围内唯一一个 block 逐字出现时重锚 `sourceBlockId`，记录 `method: 'quote_unique_block'`；0 个或多个候选不重锚。
  - 引文字形无关匹配与对白拼接（`containsQuoteEvidence`）：忽略直引号／弯引号差异，并支持 `“甲。”他说，“乙。”` 被说话人提示隔断时的顺序拼接命中；不做语义或距离近似。
  - 最多一次额外 plan 调用 + 保守整场 keep 降级；引擎在首次与重试成功路径均记录回填计数（修复 `backfillCount` 恒为 0 的漏记）。
- 单测：`chapter-refinement.util.test.ts` 31 pass / 0 fail（含缺字段回填、唯一重锚、多命中不重锚、场景外不重锚、引文字形／句末补引号、对白拼接、确实不在原文仍记 `quote_not_found`）。
- 真实样章证据（2026-10-07，本机，`deepseek-v4-flash`，脚本 `services/api/scripts/refinement-sample-validation.ts`，产物 `.scratch/refinement-validation/`，仅候选稿与证据，不写章节、不发布模板）：
  - 中性长章 10571 字（`.scratch/eval-neutral-long.txt`）：reading 5 个诊断窗 → planning（首次 plan 4 条 `quote_not_found` 违约，1 次恢复调用后通过）→ 10 个写作单位（4 个 patch 单位改写通过程序门禁并接受，其余 keep／未覆盖保留原文）→ finished `ready_with_issues`；候选 10183 字，改写 3893 字，17 次模型调用，106.7s。
  - 有界恢复实证：首次 plan（raw call #6，46 facts）把「陆昭怀里护着书」「陆昭仍在雨夜行走，尚未到家」等 4 条事实的 `anchorQuote` 写成原文没有的转述（如「他把书护在怀里」 vs 原文「陆昭把书护在怀里，沿着巷子往外走」），`reanchorFactList` 全文唯一命中 0 个故不重锚，判 4 条 `quote_not_found` 并触发**一次**恢复调用；恢复 plan（raw call #7，53 facts）合同校验 0 违约被采纳，无确定性回填（`backfilled=0`）。引擎 `checkpoint.chapterBrief` 记录的正是恢复 plan（scene-1..4=patch，与 4 处 applied change 一致）。
  - 写作单位与覆盖：10 个单位＝4 patch（scene-1..4，591／1436／1617／249 字）＋3 个窗口边界 uncovered（自然段 10／54／98，共 21 字）＋3 keep（scene-5 132 字、scene-6 5287 字、scene-7 1238 字）；`plannedChars=processedChars=10571`，`retainedOriginalChars=6678`（＝各 keep 单位之和）。scene-6／scene-7 上游 `confidence=low`，规划按安全策略整场 keep（非静默丢弃）。
  - 观察（恢复以 value=null 收场）：恢复 plan 对上述两条无法逐字取证的事实输出 `value=null`（保留转述引文），严格解析后 `verifyFactList` 跳过空值事实，合同因此通过。合同 §3 只禁止**引擎**改写 null，模型自身置 null 属 schema 允许；但「模型可用 null 规避引文校验」是需留意的规避面，§4 的暂停条件（全章 protectedFacts 无效等）仍作兜底。
  - 观察（逐字锁本轮未生效）：被采纳的恢复 plan 对全部场景 `protectedSpanIds=[]`，程序门禁的逐字锁分支本轮未执行；「门禁引号字形误杀」出现在更早的 ASCII 引号样章 run（该 plan 带锁）。故「接受改写未丢锁」只对带锁的 run 成立。
  - 观察（证据脚本）：`refinement-sample-validation.ts` 原按 key 记录**首次**成功调用，`planDiagnostics` 因此显示首次（违规）plan 而非被采纳的恢复 plan；已改为按 key 覆盖（最后一次成功＝被采纳）。历史 `neutral-long.refinement.meta.json` 的 `planDiagnostics` 仍是首次 plan，交叉核对以 `chapterBrief` 与 `raw.json` 为准。
  - 观察（门禁引号字形）：`runRefinementProgramGate` 的逐字锁用精确 `includes`。样章原用 ASCII 直引号、模型统一转中文弯引号，导致首轮 4 个单位全部被误判「候选丢失逐字锁内容」而保留原文。把样章引号归一为真实章节使用的弯引号（`.scratch/eval-neutral-long.ascii-backup.txt` 留底）后通过。真实章节本就使用弯引号（`eval-ch1/ch2` 均 0 直引号），故非生产缺陷，但模型若对弯引号原文反向输出直引号会同样误杀，是否让门禁也做字形无关匹配待定。
  - 观察（review 合同）：unit 7 的 review `exitStateFacts` 用 `sourceEvidence` 代替 `sourceBlockId`+`anchorQuote`，当前只记 warning 并把该段检查标为未完成，无 AQ-383 式恢复。review 合同与 plan 同类脆弱，是否纳入恢复待定。
  - 观察（rewrite 交底）：`buildRewriteUserPrompt` 未注入逐字锁列表，但门禁按逐字锁判定；本轮模型自行保留了对白，是否需把锁显式交给正文模型待定。
  - 修复（改写保真守卫，2026-10-07）：作者反馈「改写压缩过头」。根因为新精修 rewrite 的 system prompt 漏了旧链路已有的「信息量与感官密度不得低于原文对应部分」约束，且 `buildRewriteUserPrompt` 不携带原始 instruction，用户在【篇幅】里写的保真要求未到达正文模型。已在 rewrite system prompt 末行补该守卫并同步 3 处镜像（`chapter-refinement.util.ts` / `rag-orchestrator task-prompt-defaults.ts` / `prompt-templates templates.ts`）；同时把 `refinement-sample-validation.ts` 的 plan 采集改为按 key 覆盖最后一次成功调用。方案、备选与待外部 AI 复核的 4 个问题见 [rewrite-fidelity-guard.md](rewrite-fidelity-guard.md)。
  - 复跑证据（2026-10-07，同章同要求）：修复前候选 10183 字（改写部分 3893→3505，−10.0%），修复后候选 10723 字（改写部分 2292→2444，+6.6%），调用 17→12，issues 11→9。方向由净压缩转为持平／略扩。两次 plan 不同（单位 10 vs 7），属单次对比而非受控 A/B，仅作方向性证据。
  - 观察（逐字锁首次生效）：修复后该轮 plan 产出非空 `protectedSpanIds`，逐字锁分支首次执行；2 个单位改写丢失锁定段落被门禁判 `quote_missing` 并保留原文（未静默放行）。对照修复前那轮 `protectedSpanIds` 全空、同一锁定段落确实丢失，说明锁生效与否直接决定这些段落保不保住。本样章 0 直引号／308 弯引号，故本轮 `quote_missing` 非字形误杀，是模型确实改写了锁定文本。
  - 新增门禁：`services/api/src/modules/task-prompts/refinement-task-prompt-sync.test.ts`，断言五个精修模板在 util 种子／API 白名单／orchestrator 兜底／prompt-templates 登记四处逐行一致，并单独断言保真守卫行三处都在（23 pass）。

### 5.1 取消、继续与服务重启恢复 — AQ-384（DONE）

- 分支：`feat/aq-380-refinement-orchestration`。

**合同（Contract First）**

- 新增 `openapi/paths/projects/chapter-refinement-run-{cancel,resume,discard}.yaml`，并在 `openapi/openapi.yaml` 注册三条 path 与 `ChapterRefinementCancelRequest` / `ChapterRefinementResumeRequest` / `ChapterRefinementDiscardRequest`。
  - cancel：`POST .../runs/{runId}/cancel`，200/400/401/404/409/410；body 可选 `expectedAttemptId`，显式幂等，且写明迟到回调不得覆写已取消 checkpoint。
  - resume：`POST .../runs/{runId}/resume`，202/400/401/403/404/409/410；body 必填 `expectedRunRevision`，写明「已接受单位不重跑、CAS 更新、不可恢复返回 409」。
  - discard：`POST .../runs/{runId}/discard`，200/400/401/404/409；body 必填 `expectedRunRevision`，写明保留最小墓碑、GET／订阅返回 410、绝不改动章节正文。
- `packages/shared-types` 增量对齐三条新 path 与三个 schema（`pnpm --filter @aether-quill/shared-types build` 通过）。

**后端**

- `chapter-refinement.types.ts`：新增 `RefinementResumeUnit` / `RefinementResumeState`（整章意图 + 写作单位计划（省 `text`）+ 已接受替换 + `nextUnitIndex` + 降级计数），`RefinementCheckpoint.resumeState`，`isRefinementResumable`，`tombstoneRefinementRun`（清理冻结正文／要求／模板文本／模型路由与候选，保留最小摘要字段），以及 `RefinementCancelInput` / `RefinementResumeInput` / `RefinementDiscardInput`。
- `chapter-refinement-run.repository.ts`：接口与 PG／Map 双实现新增 `listByStatuses`（启动恢复扫描）、`listExpired`（TTL 清理）、`remove`（墓碑二次到期删除），保持契约一致。
- `chapter-refinement.engine.ts`：
  - 续跑（R8/design D10）：`run()` 顶部提升 `resumeState`/`units`/`brief`/`replacements`/`acceptedParts`/`consumed`/已接受范围记录；`buildResumeState()` 随每次 checkpoint 持久化写作计划；`restoreResumeState()` 重放已接受前缀、确定性复原派生状态；主循环从 `nextUnitIndex` 起，不重跑已接受单位，不重跑 inspect/plan。
  - 续跑还原完整性：`changes`/`issues` 一并从 checkpoint 还原（并推进 `issueSeq` 避免 id 冲突），确保续跑不丢前缀段落的变更与提示。
  - 终态收口：`settle()` 落库前清空 `resumeState`，避免已完成 run 的 checkpoint 无谓膨胀。
  - `onBeforeCall`：每次真实模型调用前回调；钩子发现变化即 abort，引擎按 abort 收束，真实暂停原因由 service 覆盖。
- `chapter-refinement.service.ts`：实现 `OnModuleInit` / `OnModuleDestroy` 与 `cancelRun` / `resumeRun` / `discardRun` / `cleanupExpiredRuns`。
  - cancel：按 `expectedAttemptId` 校验，`AbortController` 中止在途调用，CAS 落 paused/user_cancelled；已停止时幂等返回当前摘要。
  - resume：CAS `expectedRunRevision`，重校验权限与冻结原文版本，`isRefinementResumable` 门禁；不满足返回 409／1307；通过后后台另开执行尝试。
  - discard：先取消在途尝试，再 `tombstoneRefinementRun('discarded')`，发 `finished` 摘要并 `release` 事件总线；已 discarded 幂等。
  - cleanup：`listExpired` → 非墓碑转 `expired` 墓碑（重置 TTL）；墓碑二次到期 `remove`；active 记录 `expiresAt` 为远期占位，不参与删除。
  - 启动恢复：`recoverInterruptedRuns()` 把遗留 queued/running 收敛为 paused/process_restart，保留最后 checkpoint，不自动再调用模型。
  - 每调用前 `preflight()`：重校验项目权限与冻结原文版本；发现变化写入 `guardStops` 并 abort，`executeRun` 用真实原因覆盖引擎默认 `user_cancelled`，`permission_revoked` / `source_changed` 落为不可恢复。
  - 迟到回调隔离：`executeRun` 落库前比对 `attemptId`，被替换的尝试结果直接丢弃；`onStage` 亦按 `attemptId` 过滤。
  - 清理定时器 `CLEANUP_INTERVAL_MS = 30min`，`unref()` 且 `onModuleDestroy` 清除。
- `chapter-refinement.controller.ts`：新增 cancel（`@HttpCode(200)`）、resume（`@HttpCode(202)`）、discard（`@HttpCode(200)`）三个 `@Post`，路径与 openapi 一一对应。

**前端**

- `utils/chapterRefinement.ts`：新增 `ChapterRefinementCancelRequest` / `ResumeRequest` / `DiscardRequest` 类型与 `canCancelRefinementRun` / `canResumeRefinementRun` / `canDiscardRefinementRun` / `describeRefinementPauseState`（`process_restart` 区分 PG 可恢复与内存模式不可恢复）。
- `services/api.ts`：新增 `cancelChapterRefinementRun` / `resumeChapterRefinementRun` / `discardChapterRefinementRun`。
- `composables/useChapterRefinementRun.ts`：新增 `cancelling` / `resuming` / `discarding` 与 `canCancel` / `canResume` / `canDiscard` / `pauseHint`，以及 `cancel()` / `resume()` / `discard()`（携带 `expectedAttemptId` / `expectedRunRevision`，成功后回表刷新与重订阅）。
- `components/chapters/ChapterRefinementPanel.vue`：进度区新增「取消精修 / 继续精修 / 放弃并清理」按钮与 `pauseHint` 暂停提示，取消与放弃带二次确认；`onMounted` 调用 `restore()` 完成运行历史恢复（活动 run 继续订阅，终态 run 直接展示候选），运行历史列表可切换查看。

**自检证据（2026-10-07，5.1 本轮，本机）**

- `test`：
  - api 精修相关 8 个文件 103 项（102 pass / 0 fail / 1 skipped）。新增／扩展覆盖 E14～E19：cancel（paused/user_cancelled、幂等、`expectedAttemptId` 失配 409）、resume（→ready、原文变更 1307 + paused/source_changed/not resumable、revision/not-resumable 409）、discard（墓碑、清空 snapshot/checkpoint、RunView 410、幂等、revision 409）、`onModuleInit` 重启恢复、cleanup（首个周期转墓碑、二次移除墓碑、active 不删）、权限撤销守卫（`GatedProbeEngine`）、迟到回调隔离（`SlowEngine`）。
  - `chapter-refinement.engine.test.ts` 新增两条续跑用例：预算耗尽中断后，续跑复用持久化计划、从下一单位继续、不重跑 inspect/plan、前缀 changes 还原、终态 `resumeState=null`；全单位完成后仅剩最终检查时，续跑只重做最终检查、不重发改写（31 pass）。
  - api 全量 533 项（532 pass / 0 fail / 1 skipped）；web 全量 174 pass / 0 fail。
- `lint`：`services/api`、`apps/web` 全量 `eslint` exit 0。
- `typecheck`：`services/api`（tsc）、`apps/web`（vue-tsc）通过。
- `build`：`packages/shared-types`（tsc）、`services/api`（nest build + prisma generate）、`apps/web`（vue-tsc + vite build）通过。

**边界与已知遗留（不影响本次完成判定）**

- P0 单 API 限制：内存模式（无 PG）下运行记录存于进程内 Map，服务重启即丢失；R10 要求不虚报——前端按 `storageMode` 明确提示「内存模式无法恢复本次运行」。多副本部署依赖 PG 持久化，本 change 不声称内存模式支持多实例。
- E16 的 PG checkpoint 后重启恢复已在 repository/service 层以契约测试覆盖；真实临时 PG 迁移 round-trip 见任务 1.1 记录；真实进程重启集成与浏览器 UI E2E（`chapter-refinement.smoke.spec.ts`，凭据门控）当前环境未执行，保留待跑。
- 真实模型长章稳定性、盲评与模板发布属任务 7.1（AQ-386），本条不代替。
- 附带修复（测试基础设施，非 5.1 语义）：`chapter-generation-stream.client.test.ts` 的临时 SSE 服务器补 `Connection: close`，消除 Node 全局 agent 复用上一个已关闭测试服务器 keep-alive socket 导致的 `socket hang up`（该文件属「严格流完成」在途改动，非本任务改动；修复前 2 项稳定失败，修复后 6 项稳定通过）。

### 6.1 工作台整合与旧链路回归 — AQ-385（DONE）

- 分支：`feat/aq-380-refinement-orchestration`。

**范围（组件复用、入口分离、关联信息、未保存改动保护）**

- 入口整合与旧 mode 分离：智能精修入口保持在 `ChapterOptimizeDialog.vue`（现有章节优化 UI）内，作为与「方案改写 / 直接改写 / 自动循环」`mode-toggle` 并列的独立按钮（`refinement-entry-button`），不复用 `rewriteMode` 状态；草稿门控 `isChapterRefinementEntryEnabled('?refinement=1')` 保持不变，正式开放仍属任务 7.1。切换旧 mode 只重置旧链路状态，不影响精修弹层。
- 未保存章节改动保护（验收「不悄悄丢掉编辑器内容而使用旧正文」）：`ChapterList.vue` 新增 `pendingEdit` 计算属性与 `getPendingEdit()`（相对已保存正文的标题 / 正文差异）；`Chapters.vue` 打开文笔优化 / 按场工作台前调用 `ensureChapterSavedBeforeOptimize`，命中未保存改动时弹确认「先保存并继续 / 返回编辑器」，保存成功后用刷新后的章节对象（新 `updatedAt`）再打开，避免精修冻结旧正文。守卫文案为纯函数 `resolveOptimizeEntryGuard`。
- 运行关联信息（request_id/trace_id、runId、attemptId、模板版本）：`RefinementRunSummary` 新增 `creationTraceId`，`RefinementRunView` 新增 `frozenTemplateVersions`；后端创建 run 时把 `ObservabilityInterceptor` 注入的 `request.traceId` 冻结进 snapshot（不含凭据），墓碑保留 trace 但清空模板版本；`ChapterRefinementPanel.vue` 新增可折叠「运行关联信息（排查用）」展示 runId / attemptId / 创建 trace / 冻结模板版本。

**合同（Contract First）**

- `openapi/openapi.yaml`：新增 `RefinementTemplateVersionRef` schema；`RefinementRunSummary` 增加可空 `creationTraceId`；`RefinementRunView` 增加 `frozenTemplateVersions`（注明墓碑后清空）。
- `packages/shared-types` 增量对齐对应 schema 与类型（`pnpm --filter @aether-quill/shared-types build` 通过）。
- 未新增 path 或错误码；旧 `optimize/*` 入口行为不变。

**后端**

- `chapter-refinement.types.ts`：`RefinementSnapshot.creationTraceId`；`RefinementRunSummary.creationTraceId`；`RefinementRunView.frozenTemplateVersions`；`buildRefinementRunSummary` / `buildRefinementRunView` 输出新字段；`tombstoneRefinementRun` 保留 `creationTraceId`、清空 `templateVersions`。
- `chapter-refinement.service.ts`：`createRun` 增加可选 `traceId` 参数写入快照。
- `chapter-refinement.controller.ts`：`AuthenticatedRequest.traceId`，创建 run 时透传 `req.traceId`。

**前端**

- `utils/chapterRefinement.ts`：新增 `RefinementTemplateVersionRef` 类型、`formatRefinementTemplateVersion`、`buildRefinementRunCorrelation`、`resolveOptimizeEntryGuard`。
- `components/chapters/ChapterList.vue`：`pendingEdit` + `getPendingEdit`（`defineExpose`）。
- `pages/Chapters.vue`：`handleSaveChapter` 返回 `Promise<boolean>`；新增 `ensureChapterSavedBeforeOptimize`；文笔优化 / 工作台打开前守卫并使用保存后的最新章节。
- `components/chapters/ChapterRefinementPanel.vue`：运行关联信息折叠区与样式。

**自检证据（2026-10-07，本机）**

- `test`：
  - api 全量 541 项（540 pass / 0 fail / 1 skipped）。新增：`chapter-refinement.service.test.ts` 3 项（trace id 与模板版本可追溯、缺省 trace 记 null、discard 墓碑保留 trace 清空模板版本）；`chapter-refinement.openapi.test.ts` 1 项（关联字段契约）；新增 `chapter-refinement-event-bus.test.ts` 4 项（多订阅一致 envelope、新 attempt 重置 seq、单订阅者异常隔离、退订与 release）。
  - web 全量 180 项（180 pass / 0 fail）。`chapterRefinement.test.ts` 新增 6 项（模板版本展示、关联信息汇总 / 缺省降级、入口守卫有 / 无 / 缺章节号）。
  - 旧链路回归：分段零 / 正值（`chapter-optimize.util.test.ts`）、from-plan/direct（`fromPlanClosedRun.test.ts`、`writingOptimizeStepVisual.test.ts`、`chapter-optimize.util.test.ts`）、自动循环（`chapter-auto-loop.engine.test.ts`、`chapter-auto-loop-session.store.test.ts`、`chapter-auto-loop.util.test.ts`）、创编 5200（`chapterOptimizeWorkbench.test.ts`、`chapter-refinement.util.test.ts`）、应用 1307 与摘要（`chapter-optimize.util.test.ts`、`chapter-summary.util.test.ts`、`chapter-refinement.service.test.ts`）均随全量套件通过。
- `lint`：`services/api`、`apps/web` 全量 `eslint` exit 0。
- `typecheck`：`services/api`（tsc）、`apps/web`（vue-tsc）通过。
- `build`：`packages/shared-types`（tsc）、`services/api`（nest build）、`apps/web`（vue-tsc + vite build）通过。

**边界与已知遗留（不影响本次完成判定）**

- 正式入口发布（移除 `?refinement=1` 门控）属任务 7.1，本任务只把入口接入现有 UI 并保持草稿门控。
- 完整作者路径 E2E 新增 `apps/web/e2e/chapter-refinement-author-path.spec.ts`（入口与旧 mode 并存 + 关联信息；未保存改动守卫），需 `E2E_EMAIL/E2E_PASSWORD` 与可用后端，当前环境未执行，保留待跑。
- 真实模型长章稳定性、盲评与模板发布属任务 7.1（AQ-386），本条不代替。

## 复验剩余路径修复收口 — 2026-10-07（第二轮，F1～F6 + W5 入口）

- 分支：`feat/aq-380-refinement-orchestration`。
- 依据：[复验报告](reverification-2026-10-07.md) 列出的 F1～F6 未闭合分支与 W5 正式测试入口。
- 收口报告：[remediation-closure-2026-10-07.md](remediation-closure-2026-10-07.md)。

**修复要点**

- F1：`callModel` 在发起真实调用前原子 `commitCheckpoint`（消耗调用/恢复/补修名额与累计用量），失败即暂停 `persistence_failed`；诊断逐窗 `persistCheckpoint`，`diagnosisInspections` 从 checkpoint 恢复；`commitCheckpoint` 不再吞异常；service `onCheckpoint` 校验 attemptId 与 CAS 返回值并抛出。
- F2：`backfillFactList` 增加场景 `allowedBlockIds` 过滤；`verifyFactList` 增加 `fact_out_of_scope`（不可退化违规）；全章 `protectedFacts` 仍按全文范围。
- F3：最终检查改为 `while` 重检循环，修复/回退后 `expandNeighborhood` 重检相邻接缝，`finalRound>1` 仍阻断即暂停 `boundary_conflict`；`rebuildAcceptedDraft` 避免索引漂移。
- F4：新增 `RefinementFrozenReferenceMaterials` 与 `projects.service.getFrozenReferenceMaterials`；materials 冻结人物/知识/文风文本；网关下发；orchestrator 用冻结块组装【参考上下文】/【检索证据】/【文风参照】，不再读当前 projectCtx。
- F5：`verifyRefinementStateFact` 证据绑定候选，仅原文命中记 `historical`，引擎记非阻断 `continuity` 提示。
- F6：`callModel` 的 `desiredOutputChars` 必填、删除 `maxTokens` 旁路；显式 `RefinementModelCapability`，未知能力走不可判断路径；预算含模板/系统提示/冻结材料；最终分组计入公共上下文与邻文。
- W5：新增 `scripts/run-tests.mjs`（显式收集 `src/**/*.test.ts`），各包 test 脚本改用它；`TraceStore` 定时器 `unref()`，移除对 `--test-force-exit` 的依赖。

**自检证据（2026-10-07 本机，Node v20.19.0 / Windows）**

- `lint`：`services/api`、`services/rag-orchestrator` `eslint` exit 0。
- `typecheck`：`services/api`、`services/rag-orchestrator` `tsc --noEmit` 通过。
- `test`（经 `scripts/run-tests.mjs`）：api 578 PASS / 0 FAIL；orchestrator 179 PASS / 0 FAIL；web 187 PASS / 0 FAIL；config 47、model-providers 10、worker 8，全部 0 FAIL。
- `pnpm -r test`（正式入口，Node v20.19.0 / Windows）：PASS（不再报 `Could not find ...'src\**\*.test.ts'`）。
- 确定性复现：`evidence/remediation-probes-2026-10-07.ts` PASS（exit 0），观察 `evidence/remediation-observations-2026-10-07.json`；修复前反例保留于 `evidence/reverification-probes.ts`。
- 源文件指纹：`evidence/remediation-source-manifest-2026-10-07.json`。

**边界与已知遗留**

- 假模型浏览器作者路径 E2E（关闭重开、取消继续、再次启动、检查失败不可应用、版本冲突、应用后刷新）仍待补，属 W5 余项。
- 真实临时 PG 的 service 重建断言（名额/用量/诊断不重置）在默认跳过的 PG 专用 URL 下补齐。
- 真实模型长章稳定性、盲评与模板发布仍属任务 7.1（AQ-386），本条不代替。

## 收口验收剩余缺陷修复（C1～C4 / W6）— 2026-10-07（第三轮）

- 分支：`feat/aq-380-refinement-orchestration`。
- 依据：[收口修复独立验收报告](closure-verification-2026-10-07.md)。
- 收口报告：[closure-remediation-2026-10-07.md](closure-remediation-2026-10-07.md)。

**修复要点**

- C1：引擎新增 `finalCandidateAssembled`，整章候选合并后 `commitCheckpoint` 不再重派生正文；`revertedRanges` 提升为引擎级状态，resume/checkpoint 的 `replacements`/`changes` 同步剔除被回退范围；回退后无法定位到单一活动候选的阻断登记 `unresolved` 并暂停 `boundary_conflict`（不再降级 warning）。
- C2：`resolveRefinementCallBudget` 同时约束上下文余量与单次输出上限，必要输出超额明确拒绝；`resolveRefinementModelCapability` 改 provider+model 双键，未知组合返回 null 走不可判断路径；结构化输出统一 `REFINEMENT_STRUCTURED_OUTPUT_TOKENS` 合同预算。
- C3：前端 `PAUSE_REASON_LABELS` 补 `persistence_failed`，补测试；`vue-tsc`/`vite build` 通过。
- C4：`getFrozenReferenceMaterials` 增 `chapterNo`，文风样本经 `selectWritingStyleSamplesForTask` 排除当前章并做适用性选择；orchestrator 冻结模式下仅写作阶段（rewrite/repair）注入文风块。
- W6：`RefinementFact` 增 `exitAnchorQuote`；`verifyRefinementStateFact` 要求末态锚点命中候选且 value 落在锚点内才判 `evidence`，否则 `historical`/`conflict`；三处 review 模板镜像同步。

**自检证据（2026-10-07 本机，Node v20.19.0 / Windows）**

- `lint`：api / orchestrator / web eslint 全绿。
- `typecheck`：api / orchestrator tsc、web vue-tsc 通过。
- `test`：`pnpm -r test` exit 0 — api 591、orchestrator 182、web 188、config 47、model-providers 10、worker 8，全部 0 FAIL。
- `build`：web vite build 通过。
- 确定性复现：`evidence/closure-remediation-probes-2026-10-07.ts` exit 0；观察 `evidence/closure-remediation-observations-2026-10-07.json`；指纹 `evidence/closure-remediation-source-manifest-2026-10-07.json`。
- `openspec validate add-chapter-refinement-orchestration --strict` 通过。

**遗留**：假模型浏览器作者路径 E2E；真实临时 PG 的 service 重建断言；AQ-386 真实模型评测。

（2026-10-07 后续：第二项已由 B3 实际执行并关闭，见 [b3-closure-2026-10-07.md](b3-closure-2026-10-07.md)；
浏览器 E2E 用例已交付但仍未执行，见 [b4-closure-2026-10-07.md](b4-closure-2026-10-07.md)。）

- 分支：`feat/aq-380-refinement-orchestration`。
- 收口报告：[final-acceptance-remediation-2026-10-07.md](final-acceptance-remediation-2026-10-07.md)。

**修复要点**

- D1：`resolveRefinementRewriteMaxTokens` 估算 2.5 → 1.5 token/字（3500 字 → 5250 < 8192，正常范围不再被误杀）；单位改写 / 单位补修 / 最终接缝补修三路显式检查 `contextExhausted` / `budgetExhausted`，暂停 `context_budget` / `budget_exhausted`，不再落入「保留原文并标记就绪」的降级分支。
- D2：最终接缝修复后复检 `!recheck.ok` 统一 `pauseFromOutcome`（保存失败 → persistence_failed），只有复检成功且仍报阻断才回退；接缝补修调用补 contextExhausted / budgetExhausted 暂停分支。
- D3：完成守卫——账本存在 `unresolved` 高/中严重度且范围候选仍生效（未被 retained_original 回退）时暂停 `boundary_conflict`，不得返回可应用终态。

**自检证据（2026-10-07 本机，Node v20.19.0 / Windows）**

- `lint` / `typecheck`：api eslint + tsc 全绿。
- `test`：`pnpm -r test` exit 0 — api 594、orchestrator 182、web 188、config 47、model-providers 10、worker 8，全部 0 FAIL。
- 确定性复现：`evidence/final-acceptance-probes-2026-10-07.ts` exit 0；观察 `evidence/final-acceptance-observations-2026-10-07.json`；指纹 `evidence/final-acceptance-source-manifest-2026-10-07.json`。
- 第三轮探针 `closure-remediation-probes-2026-10-07.ts` 仍 exit 0（无回归）。
- 引擎新增 D1/D2/D3 回归测试 3 项。
- `openspec validate add-chapter-refinement-orchestration --strict` 通过。

**遗留**：假模型浏览器作者路径 E2E；真实临时 PG 的 service 重建断言；AQ-386 真实模型评测。
