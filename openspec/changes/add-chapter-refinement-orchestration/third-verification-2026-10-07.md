# 第三轮修复独立复验（2026-10-07）

## 结论

**工程验收仍未通过，但上一轮的主要反例已确认修复。** 最终修复稿被 checkpoint 覆盖、回退坏稿复活、必要输出静默裁剪、未知模型放行、前端类型错误和当前章样本未排除，这六个具体反例本轮都不再成立。

剩余问题集中在三个组合分支：正常 3500 字范围被新预算规则拒绝后直接退回原文；最终 repair-review 的持久化失败没有停止运行；阻断暂停后继续运行，旧 unresolved 问题仍进入可应用终态。末态锚点验证和两项非模型集成验证也仍未闭合。

本轮对照 `closure-verification-2026-10-07.md`、`closure-remediation-2026-10-07.md` 与现行规格复验本地工作树，没有修改产品代码、任务状态或发布状态，没有调用真实模型。AQ-386 仍排除；Prompt 设置入口和项目写作指导阶段隔离继续留待工程验收后处理。

## 门禁与证据

| 项目 | 独立结果 |
|---|---|
| `pnpm -r lint` | PASS |
| `pnpm -r typecheck` | PASS；前端 `persistence_failed` 映射遗漏关闭 |
| `pnpm -r build` | PASS；含 Web、Nest API、Prisma generate、orchestrator 与 worker |
| `pnpm -r test`，Node v20.19.0 / Windows | **1025 PASS / 0 FAIL / 1 SKIP** |
| 测试分包 | API 590 PASS + 1 PG SKIP；orchestrator 182；Web 188；config 47；model-providers 10；worker 8 |
| 真实本地临时 PG 正式仓库测试 | 2 PASS / 0 FAIL / 0 SKIP；Map/PG 两分支，单独运行，不重复累计 |
| `openspec validate add-chapter-refinement-orchestration --strict` | PASS |
| 开发者修复后正向探针 | PASS；独立运行 `closure-remediation-probes-2026-10-07.ts` |
| 本轮独立组合探针 | 复现下文问题；exit 0 表示缺陷复现成功，不表示验收通过 |
| 假模型浏览器作者闭环 | 未完成；开发者最新回填也承认仍待补 |
| 临时 PG 中真实 service/engine 中途重建 | 未完成；仓库 round-trip 不能替代这一验证 |
| GS-R 独立评测与真实模型文学评测 | 本轮未执行；不借用历史评测报告作为本轮 PASS 证据 |

日志：`.scratch/refinement-third-verification/` 下的 `lint.log`、`typecheck.log`、`build.log`、`test.log`、`pg.log`、`developer-probes.log`、`independent-probes.log`、`openspec.log`。PG 仅操作测试生成的随机临时 schema，未修改业务数据。

## 已关闭的具体反例

- **C1 原反例**：带 `onCheckpoint` 时最终 repair 正文保留，最后落库候选与终态一致；repair 失败回退后旧候选不再复活，changes 与正文一致；回退正文上的不可定位阻断现在暂停。
- **C2 原反例**：9000 必要输出超过 8192 单次上限时明确拒绝；已知 provider 下未知 model 返回 null；inspect/plan/review 使用独立结构化输出预算。
- **C3**：新增暂停原因已同步前端，正式全仓 typecheck/build 通过。
- **C4**：真实材料选择方法传入 chapterNo 后排除当前章自身样本，保留来源/分类并使用统一样本选择；冻结模式的文风块仅写作阶段注入。项目长写作指导的阶段隔离仍为后续问题。
- **W6 部分**：未提供末态锚点的入场事实不再确认成当前状态；新增 `exitAnchorQuote`、value 必须落在该锚点内，模板镜像与解析同步。位置验证仍见下文 W6。

不要求重新开发上述已修正的分支。本轮发现的是修复与现有规划、错误处理、续跑状态组合后尚未验证的行为。

## 必须修复

### D1 · P1 / F6：默认范围与新输出硬上限冲突，正常场景根本不改写

位置：`chapter-refinement.types.ts:25`；`chapter-refinement.util.ts:43`、`:149`；`chapter-refinement.engine.ts:1030`、`:1177`、`:1211`。

默认 `rewriteTargetChars=3500`，正文预算按 `ceil(chars*2.5)`，已登记模型输出上限为 8192。3500 字对应必要输出 **8750 token**；在当前配置下，3277 字及以上范围就超过该输出上限。范围规划仍只依据 3500/5200 字常量，没有把冻结模型输出能力纳入安全拆分。

中性单场 fixture 3500 字，冻结 `deepseek/deepseek-chat`，inspect/plan 都成功。观察：

- 实际网关调用只有 `inspect`、`plan`，**rewrite 0 次**。
- 候选逐字等于原文，changes 为空。
- 系统以“必要输出 8750 超过单次上限 8192”为由保留范围，返回 **ready_with_issues**。

拒绝静默裁剪是正确修复；但它和默认规划不匹配，使本来合法的正常范围退化成无改写结果。这不是实际供应商响应、真实模型质量或用户长指导导致的问题。

现有 `chapter-refinement.long-chapter.test.ts:86` 使用 `modelRoute:null` 且没有 modelRoutes，走 65536 默认输出上限的兼容路径；其 1～2 万字通过不能覆盖正式创建 run 的冻结模型能力准入。

修复要求：让安全写作范围规划与冻结模型能力、目标扩写篇幅及真实输出预算一致；只按已验证安全拍边界拆分，不做任意字数截断。不能简单把必要输出重新静默压低。带正式冻结路由补 3500/5200 字场景和 10000/20000 字章节回归，断言实际 rewrite 被调用且明确编辑目标有正文变化；无法安全规划时明确暂停或解释降级，不能用未实际改写的完成状态证明精修可用。

### D2 · P1 / F1：最终 repair-review 的持久化失败被吞成普通回退

位置：`chapter-refinement.engine.ts:1964`、`:1980`、`:1991`。

最终接缝 repair 成功后，review 发起前调用 `commitCheckpoint`。若保存失败，`callModel/callParse` 已返回 `storageFailed`；该分支却只检查 aborted，把其他失败统一归为 repair-review 不通过，然后回退原文并继续。

独立探针：单范围已完成单位 review 和最终 review，最终 repair 成功；下一次 checkpoint 保存注入异常（此后保存均异常）。观察：存储失败 1 次，repair-review 未实际发起，最终仍 **ready_with_issues / pauseReason=null**，正文回退为原文。由于唯一范围已回退，重检队列为空，没有其他调用再触发失败暂停。

这与 F1“未能确认持久化成功必须停止”的合同相反。正文回退并不能消除存储故障或证明新状态已落库。

修复要求：所有调用点统一区分 `storageFailed`、预算/上下文不足、取消、解析失败和普通模型失败。最终 repair-review 遇 storageFailed 立即 paused/persistence_failed，不再继续回退或形成可应用终态。补该探针对应的正式回归，检查真实 service+engine 在保存失败时不发布 ready，不继续消耗名额或报告可恢复进度。

### D3 · P1 / F3+R11：阻断暂停后继续运行仍能带 unresolved 进入可应用终态

位置：`chapter-refinement.engine.ts:732`、`:1880`、`:2054`、`:2062`。

不可定位 hard_constraint/high 现在正确登记 unresolved 并暂停。但 resume 无条件复制旧 issues；即使新一轮最终检查返回无问题，也不把旧阻断处理为 resolved 或仍然暂停。终态选择反而将 `hasBlockingIssues` 映射为 ready_with_issues。

复现：第一次最终 review 返回带修复意图的不可定位高危问题 → paused/boundary_conflict；同一 checkpoint 继续，最终 review 返回空问题 → **ready_with_issues**，issues 仍含原 **hard_constraint/high/unresolved**。

R11 的可应用警告稿明确要求“无未解决的阻断冲突”。不是要求模型永不误报：如果重检已证明旧问题失效，必须显式更新问题结论和证据；如果仍保留为 unresolved，就必须不可应用。

修复要求：问题、检查结论绑定候选 revision/hash；重检后明确关闭已消除/已判误报的旧阻断，其余保持暂停。不要把所有高危 unresolved 当作普通警告稿。补 boundary_conflict 的 cancel/resume/重建、检查通过和仍有阻断两条路径，检查最终问题账本与应用资格一致。

## 仍未闭合的告警与集成门禁

### W6：末态锚点目前仍只是模型自行标注的全文子串

位置：`chapter-refinement.util.ts:1245`。

新增字段改善了合同表达，但程序仍只要求 anchorQuote/exitAnchorQuote 命中候选、value 包含在 exitAnchorQuote 中，没有验证它对应末态位置或后续状态更新。将入场引文“甲拿着钥匙入场”同时填入 exitAnchorQuote，候选后面明确写“散场时把钥匙留在桌上”，仍得到 evidence/candidate。

本轮探针确认这一反例。应将 W6 记部分修复，不能把新增字段本身当末态验证完成。需要末态证据的可验证位置/范围及覆盖或更新规则；无法确认的状态不作为确定末态向下游传播。避免靠固定关键词启发式假装解决语义判断。

### W7：两项非模型验证尚未补齐

1. 假模型浏览器作者闭环：关闭重开、取消继续、再次启动、检查失败不可应用、版本冲突、应用后真实正文刷新。
2. 临时 PG 的真实 service+engine checkpoint 后重建：诊断不重跑、已接受稿恢复、历史调用用量和 repair/seam repair 名额不重置。

开发者最新回填明确仍是遗留；属于 AQ-384/AQ-385，不应等待 AQ-386。PG 仓库测试和 composable 单测分别通过，不代表这两个集成门禁已完成。

## 复现与交接

- [独立探针](evidence/third-verification-probes-2026-10-07.ts)
- [观察结果](evidence/third-verification-observations-2026-10-07.json)
- [源文件指纹](evidence/third-verification-source-manifest-2026-10-07.json)

在 services/api 下：

```powershell
node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/third-verification-probes-2026-10-07.ts
```

本探针断言现存缺陷，修复后应改为断言合同正确行为。建议先关闭 D1（正常场景能实际执行），再关闭 D2/D3（存储失败及恢复后的应用门禁），补 W6/W7。保留本轮通过证据，不再重复宣称整个 F 项已修。当前 tasks 的完成勾选不等于工程验收完成，也不构成真实文学质量证明。
