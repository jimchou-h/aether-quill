# 第四轮修复独立验证（2026-10-07）

## 结论

**D1/D2/D3 的上一轮原始反例均已通过复跑；工程验收仍未完成。** D3 新守卫还存在无 unitId 的全章记录互相误豁免的问题。W6 末态证据与浏览器/PG 服务重建验证也尚未闭合，不依赖真实模型。

本轮对照 `third-verification-2026-10-07.md` 和 `final-acceptance-remediation-2026-10-07.md` 验证本地工作树。未修改产品代码或任务状态，未调用真实模型，未发布或归档。Prompt 设置入口和项目长指导的阶段隔离仍待后续处理。

## 独立验证结果

| 项目 | 结果 |
|---|---|
| lint / typecheck / build | 全仓 PASS；包括实际 Nest build 与 Prisma generate |
| 正式 `pnpm -r test` 首跑 | FAIL；Web `chapterRefinement.test.ts` 子进程退出 1，无具体断言错误，原因未定位 |
| 失败文件单独复跑 | 28 PASS / 0 FAIL |
| 正式 `pnpm -r test` 全量复跑 | **1028 PASS / 0 FAIL / 1 SKIP** |
| 分包复跑 | API 593 PASS + 1 PG SKIP；orchestrator 182；Web 188；config 47；model-providers 10；worker 8 |
| 真实本地隔离临时 PG 仓库契约 | 2 PASS / 0 FAIL / 0 SKIP；单独运行，不重复累计 |
| OpenSpec strict validate | PASS |
| 开发者 `final-acceptance-probes-2026-10-07.ts` | PASS |
| 独立复跑上一轮原始反例 | PASS；实际 3500 字范围有正文变化，最终复检保存失败暂停，阻断暂停后继续仍暂停 |
| 现有长章测试加冻结模型路由副本 | 4 PASS；约 10000 / 15000 / 20000 字及章尾覆盖，实际使用已登记 `deepseek/deepseek-chat` 的预算能力 |
| 新增混合提示/阻断探针 | 成功复现下文 E1；不是验收 PASS |
| GS-R 与真实模型质量评测 | 本轮未执行，不拿已有检索或 mock 结果证明文学质量 |

日志在 `.scratch/refinement-fourth-verification/`：`lint.log`、`typecheck.log`、`build.log`、`test.log`（首跑）、`web-retry.log`、`test-retry.log`、`pg.log`、`openspec.log`、`developer-probes.log`、`independent-probes.log`、`frozen-route-long.log`。

长章附加测试只对 `chapter-refinement.long-chapter.test.ts` 的暂存副本调整导入路径，并将 `modelRoute:null` 改为写作/工具两档冻结 `deepseek/deepseek-chat`；没有改动原测试、fixture、预算或断言。暂存文件为 `.scratch/refinement-fourth-verification/frozen-route-long-chapter.test.ts`。首跑失败不能从记录中删除；单独及全量复跑均通过，当前没有证据把它定性为业务回归。

## 已确认有效的修复

- **D1**：3500 字输出预算为 5250 token，正常范围实际执行 rewrite。独立 fixture 返回 ready，正文有变化，调用链为 inspect → plan → rewrite → review → review。已登记冻结路由下的长章回归也通过。实际 token 估算准确度与扩写质量仍须真实模型评测。
- **D2**：原探针在最终 repair-review 发起前注入持久化失败，现返回 paused/persistence_failed，保留此前已接受稿，不进入可应用终态。
- **D3 原反例**：不可定位高危问题先暂停；同一 checkpoint 继续，即使新 review 没有问题，只要旧阻断仍 unresolved 就继续 paused/boundary_conflict，不再直接 ready_with_issues。

## E1 · P1 / D3：无 unitId 的保留提示误豁免全章阻断

位置：`services/api/src/modules/projects/chapter-refinement.engine.ts:2089`、`:2094`；真实无 unitId 保留提示来源 `:1063`。

新完成守卫先收集 retained_original 问题的 unitId，再排除同 unitId 的 unresolved 阻断。但全章/场景级记录没有 unitId，Set 中会出现 **undefined**；另一个全章高危阻断也没有 unitId，于是 `retainedOriginalUnitIds.has(issue.unitId)` 返回 true，错误认为该阻断对应候选已回退。

复现不是手工伪造问题账本：

1. 真实 engine 读取两场中性正文：第一场正常 rewrite；第二场超过 5200 字且无已验证拍边界，程序按合同保留原文。
2. 程序生成第二场 `coverage/medium/retained_original` 提示，**没有 unitId**。
3. 第一场的最终检查返回不可定位全章 `hard_constraint/high`，程序登记 **unresolved、无 unitId**，正确暂停。
4. 使用真实暂停 checkpoint 继续，review 返回空问题，旧阻断仍 unresolved。
5. 新守卫被另一场的 undefined 豁免，终态 **ready_with_issues**，账本仍有全章 high/unresolved 阻断。

违反 R11“可应用候选无未解决阻断冲突”。这是 D3 的未覆盖分支，不是新增需求；上一轮单独阻断反例修好了，但带其他场保留警告的正常多场组合尚未修完整。

修复要求：仅具体、有效且能关联实际候选 revision/范围的 unitId 可用于回退豁免；全章/跨范围阻断必须明确复核处置，不能使用 undefined 或缺失标识匹配。至少排除缺失 unitId，再验证保留范围和阻断实际同源；不要扩大为“有任何回退就允许阻断”。补此真实两场的暂停/继续用例及有效 unitId 的正向回退豁免。

## 持续未完成项

- **W6**：将入场引文同时填为 exitAnchorQuote，候选后来明确放下物件，仍返回 evidence/candidate；位置与后续更新验证缺口没有在本轮修改。
- **非模型浏览器作者闭环**：关闭重开、取消继续、再次启动、检查失败不可应用、版本冲突、应用后刷新仍未补齐。
- **真实临时 PG service+engine 中途重建**：诊断、历史调用用量、已接受稿及修复名额不重置的集成断言仍未补齐。仓库契约两分支通过不替代这一项。

这两项集成余项开发者回填也明确承认，不属于本轮排除的 AQ-386 真实模型评测。

## 证据

- [独立探针](evidence/fourth-verification-probes-2026-10-07.ts)
- [观察结果](evidence/fourth-verification-observations-2026-10-07.json)
- [源文件指纹](evidence/fourth-verification-source-manifest-2026-10-07.json)

在 services/api 下运行：

```powershell
node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/fourth-verification-probes-2026-10-07.ts
```

该脚本包含 D1/D2/D3 原反例的正确行为断言，以及 E1/W6 尚存缺陷的观察断言。exit 0 只表示各观察复现成功，不能当完整验收通过。下一步关闭 E1、W6 和非模型集成门禁，再处理 Prompt 设置入口及阶段隔离，最后进行 AQ-386。
