# 章节精修剩余路径修复收口（2026-10-07 第二轮）

## 结论

针对 `reverification-2026-10-07.md` 列出的 F1～F6 未闭合分支与 W5 正式测试入口，本轮逐条修复并通过确定性复现验证：

| 项 | 剩余问题 | 本轮结果 |
|---|---|---|
| F1 | 调用 / 补修名额、诊断成果在发起前未落库，取消或重启会重置 | **已修**：每次消耗前原子持久化；诊断逐窗落库；存储失败明确停止 |
| F2 | 回填可跨场取证 | **已修**：回填与校验按场景 sourceBlockIds 过滤；新增 `fact_out_of_scope` |
| F3 | 最终回退后未按新接缝重检 | **已修**：检查完成绑定候选；修复/回退后重检相邻接缝，仍阻断即暂停 |
| F4 | 人物 / 知识 / 文风样本未冻结 | **已修**：run 开始时构建实际参考材料并下发；orchestrator 用冻结块组装最终消息 |
| F5 | 历史原文状态被当成当前散场状态 | **已修**：证据绑定候选；仅原文命中记 `historical`（非阻断提示） |
| F6 | 完整输入预算未覆盖所有调用、供应商限额硬编码 | **已修**：`desiredOutputChars` 必填；显式模型能力；未知能力不可判断路径；含公共上下文与邻文 |
| W5 | Node 20 / Windows 正式测试入口失败；force-exit 临时收口 | **已修（入口）**：跨平台收集脚本；移除 force-exit；`pnpm -r test` 在 Node 20 通过 |

本报告只描述代码与测试层面的收口，不调用真实模型、不发布归档。AQ-386 仍在本轮范围外。

## 关键实现

### F1 · 消耗前原子持久化

`chapter-refinement.engine.ts`：
- `callModel` 在 `attemptCallCount += 1; usage.callCount += 1` 之后、真正发起网关调用之前调用 `commitCheckpoint`，失败即返回 `storageFailed` 并暂停（`persistence_failed`）。
- 新增 `persistCheckpoint(message)`：调用 `commitCheckpoint` 并把存储异常转换为暂停结果；6 处单位流程改用它并在暂停时立即返回。
- 诊断循环按窗推进：每完成一个窗口即 `persistCheckpoint`，`diagnosisInspections` 从 `record.checkpoint.diagnosis` 恢复，续跑不重跑已完成窗口。
- `commitCheckpoint` 不再在内部 `catch` 吞掉存储异常，改为抛出。

`chapter-refinement.service.ts`：`onCheckpoint` 在 `latest.attemptId !== attemptId` 或 `save(...)`（CAS）返回假值时抛出，阻断“未确认落库仍继续”。

### F2 · 场景作用域

`chapter-refinement.util.ts`：`backfillFactList` 增加 `allowedBlockIds` 参数，按 sourceBlockIds 过滤证据候选后再判唯一性；`verifyFactList` 增加场景范围校验并产出 `fact_out_of_scope`（新增违规类型，计入不可退化违规）；全章 `protectedFacts` 仍按全文范围处理。

### F3 · 回退后重检

`chapter-refinement.engine.ts`：以 `while (checkIndices.length > 0)` 循环做最终检查，任一轮修复 / 回退后 `checkIndices = expandNeighborhood(touched)` 重检相邻接缝；`finalRound > 1` 仍有阻断则暂停 `boundary_conflict`，不再把冲突稿标为 `ready`。`rebuildAcceptedDraft()` 过滤回退范围并避免索引漂移。

### F4 · 冻结参考材料

- `chapter-refinement.types.ts`：新增 `RefinementReferenceMaterial` / `RefinementFrozenReferenceMaterials`，`RefinementSnapshot.referenceMaterials`。
- `projects.service.ts`：新增 `getFrozenReferenceMaterials`（人物 / 文风样本 / 知识文档文本与来源）。
- `chapter-refinement.materials.ts`：run 创建时构建 `personaText` / `knowledgeText` / `styleSampleBlock` / `promptText`。
- `chapter-refinement.gateway.ts`：随请求下发 `frozenReferenceMaterials`。
- `rag-orchestrator/src/main.ts` + `generation-prompt-assembler.ts` + `retrieval/knowledge-retrieval.ts`：精修 run 存在冻结材料时，跳过当前 projectCtx 的检索 / 选样，用冻结块组装【参考上下文】/【检索证据】/【文风参照】；`readFrozenReferenceMaterials` 读取并容错。

### F5 · 候选绑定状态证据

`chapter-refinement.util.ts` 的 `verifyRefinementStateFact` 仅在**候选**同时含 quote+value 时返回 `{ status:'evidence', origin:'candidate' }`；仅原文命中返回 `{ status:'historical' }`；证据不足返回 `unknown` / `conflict`。引擎对非 `evidence` 记非阻断 `continuity` 提示（severity low / disposition warning），不阻断终态。

### F6 · 完整输入预算

`chapter-refinement.util.ts`：新增 `RefinementModelCapability` 与 `REFINEMENT_MODEL_CAPABILITIES`（deepseek 64k/8k、siliconflow 32k/8k），`resolveRefinementModelCapability` 未登记返回 null；`resolveRefinementCallBudget` 增加 `requiredOutputTokens`，装不下即拒绝，不再静默压低。

`chapter-refinement.engine.ts`：`callModel` 的 `desiredOutputChars` 改为**必填**，删除 `maxTokens` 旁路；预算按「任务模板 + 项目 system prompt + user prompt + 冻结参考材料」计算，能力未知走不可判断路径（`contextExhausted`）；inspect / plan / 单位补修 / 最终接缝补修 / 接缝复检全部传入期望输出；最终分组计入公共上下文与两侧邻文。

### W5 · 跨平台测试入口

新增 `scripts/run-tests.mjs`：递归显式收集 `src/**/*.test.ts(x)`，再执行 `node --import tsx --test <files>`，不依赖 shell/Node 的 glob。各包 test 脚本改为 `node ../../scripts/run-tests.mjs`。同时给 `TraceStore` 的自动保存 / 防抖定时器加 `unref()`，移除导致进程挂起的句柄（此前靠 `--test-force-exit` 兜底）。

## 独立运行结果

| 检查 | 结果 |
|---|---|
| `pnpm -r lint`（api / orchestrator 变更文件） | PASS |
| `npx tsc --noEmit`（api / orchestrator） | PASS |
| API 精修测试（engine / util / service） | 118 PASS / 0 FAIL |
| Orchestrator 相关测试（assembler / frozen / retrieval） | 44 PASS / 0 FAIL |
| 各包经 `scripts/run-tests.mjs`（Node v20.19.0 / Windows） | api 578、orch 179、web 187、config 47、model-providers 10、worker 8，全部 0 FAIL |
| `pnpm -r test`（Node 20.19.0 / Windows） | PASS（exit 0；正式入口不再报 `Could not find ...'src\**\*.test.ts'`） |
| 确定性复现 `evidence/remediation-probes-2026-10-07.ts` | PASS（exit 0），观察见 `evidence/remediation-observations-2026-10-07.json` |

## 仍未完成 / 建议

1. **假模型浏览器作者路径闭环（W5 余项）**：仍需在 `apps/web` 补齐不依赖真实模型的关闭重开、取消继续、再次启动、检查失败不可应用、版本冲突、应用后正文刷新等 E2E。
2. **真实临时 PG 的 service 重建断言**：现确定性命中 Map 仓库；临时 PG 分支的“名额 / 用量 / 诊断不重置”断言建议在 CI 的 PG 专用 URL 下补齐（默认跳过）。
3. 复核前建议重跑：`pnpm -r lint && pnpm -r typecheck && pnpm -r test && openspec validate add-chapter-refinement-orchestration --strict`，再进入 AQ-386 真实模型验收。

## 复现

```powershell
# services/api 下
node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/remediation-probes-2026-10-07.ts
```

修复前反例（记录缺陷）保留在 `evidence/reverification-probes.ts` 与 `evidence/reverification-observations-2026-10-07.json`；本轮修复后源文件指纹见 `evidence/remediation-source-manifest-2026-10-07.json`。
