# 改写保真守卫（信息量／感官密度）—— 问题、修复与待评审点

日期：2026-10-07。状态：已实施（3 处镜像 + 验证脚本），待外部 AI 复核。
关联：tasks.md 4.1 / AQ-383；真实样章验证见 tasks.md「4.1 有限补修、严格流完成与资源预算 — AQ-383（DONE）」下的「AQ-383 真实样章前置验证证据与观察」。

本文件用于让其它 AI 独立判断该修复是否合理，包含现象证据、根因、改动、备选方案与未决问题。

---

## 1. 现象与证据

用中性长章（`.scratch/eval-neutral-long.txt`，10571 字）跑真实精修链路，作者反馈「改写压缩过头」：被改写的范围读起来比原文更薄。

最近一次运行产物（`.scratch/refinement-validation/neutral-long.refinement.meta.json`，2026-10-07 03:08）：

- `sourceChars=10571`，`candidateChars=10183`（整章净减 388 字）。
- 4 个 patch 单位被接受改写，合计改写约 3893 字；其余 keep／未覆盖保留原文。
- 11 条 `issues`（review 阶段警告）。
- 该轮 `instruction.txt` 的【修改权限与篇幅】已明确要求「维持或适当压缩，不得摘要式压缩；信息量与感官密度不得低于原文对应部分」。

即：**用户要求里写了保真约束，模型仍然压薄了**，说明约束没有到达 rewrite 模型。

## 2. 根因

两条链路对照后定位为提示词缺口，不是模型能力问题：

1. **新精修 rewrite 的 system prompt 缺少保真约束。**
   旧「章节优化」链路的正文提示词（`chapter-optimize.util.ts` / `chapter-optimize-workbench.util.ts`）本就带「重写后信息量与感官密度不得低于原文对应部分；禁止摘要式压缩」。新精修的 `CHAPTER_REFINEMENT_REWRITE_SYSTEM_PROMPT` 从样稿落地时漏掉了这一条，只保留了文风类指导。

2. **rewrite 的 user prompt 不携带原始 instruction。**
   `buildRewriteUserPrompt` 只注入 `chapterIntent`、`sceneBrief`（含 `targetLength` 的 hold/expand/condense 与可选字数上下限）、必要事实与原文；用户的「不得摘要式压缩」这类**定性保真要求**在 plan 蒸馏成 brief 时丢失，没有进入正文模型的可见上下文。

   `describeTargetLength` 只输出「保持／扩写／收紧（下限 N，上限 M）」，无法表达「收紧篇幅不得抽薄描写」。

3. 设计文档 `prompt-design.md` §3 已把「用词准确、无套话、无摘要式压缩」列为 rewrite 任务原则，但 §5 的 rewrite 样稿文本未显式包含该条 → 属于**样稿落地遗漏**，不是设计外的临场发明。

## 3. 已实施的修复

在 rewrite 的 system prompt 末行补一条保真守卫，并同步 3 处镜像（内容逐字一致）：

- `services/api/src/modules/projects/chapter-refinement.util.ts`（`CHAPTER_REFINEMENT_REWRITE_SYSTEM_PROMPT`）
- `services/rag-orchestrator/src/generation/task-prompt-defaults.ts`（`chapter.refinement.rewrite`）
- `packages/prompt-templates/src/templates.ts`（`chapterRefinementRewriteTemplate`）

新增文本：

```
重写后本范围的信息量与感官密度不得低于原文对应部分：禁止摘要式压缩，禁止为「更通顺」抽薄描写。收紧篇幅只针对重复、套话与无效修饰，不得删掉承载情节、情绪或感官的具体细节；交底或用户明确要求删除的除外。
```

设计取舍：

- 放在 **system**（而非每次 user）以复用缓存、且是跨范围的全局硬边界，符合 `prompt-design.md` §5「system 保留职责和硬边界」。
- 保留「交底或用户明确要求删除的除外」出口，避免与 `condense` 交底、逐字锁规则打架。
- 不改 `targetLength` 结构，避免扩大 schema 与合同面。

附带修复：`services/api/scripts/refinement-sample-validation.ts` 原按模板 key 记录**首次**成功调用，`planDiagnostics` 会显示首次（违规）plan 而非被采纳的恢复 plan；改为按 key 覆盖（最后一次成功＝被采纳）。

## 4. 备选方案与为何未采用

| 方案 | 说明 | 未采用原因 |
|---|---|---|
| B. 把原始 instruction 注入 rewrite user prompt | 每单位都带用户原文要求 | 与设计「system 硬边界 + brief 交底」分层冲突；每单位重复长文本、放大 token 与越界改写风险 |
| C. 给 `targetLength` 增加 `preserveDensity: boolean` 字段 | 结构化解交底 | 需改 plan 合同／schema／校验与三处镜像，成本高；定性约束用自然语言已足够 |
| D. 在 review/repair 阶段检测压缩并补修 | 事后兜底 | review 只识别「明显改坏」，不度量信息量；无法覆盖 review 未报的轻度压薄，且属 4.1 repair 范围 |

## 5. 待其它 AI 复核的问题

1. **该守卫是否算「程序无法保证的文学验收合同」？** `prompt-design.md` §7 警示不要把用户长指导当成文学验收合同。本守卫是模型侧提示而非程序断言，是否越界？
2. **只加 system 约束、不给 rewrite 传 instruction，是否足够？** 还是应把 instruction 的【必须保留】/【篇幅】片段结构化注入？
3. **`condense` 交底与本守卫的优先级**：当 plan 明确要求 condense 时，模型可能仍保守不压。是否需要「交底要求压缩时以交底为准」的更显式措辞？
4. **是否需要程序侧量化门禁**（如改写后长度／句数低于原文某比例即警告），还是维持纯提示词约束？

## 6. 验证方式

- 单测：`services/api` 下 `node --import tsx --test --test-force-exit src/modules/projects/chapter-refinement.util.test.ts`；镜像同步守卫 `src/modules/task-prompts/refinement-task-prompt-sync.test.ts`（新增，断言五个精修模板在 util／白名单／orchestrator／prompt-templates 四处逐行一致，并单独断言本守卫行三处都在）。
- 端到端：`services/api/scripts/refinement-sample-validation.ts --link=both`，对照新旧链路的 `candidateChars`／改写单位长度与人工阅读。
- 真实效果以 4.1 / 7.1 的长章评测为准；本轮仅为修复落地与复跑确认。

## 7. 复跑证据（2026-10-07，修复后）

同一中性长章（10571 字）、同一 instruction、同一 `deepseek-v4-flash` 档位：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| candidateChars | 10183（−3.7%） | 10723（+1.4%） |
| 改写部分净变化 | 3893 → 3505（**−10.0%**） | 2292 → 2444（**+6.6%**） |
| retainedOriginalChars | 6678 | 8279 |
| 模型调用 | 17 | 12 |
| issues | 11 | 9 |

结论：改写方向由「净压缩」转为「持平／略扩」，与守卫意图一致。

**必须声明的局限**：两次运行的 plan 不同（写作单位 10 vs 7、被采纳场景不同），属单次运行对比，**不是受控 A/B**；因此上表只能作为方向性证据，不能当作因果定论。

顺带观察（对本修复的交叉验证，也是 AQ-383 的正向证据）：

- 修复后这一轮 plan 产出了非空 `protectedSpanIds`，**逐字锁分支首次真正执行**。其中 2 个单位的改写丢失了锁定段落，被程序门禁判 `quote_missing` 并保留原文——门禁按预期拦住，未静默放行。
- 修复前那一轮 plan 的 `protectedSpanIds` 全空，同一锁定段落（如「他翻开正文，第一页的右下角…」）在候选稿里**确实丢失**。两轮对照说明：锁生效与否，直接决定这些段落保不保住，与密度守卫是两套独立保护。
- 本样章 0 个直引号／308 个弯引号，故本轮的 `quote_missing` **不是**引号字形误杀，是模型真的改写了锁定文本。tasks.md 中「门禁是否要做字形无关匹配」的待定项依然独立存在。

