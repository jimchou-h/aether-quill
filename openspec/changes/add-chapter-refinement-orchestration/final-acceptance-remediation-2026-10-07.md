# 章节精修编排 — 第四轮修复收口（D1～D3）

- 日期：2026-10-07
- 分支：`feat/aq-380-refinement-orchestration`
- 依据：第四轮独立探针发现的三项缺陷（正常范围预算误杀 / 最终复检保存失败未暂停 / unresolved 阻断返回可应用终态）
- 结论：**本轮三项缺陷已修复并通过确定性复现**；假模型浏览器闭环、真实临时 PG 服务重建验证仍为遗留。

## 修复内容

### D1 · 正常 3500 字范围无法改写（预算误杀 + 静默降级）

两个叠加问题：

1. **估算过保守**：`resolveRefinementRewriteMaxTokens` 按 2.5 token/字 估算必要输出，3500 字 → 8750 token，超过 deepseek-chat 单次输出上限 8192 → 预算拒绝。中文改写产出经验比约 1 token/字，改为 **1.5×**（3500 字 → 5250 < 8192），保留 4096 下限与 65536 上限。
2. **降级路径错误**：改写调用的 `contextExhausted` outcome 没有任何分支检查，落入「上游持续失败，保留原文并继续」的降级分支，最终把从未改写的章节标记为就绪。现在单位改写 / 单位补修 / 最终接缝补修三条路径都显式检查 `contextExhausted` 与 `budgetExhausted`，分别暂停 `context_budget` / `budget_exhausted`，绝不静默保留原文放行。

### D2 · 最终复检保存失败没有暂停

整章最终接缝修复后的复检（recheck）失败时，旧代码只单独处理 `aborted`，其余一切失败（含 **checkpoint 保存失败**、上下文超限、预算耗尽）都被当作「修复后仍有阻断」→ 回退该范围 → 继续到 `ready_with_issues` 可应用终态。保存失败时名额与用量尚未落库，继续执行会丢账。

修复：复检 `!recheck.ok` 统一走 `pauseFromOutcome`（aborted→user_cancelled、storageFailed→persistence_failed、contextExhausted→context_budget、budgetExhausted→budget_exhausted、解析/收束失败→upstream_failure）；只有复检成功且仍报阻断才回退。最终接缝补修调用本身也补上 `contextExhausted` / `budgetExhausted` 暂停分支。

### D3 · 暂停后继续仍携带未解决阻断，却返回可应用终态

完成态判定只把 `unresolved` 计入 `ready_with_issues`（可应用）。按 R11「可应用稿不得有未解决阻断冲突」，新增完成守卫：账本中存在 `disposition=unresolved` 且严重度为高/中的问题、且该范围候选仍然生效时，暂停 `boundary_conflict`。已被回退原文（`retained_original`）的单位除外——其候选已不存在，旧阻断随之失效，维持 `ready_with_issues`。

## 确定性复现

- 探针：[final-acceptance-probes-2026-10-07.ts](evidence/final-acceptance-probes-2026-10-07.ts)（exit 0）
- 观察：[final-acceptance-observations-2026-10-07.json](evidence/final-acceptance-observations-2026-10-07.json)
- 指纹：[final-acceptance-source-manifest-2026-10-07.json](evidence/final-acceptance-source-manifest-2026-10-07.json)

关键观察：3500 字必要输出 5250 token（< 8192）且端到端改写真实发生（rewriteCalls=1，status ready）；最终接缝复检保存失败 → `paused/persistence_failed`；仍生效候选携带 unresolved 高严重度阻断 → `paused/boundary_conflict`。

回归测试：引擎新增 D1（正常 3500+ 字范围真实改写）、D2（复检保存失败暂停）、D3（未解决阻断不可应用）三项；既有 4.1 门禁失败用例行为不变（范围已回退原文，维持 ready_with_issues）。

## 门禁（2026-10-07 本机，Node v20.19.0 / Windows）

- `lint` / `typecheck`：api eslint + tsc 全绿
- `test`：`pnpm -r test` exit 0 — api 594、orchestrator 182、web 188、config 47、model-providers 10、worker 8，全部 0 FAIL
- 第三轮收口探针 `closure-remediation-probes-2026-10-07.ts` 仍 exit 0（无回归）
- `openspec validate add-chapter-refinement-orchestration --strict` 通过

## 遗留

- 假模型浏览器作者路径 E2E（关闭重开、取消继续、再次启动、检查失败不可应用、版本冲突、应用后刷新）仍待补。
- 真实临时 PG 的 service 重建断言（名额/用量/诊断不重置）在 PG 专用 URL 下补齐。
- AQ-386 真实模型长章评测不在本条范围。
