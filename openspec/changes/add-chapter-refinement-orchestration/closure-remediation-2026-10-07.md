# 章节精修编排 — 第三轮修复收口（C1～C4 / W6）

- 日期：2026-10-07
- 分支：`feat/aq-380-refinement-orchestration`
- 依据：[验收报告与确定性复现](closure-verification-2026-10-07.md) 列出的剩余问题
- 结论：**本轮列出的 C1～C4 与 W6 已修复并通过确定性复现**；假模型浏览器闭环、真实临时 PG 服务重建验证仍为遗留。

## 修复内容

### C1 · 最终稿错误（checkpoint 覆盖最终修复/回退结果）

根因：`commitCheckpoint` 在最终阶段仍按「已接受前缀 + 剩余原文」重派生 `acceptedDraftText`，把最终接缝修复稿写回旧稿、把已回退的旧候选重新拼回正文。

修复（`chapter-refinement.engine.ts`）：

- 新增 `finalCandidateAssembled` 标志：整章候选按原文偏移合并完成后置真；此后 `commitCheckpoint` 不再重派生正文，直接使用最终修复/回退后的 `acceptedDraft`。
- `revertedRanges` 提升为引擎级状态；`buildResumeState` / `buildCheckpoint` 输出的 `replacements` 与 `changes` 均剔除被回退范围，保证终态正文、resume 状态、变更清单与最后一次落库候选四者一致。
- 接缝定位 `computeSeamStarts` 跳过被回退范围，避免索引漂移。
- 回退后只命中原文/旧候选、无法定位到单一活动候选的阻断，不再降级为 `warning` 放行应用，改为登记 `unresolved` 并暂停 `boundary_conflict`。

回归测试：引擎 3 个（修复成功/修复失败回退/无法定位阻断暂停）+ 真实 service+engine 1 个（终态含接缝修复稿、登记 resolved）。

### C2 · 预算保护不完整

- `resolveRefinementCallBudget`：必要输出必须**同时**装进上下文余量与单次输出上限；`requiredOutputTokens` 超过 `maxOutputTokens` 时明确拒绝（`ok:false` + 原因），不再静默压低 maxTokens。
- 能力解析改为 **provider+model 双键**（`deepseek/deepseek-chat` 等已登记组合）；已知 provider 的未知 model 返回 null，走不可判断路径暂停，不再按 provider 级猜测值放行。
- 结构化输出（inspect / plan / review）统一使用合同规模预算 `REFINEMENT_STRUCTURED_OUTPUT_TOKENS = 4096`；改写/补修按目标正文规模，均通过 `requiredOutputTokens` 显式参与预算。

### C3 · typecheck/build 失败（前端缺 persistence_failed 映射）

`apps/web/src/utils/chapterRefinement.ts` 的 `PAUSE_REASON_LABELS` 补齐 `persistence_failed: '进度保存失败'`，并补测试；`vue-tsc` 与 `vite build` 通过。

### C4 · 当前章样本排除与分阶段注入

- `ProjectsService.getFrozenReferenceMaterials(projectId, userId, chapterNo)`：文风样本经 `selectWritingStyleSamplesForTask` 按当前章排除并做适用性选择，与编排器实际注入逻辑同源。
- `ChapterRefinementMaterialsProvider.resolve(projectId, userId, chapterNo)` 传入章号；冻结材料的 `styleSampleBlock` 只含适用样本。
- orchestrator：冻结模式下文风块仅在写作阶段模板（rewrite / repair）注入，inspect / plan / review 不注入（`isWritingStyleInjectionTemplateKey` 判定）。
- 新增 `chapter-refinement.frozen-materials.test.ts`：当前章排除、数量上限、适用性、冻结后修改来源不漂移。

### W6 · 散场状态证据绑定末态位置

- `RefinementFact` 新增可选 `exitAnchorQuote`；review 合同要求 exitStateFacts 的 value 落在 exitAnchorQuote 内、二者均逐字命中候选正文。
- `verifyRefinementStateFact`：只有携带末态锚点、锚点命中候选且 value 落在锚点内才判 `evidence`；仅原文（或候选中无末态锚点的历史片段）命中判 `historical`，不得作为当前散场状态传播。
- 三处 review 模板镜像（api util / orchestrator defaults / prompt-templates）同步更新，镜像一致性测试通过。

## 确定性复现

- 修复后探针：[closure-remediation-probes-2026-10-07.ts](evidence/closure-remediation-probes-2026-10-07.ts)（exit 0）
- 观察结果：[closure-remediation-observations-2026-10-07.json](evidence/closure-remediation-observations-2026-10-07.json)
- 源文件指纹：[closure-remediation-source-manifest-2026-10-07.json](evidence/closure-remediation-source-manifest-2026-10-07.json)
- 修复前缺陷探针保留于 [closure-verification-probes-2026-10-07.ts](evidence/closure-verification-probes-2026-10-07.ts) 作历史对照

关键观察：冻结样本 `['sample-2']`（当前章排除）；无末态锚点的入场状态 `historical`；必要输出 9000 > 单次上限 8192 明确拒绝；未知 model 返回 null；最终修复稿保留且最后落库候选=终态；回退后旧候选不复活（changes=1）；无法定位阻断暂停 `boundary_conflict`。

## 门禁（2026-10-07 本机，Node v20.19.0 / Windows）

- `lint`：api / orchestrator / web `eslint` 全绿
- `typecheck`：api / orchestrator `tsc --noEmit`、web `vue-tsc --noEmit` 通过
- `test`：`pnpm -r test` exit 0 — api 591、orchestrator 182、web 188、config 47、model-providers 10、worker 8，全部 0 FAIL
- `build`：web `vite build` 通过
- `openspec validate add-chapter-refinement-orchestration --strict` 通过

## 遗留

- 假模型浏览器作者路径 E2E（关闭重开、取消继续、再次启动、检查失败不可应用、版本冲突、应用后刷新）仍待补。
- 真实临时 PG 的 service 重建断言（名额/用量/诊断不重置）在 PG 专用 URL 下补齐。
- AQ-386 真实模型长章评测不在本条范围。
