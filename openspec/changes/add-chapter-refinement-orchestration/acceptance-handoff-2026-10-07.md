# 验收交接包：R1 / R2 / R3 修复轮（2026-10-07 晚）

针对 [batch-acceptance-2026-10-07.md](batch-acceptance-2026-10-07.md) 提出的三项 P1，本轮修复情况。
纪律不变：**任何 missing / skip 都不能标 PASS**。

| 缺陷 | 修复 | 证据 |
|---|---|---|
| **R2** 同句锚点后内容被整体跳过（B2 状态漏检） | `verifyRefinementStateFact` 改为从锚点结束处切尾扫描（覆盖同句剩余部分）；模型自报 `supersededBy` 须程序校验位置在锚点之后，否则判 `ambiguous` | 红灯：判定层 2 fail + 引擎 1 fail（旧逻辑复现验收用例）→ 绿灯 122/122；引擎新例断言 checkpoint 不登记错误确定状态、下一范围确认状态小节不出现它（不按全文含词判定） |
| **R1** 阶段隔离只在测试输入成立（B5） | 档位唯一来源移入 `packages/config`（`isRefinementUtilityStageTemplateKey` 等）；orchestrator 按模板键决定 omit 且 **override 不得重新打开**；engine 只在写作档下发冻结项目文风（gateway 字段改可选）；api 的 `CHAPTER_REFINEMENT_*_TEMPLATE_KEYS` 改为由 config 判定分桶 | 新增**真实入口**回归 `chapter-refinement.stage-isolation.test.ts`（真实网关 → 隔离的真实 orchestrator 子进程 → 假 provider 捕获最终 messages）6/6；红灯 4 fail（还原旧 override 分支即复现验收矩阵）；验收探针缺陷观察断言改为正确行为断言后 exit 0 |
| **R3** B4 资产缺口 | 隔离夹具（专用项目+中性章节+每例重置+套件清理）、取消确认弹窗、「开始智能精修」实际按钮、clientRequestId 捕获与创建响应丢失重试、E1 注入、带 JWT 的真实章节保存接口、apply 全等+摘要保留、ready_with_issues、未保存保护真实操作、端口统一 4409、假编排器 `hangAfterNth/failAfterNth` | ~~7 例尚未全绿~~ → **复验后修复三项测试逻辑错误（清理合同 / 两场脚本 / apply 全等），七例在本机真实栈实际执行 7 passed / 0 failed**，详见 [browser-closure-fix-2026-10-07.md](browser-closure-fix-2026-10-07.md)（承接复验报告 [browser-closure-reverification-2026-10-07.md](browser-closure-reverification-2026-10-07.md)） |

另补 **B3 通用断言**（验收 W1）：在已通过的 PG 重建链上新增
「重建后权限被撤销 → resume 被拒绝且零模型调用」与「重建发生在设置/材料变更之后仍用 run 冻结版本」两例；
PG 分支 **8/8 通过**（`REFINEMENT_PG_TEST_URL` 配置后实际执行）。

## 门禁（修复后，本机 2026-10-07）

```
pnpm -r lint        → exit 0
pnpm -r typecheck   → exit 0
pnpm -r test        → exit 0（1066 pass / 0 fail / 9 skip：config 47 + web 192 + model-providers 10 + api 620 + worker 8 + orchestrator 189）
pnpm -r build       → exit 0
openspec validate add-chapter-refinement-orchestration --strict → valid
B4 浏览器闭环（desktop，本机真实栈）→ 7 passed / 0 failed（.scratch/refinement-b4/e2e-run8-final.log）
```

**9 个 skip 点名**：8 个是 PG 重建用例在 `REFINEMENT_PG_TEST_URL` 未配置时的显式 skip
（本环境单独配置后 8/8 通过），1 个是既有 skip。全仓默认跑法下这些是 skip，**不是 PASS**。

日志：`.scratch/refinement-b5/`（lint/typecheck/test）、`.scratch/refinement-b2/pg-b3-extra.log`（PG 8/8）、
`.scratch/refinement-b4/e2e-run8-final.log` 与 `gate-*.log`（B4 最终执行与门禁）、
`.scratch/refinement-b4/start-b4.sh`（搭栈脚本）、`batch-probes-after-fix.log`（验收探针）。

## 验收人待办

1. **复跑独立探针**：`evidence/batch-acceptance-probes-2026-10-07.ts`（已改为正确行为断言，exit 0）。
2. **B4 复核**：按 [browser-closure-fix-2026-10-07.md](browser-closure-fix-2026-10-07.md) 复现步骤搭栈复跑七例。
   关键接线不变：**API 的 `RAG_ORCHESTRATOR_URL` 必须直接指向假编排器**，
   不要经真实 orchestrator 再转（协议不匹配会以 incomplete_stream 暂停）。
   本地测试账号 `e2e-refinement@aether.local` 密码已重置为 `password123`（与种子一致；仅本地测试账号）。
3. **AQ-386** 真实模型评测（不在工程范围；工程通过不保证文学质量）。

五个 `chapter.refinement.*` 模板保持 draft／受控入口；没有「验收通过」授权前不归档。
