# 章节精修收口修复独立验收（2026-10-07）

## 结论

**仍未通过工程验收。** 本轮修复确实解决了多项已复现问题，标准 test 入口也已恢复；但最终修复/回退稿会被持久化逻辑覆盖，必要输出仍被静默裁剪，全仓 typecheck/build 新增失败。不能据 `remediation-closure-2026-10-07.md` 的“已修”声明关闭全部 F 项。

本次对照上一轮 `reverification-2026-10-07.md`、最新修复回填及现行规格，验收本地工作树。基线 HEAD：`c848ce040ebc3b075ae9f5b9d6f04af8d784bb83`，包括其后未提交修改。未修改产品代码、任务勾选或发布状态，没有调用真实模型。AQ-386 继续排除在本轮范围外。Prompt 设置入口及 utility/writing 隔离问题保留为后续工作。

## 独立门禁结果

| 检查 | 结果 |
|---|---|
| `openspec validate add-chapter-refinement-orchestration --strict` | PASS |
| `pnpm -r lint` | PASS |
| `pnpm -r test`，Node v20.19.0 / Windows | PASS；1009 PASS / 0 FAIL / 1 SKIP |
| 测试分包 | API 578 PASS + 1 PG SKIP；Web 187；orchestrator 179；config 47；model-providers 10；worker 8 |
| 正式仓库测试 + 真实本地隔离临时 PG | 2 PASS / 0 FAIL / 0 SKIP；Map 和 PG 两分支，单独运行，不重复累计到 1009 |
| `pnpm -r typecheck` | **FAIL**；Web 暂停原因映射缺少 `persistence_failed`，TS2741 |
| `pnpm -r build` | **FAIL**；同一 Web 类型错误阻断 `vue-tsc --noEmit && vite build`，不能宣称全仓构建通过 |
| API / orchestrator 单独 typecheck | PASS；全仓前端失败不代表这两个包失败 |
| 开发者 `remediation-probes-2026-10-07.ts` | PASS；其覆盖的正向反例有效，但最终稿探针没有 `onCheckpoint`，遗漏真实 service 使用路径 |
| 独立边界探针 | 成功复现下文缺陷；脚本 exit 0 表示复现成功，**不是验收通过** |
| 假模型浏览器完整作者路径 | 未完成；开发者回填也明确列为余项 |
| 真实临时 PG 的 service/engine checkpoint 后重建 | 未完成；PG 仓库 round-trip 不能代替服务恢复验证 |
| GS-R 独立评测及真实模型评测 | 本轮未重跑；不沿用上一轮结果充当本轮证据，不做文学质量结论 |

日志保存在 `.scratch/refinement-closure-verification/`：`lint.log`、`test.log`、`typecheck.log`、`build.log`、`service-typecheck.log`、`pg.log`、`probes.log`、`openspec.log`。PG 封装限制 localhost，使用已有测试的随机临时 schema，未操作业务 schema。

## 修复项状态

| 项 | 本轮确认有效 | 仍未闭合 |
|---|---|---|
| F1 | 真实 service+engine 取消探针：实际调用 7 次、持久化 7 次，repairCount=1，已接受变更=1；诊断逐窗落库及保存失败停止有实现和确定性测试 | PG 中途重建验证仍缺；新增调用前 checkpoint 与最终候选重建冲突，见 C1 |
| F2 | 场景作用域过滤生效，越界回填产生违规；已知事实置 null、已有错误引文仍被拒绝 | 当前反例已关闭，勿重新开发这些已验证分支 |
| F3 | 增加最终修复/回退后的邻接复检；第二轮能定位到有效候选的阻断可暂停 | 带真实 checkpoint 回调时最终修复稿丢失、已回退坏稿复活；回退正文上的阻断被降为 warning |
| F4 | 实际人物/知识/样本文本被冻结并进入 gateway 与最终 prompt assembly，跳过动态检索/选样 | 样本没有排除当前章、没有复用适用样本选择，见 C4；阶段隔离另行处理 |
| F5 | 仅原文有证据时返回 historical，不作为当前状态传播；不确定提取结果明确非阻断提示 | 候选中入场证据仍可能被认作散场状态，见 W6，不能声称已验证散场位置 |
| F6 | 所有调用统一经过完整输入预算；超长输入在 inspect 前拒绝 | 输出上限仍会静默裁剪必要输出；能力仅按 provider，忽略 model，见 C2 |
| W1–W4 | 保留上一轮已关闭结论；本轮真实 PG 仓库再次通过 | 无需重复开发已关闭核心问题 |
| W5 | Node 20 / Windows 正式测试入口通过；不再靠 force-exit，测试正常退出 | 假模型浏览器闭环仍缺；见 W7 |

## 阻断缺陷与明确修复要求

### C1 · P1 / F1+F3：最终修复和回退被 checkpoint 写回旧稿

位置：`services/api/src/modules/projects/chapter-refinement.engine.ts:429`、`:435`、`:1775`、`:1955`、`:1973`。

`commitCheckpoint` 在每次模型调用前，把 `acceptedDraft` 重设为 `acceptedParts + baseText.slice(consumed)`。但最终接缝修复/回退只更新 `replacements`、范围记录与重建后的 `acceptedDraft`，没有同步 `acceptedParts`。随后复检发起前，checkpoint 提交把新的完整候选覆盖成旧的单位接受稿；终态 `settle` 返回该旧稿。

独立探针配置了与真实 service 相同的 `onCheckpoint` 回调，观察到：

- 最终 repair 成功、复检通过，问题被登记 `resolved`，终态 **ready**，但返回正文仍为修复前的“甲推门进屋，将钥匙放下”，不含已接受的“郑重地”。
- 最终 repair 失败，第一范围应回退原文；终态 **ready_with_issues**，变更清单只剩第二范围，`retainedOriginalChars=10`，正文却仍含第一范围的旧改写稿。正文、回退账本和变更清单互相矛盾。
- 回退后的重检报告原文中的唯一引文“甲推开门，放下钥匙。”存在 high/hard_constraint 冲突；`locateRange` 仍只搜索旧 `record.candidate`，且 blocking 排除 revertedRanges，问题降为 warning，仍进入可应用终态。

开发者收口探针直接运行 engine 且未传 `onCheckpoint`，其最终回退测试能通过，但没有进入覆写分支，不能代表真实 service 路径。

修复要求：统一最终候选、替换清单和 checkpoint 的权威来源；持久化不得重新派生旧稿。最终修复/回退后的正文、resumeState、范围定位、检查覆盖与状态事实须同步；检查记录绑定实际候选 revision/hash。回退范围本身和真实接缝上的阻断不得因无法定位到旧候选而降为非阻断。补真实 service+engine 的修复成功、修复失败回退、修复期间取消/重建测试，断言最终正文和账本一致，而非只断言调用次数。

### C2 · P1 / F6：必要输出继续被裁剪，未知模型能力仍被猜测

位置：`chapter-refinement.util.ts:68`、`:75`、`:124`、`:132`。

`resolveRefinementCallBudget` 只检查上下文 available 是否足够，然后返回 `Math.min(required, providerOutputCap, available)`。当上下文足够但供应商输出上限不足时，仍返回 ok。复现：完整输入 1000 字符、必要输出 9000 token、输出上限 8192，返回 **`{ok:true,maxTokens:8192}`**。这与本轮回填“不再静默压低”的声明相反。

`resolveRefinementModelCapability` 接受 model 参数但完全不读取；表的 key 是 provider。`deepseek/unknown-small-model` 也得到 64000/8192，并没有进入未知模型的不可判断路径。本项是代码合同问题，本轮无需查询供应商最新限额即可证实。

修复要求：必要输出同时受上下文余量和单次输出上限检查；装不下则重新规划安全范围或暂停。按实际冻结 provider+model 或已验证能力配置解析限额，未登记组合明确拒绝。结构化 inspect/plan/review 的输出预算应依据合同规模；不要简单照用正文输出预算再静默裁剪。补“上下文足够但输出上限不足”和“已知 provider、未知/小容量 model”的负向测试。

### C3 · P1：新增暂停原因导致全仓 typecheck/build 失败

位置：`apps/web/src/utils/chapterRefinement.ts:87`。

OpenAPI、shared-types 和 API 类型新增了 `persistence_failed`，但 `PAUSE_REASON_LABELS: Record<RefinementPauseReason,string>` 缺少该字段。正式 typecheck 和 build 都确定性失败，错误 TS2741。这不是环境或真实模型依赖。

修复要求：补齐前端中文状态提示及相关覆盖；重新执行全仓 typecheck/build。当前 lint/test 通过不足以关闭该交付门禁。

### C4 · P2 / F4+R12：冻结材料绕过样本筛选，包含当前章节自身样本

位置：`projects.service.ts:921`、`:951`；`chapter-refinement.materials.ts:122`；`services/rag-orchestrator/src/main.ts:1264`。

当前直接冻结全部 sanitized writingStyleSamples。材料接口没有 chapterNo，返回时丢失 sourceChapterNo 和 sceneType；orchestrator 的冻结分支又跳过现有样本选择，因此无法排除当前章自身样本或选择适用样本。R12 的 writing 阶段场景明确要求排除当前章样本，这不是新增需求。

独立探针调用真实 `ProjectsService.prototype.getFrozenReferenceMaterials`，提供来源分别为第 1、2 章的合法样本：精修第 1 章时两份都被纳入；现有 `selectWritingStyleSamplesForTask({chapterNo:1})` 则正确只选第 2 章。

修复要求：冻结面保留来源与分类，创建时获得当前 chapterNo，冻结实际允许注入的适用样本；按阶段注入并复用已冻结选择，避免续跑读动态设置。补当前章排除、样本数量/预算、任务适用性及创建后修改样本不漂移测试。utility/writing 具体注入隔离按后续 Prompt 问题继续处理。

## 未关闭验证与告警

### W6 · F5：候选中的历史入场证据不等于散场状态

`chapter-refinement.util.ts:1186` 目前仅检查 quote/value 在候选中任意位置出现。候选“甲拿着钥匙入场，散场时把钥匙留在桌上。”仍把“拿着钥匙”判为 evidence/candidate。仅原文证据的反例已修，但本反例证明“绑定候选”尚未等于“绑定散场位置”。

要求：显式记录散场状态证据的范围/时间位置与后续更新，不能仅凭全段子串命中确认当前状态。不能用关键词启发式假装解决语义判断；合同及 review 应提供可验证的末态证据，不能确认的状态不向下游传播。

### W7 · W5 与 E16：仍有不依赖真实模型的验收缺口

- `apps/web/e2e/chapter-refinement-author-path.spec.ts` 仍依赖真实登录凭据和后端，点击开始会生成；没有假网关的关闭重开、取消继续、再次启动、检查失败不可应用、版本冲突、应用后真实正文刷新闭环。
- 本轮真实 PG 测试通过的是仓库 round-trip；尚无实际 service+engine 取消/进程重建后，调用用量、诊断进度和修复名额不重置的 PG 断言。上一轮 F1 已提出该项，不能降为可选建议。

以上属于 AQ-384/AQ-385 的确定性工程验证，不需要等待 AQ-386 的真实模型。

## 证据与下一步

- 独立复现：[closure-verification-probes-2026-10-07.ts](evidence/closure-verification-probes-2026-10-07.ts)。
- 观察结果：[closure-verification-observations-2026-10-07.json](evidence/closure-verification-observations-2026-10-07.json)。
- 核心源文件指纹：[closure-verification-source-manifest-2026-10-07.json](evidence/closure-verification-source-manifest-2026-10-07.json)。

运行方式（在 services/api 下）：

```powershell
node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/closure-verification-probes-2026-10-07.ts
```

本脚本断言现存缺陷，修复后相应断言应失败；请将它们转为期望正确行为的正式回归测试，不把 exit 0 当验收通过。

建议顺序：C3 补齐类型映射 → C1 统一候选/checkpoint 并保证真实接缝阻断 → C2 模型与输出预算 → C4 样本选择与 W6 末态证据 → W7 非模型集成验证 → 工程复验通过后处理 Prompt 设置入口/阶段隔离，再进行 AQ-386。

本报告只新增验收文档和中性复现证据；没有调整已登记 DONE、归档或修改产品功能。
