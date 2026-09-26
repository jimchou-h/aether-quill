## ADDED Requirements

### Requirement: Auto-loop mode entry and round budget

文笔优化 MUST 提供第三种改写模式 `auto-loop`，与 `from-plan` / `direct` 并列。用户 MUST 能设置轮数上限，范围 1～5，默认 2；浏览器 MUST 记住上次选择。选择 `auto-loop` MUST NOT 改变 `from-plan` / `direct` 两条路径的任何行为。
#### Scenario: Default round budget is two

- **WHEN** 用户在未保存过偏好的浏览器首次切�?`auto-loop`
- **THEN** 轮数上限 MUST �?2

#### Scenario: Existing modes unaffected

- **WHEN** 用户选择 `from-plan` �?`direct`
- **THEN** 请求�?MUST NOT 携带 auto-loop 字段，且步骤条与生成行为 MUST 与本变更前一�?
### Requirement: Plan round diagnoses the current draft

每一轮的方案 MUST �?*当前最新稿**为诊断对象：�?1 轮为入库章节正文，第 2 轮起 MUST 为上一轮的成稿。复�?MUST 同时收到原始 `instruction` 与上一轮条目及其最终状态。方�?MUST NOT 输出章节正文�?
#### Scenario: Second round diagnoses the first round output

- **WHEN** 轮数上限�?2 且第 1 轮已产出成稿
- **THEN** �?2 轮复诊的输入正文 MUST 为第 1 轮成稿，MUST NOT 为入库原�?
#### Scenario: Original instruction is restated every round

- **WHEN** 进入�?2 轮复�?- **THEN** 提示 MUST 仍包含原�?`instruction`，并 MUST 包含上一轮各条目的最终状�?
### Requirement: Paragraph anchoring with index and quote

后端 MUST 按空行切分正文、从 1 开始编号，并以带编号形式提供给模型。方案每一条目 MUST 同时给出 `paragraphIndex` �?`anchorQuote`。二者不一致时系统 MUST 先以 `anchorQuote` 做归一化模糊匹配挽救；匹配到唯一段落则以引文为准，条目状�?MUST �?`relocated`。匹配不到或匹配到多处时该条�?MUST 被跳过、状态为 `skipped_unlocatable`，且 MUST 在轮次结果中计数并对用户可见。系�?MUST NOT 在定位失败时按可疑编号改写，�?MUST NOT 静默丢弃条目�?
#### Scenario: Quote rescues a wrong index

- **WHEN** 条目声明 `paragraphIndex` �?12，但�?`anchorQuote` 只唯一出现在第 14 �?- **THEN** 系统 MUST 改写�?14 段，条目状�?MUST �?`relocated`

#### Scenario: Unlocatable item is surfaced, not silently dropped

- **WHEN** 条目�?`anchorQuote` 在全章匹配不到，或匹配到多个段落
- **THEN** 该条�?MUST NOT 触发任何改写，状�?MUST �?`skipped_unlocatable`，且 MUST 计入本轮 `unlocatableCount`

### Requirement: Local segment rewrite only

改写提示 MUST 提供目标段之前与之后各约 2000 字的只读原文，供判断前后情节；MUST NOT 把这些只读块当作可改写正文。扩写 MUST 只加深本段已有动作、感官与情绪，MUST NOT 提前写下后文情节。

正文�?MUST 只重写被命中的段落；未命中段�?MUST 原样保留�?MUST NOT 经过模型。同一段落被多条命中时 MUST 合并为一次改写。一个段落槽�?MAY 产出多个段落，但 MUST NOT 跨槽位合并。单轮命中段落数 MUST NOT 超过 `min(12, max(3, floor(总段�?× 0.35)))`；超出部�?MUST �?`severity` 降序、`paragraphIndex` 升序截断，被截断条目状�?MUST �?`deferred`�?
#### Scenario: Untouched paragraphs are byte-identical

- **WHEN** 本轮仅命中第 3 段与�?7 �?- **THEN** 成稿中除�?3�? 段外的所有段�?MUST 与输入稿逐字节相�?
#### Scenario: Cap prevents degenerating into full rewrite

- **WHEN** 正文�?10 段而方案给�?9 条分布在 9 个不同段落的条目
- **THEN** 本轮实际改写段落�?MUST NOT 超过 3，其余条目状�?MUST �?`deferred`

#### Scenario: Rewrite sees about two thousand characters on each side

- **WHEN** 自动循环改写第 2 段，且其后还有第 3、第 4 段
- **THEN** 改写提示 MUST 包含第 2 段之前与之后合计各不超过约 2000 字的只读原文，且 MUST 包含第 3 段之后仍在预算内的后文

#### Scenario: Multiple items on one paragraph merge into one rewrite

- **WHEN** 两条条目都指向第 5 段
- **THEN** 系统 MUST 对第 5 段只发起一次改写，且该次改写 MUST 同时包含两条指令

#### Scenario: Whole-paragraph deletion drops the slot without calling rewrite

- **WHEN** 命中段的全部条目指令为删除整段/整句（如「删除[183]整句，使[182]衔接[184]」或「删除第36段整段」）
- **THEN** 系统 MUST 抽掉该段槽位使前后段直接衔接，MUST NOT 调用改写模型，MUST NOT 将空输出报成「模型未返回正文」，条目状态 MUST 为 `deleted`

#### Scenario: Merge-into-neighbor instruction drops the source slot

- **WHEN** 命中段第 3 段的指令为「将3段与2段合并，删除本段比喻」
- **THEN** 系统 MUST 抽掉第 3 段槽位、MUST NOT 调用改写模型，第 2 段 MUST 保持原文，条目状态 MUST 为 `deleted`

#### Scenario: Merge instruction on the keeper still rewrites

- **WHEN** 命中段第 2 段的指令为「将3段与2段合并，2段保留现有触感」
- **THEN** 系统 MUST 仍走第 2 段改写，MUST NOT 抽掉第 2 段

#### Scenario: Partial deletion still rewrites

- **WHEN** 条目指令是「删除这句里的成语」而非删除整段
- **THEN** 系统 MUST 仍走段落改写，MUST NOT 抽槽

### Requirement: Layered quality gate

段级校验 MUST 拒绝空输出、占位语、Markdown 包裹或说明性开头；MUST NOT 因替换段比原段更长或更短而失败。失败时 MUST 只把该段回滚为原文、状态为 `rolled_back`，MUST NOT 影响同轮其他段落。章级校验 MUST 以入库原文为基准，只检查下限（默认 80%，`instruction` 明确允许删减时放宽至 60%）；MUST NOT 因成稿长于原文而整轮回滚。

#### Scenario: One bad segment does not sink the round

- **WHEN** 第 3 段替换文本以「以下是修改后的段落：」开头
- **THEN** 第 3 段 MUST 回滚为原文且状态为 `rolled_back`，第 7 段的改写 MUST 保留

#### Scenario: Expansion is accepted at both gates

- **WHEN** 某段从 65 字扩写到 195 字，或本轮成稿达到入库原文的 200%
- **THEN** 段级与章级校验 MUST 通过，MUST NOT 因此回滚

#### Scenario: Chapter-level floor still blocks accidental wipe

- **WHEN** 本轮成稿总字数低于入库原文的 80%，且 `instruction` 未允许删减
- **THEN** 本轮 MUST 整轮回滚到上一轮成稿，`rolledBack` MUST 为 true

### Requirement: Convergence and early exit

方案每一条目 MUST 带 `severity`，取值 `high` / `medium` / `low`；`severity` 解析 MUST 容忍常见中文档位与大小写差异。当某轮复诊未产出任何 `high` 或 `medium` 条目**且该轮无任何条目被丢弃**时，系统 MUST NOT 再进入下一轮，并 MUST 标记 `converged`——仅剩 `low`（轻微）或空条目才可收工。轮数上限 MUST 始终作为硬上界生效，即使仍有 `high` 或 `medium` 条目也 MUST 停止。

#### Scenario: Only low severity items ends the loop early

- **WHEN** 轮数上限为 3，第 2 轮复诊只产出 `low` 条目
- **THEN** 系统 MUST NOT 发起第 3 轮，`converged` MUST 为 true

#### Scenario: Medium severity items continue the loop

- **WHEN** 轮数上限为 3，第 1 轮复诊产出 `medium` 条目
- **THEN** 系统 MUST 发起第 2 轮，`converged` MUST 为 false

#### Scenario: Budget caps an unconverged loop

- **WHEN** 轮数上限�?2，第 2 轮仍产出 `high` 条目
- **THEN** 系统 MUST 在第 2 轮结束后停止，`converged` MUST �?false

#### Scenario: Discarded items block a convergence claim

- **WHEN** 某轮有条目因结构不合法被丢弃，且存活条目中没有 `high`
- **THEN** 系统 MUST NOT 标记 `converged`，因为被丢弃的条目可能正是 `high`；循环 MUST 在轮数预算内继续

#### Scenario: Every item discarded is a contract failure, not convergence

- **WHEN** 某轮复诊输出可解析为 JSON，但其中每一条目都因缺少定位信息或严重度不可识别而被丢弃
- **THEN** 系统 MUST 以 `plan_parse_failed` 终止并保留当前稿，MUST NOT 标记 `converged`，且 MUST NOT 向用户显示"未发现严重问题"

### Requirement: Live item visibility and stop-and-accept

系统 MUST 在每轮复诊结束后立即把该轮全部条目推送给前端，并在每条处理完成后回填其最终状态。用�?MUST 能在循环进行中随时停止；停止�?MUST 保留最近一次已完成轮次的成稿并允许直接进入对比与应用。停�?MUST NOT 丢弃已完成轮次的结果�?
#### Scenario: Items stream before rewriting starts

- **WHEN** 某轮复诊产出 7 条条�?- **THEN** 系统 MUST 在开始逐段改写前推送这 7 条，并在每条处理后推送其状�?
#### Scenario: Stopping keeps the last completed round

- **WHEN** 用户在第 2 轮改写中途点击停止，而第 1 轮已成功产出成稿
- **THEN** 系统 MUST 保留�?1 轮成稿并允许应用，MUST NOT 回退到入库原�?
### Requirement: Round session recovery

后端 MUST 为进行中的自动优化保留会话，含各轮条目、各轮成稿与基线 `updatedAt`，并 MUST 提供查询接口供前端在刷新或误关弹窗后恢复。会�?MAY �?TTL 后过期；过期或不存在时前�?MUST 退回到全新开始，MUST NOT 报错阻断�?
#### Scenario: Refresh restores the latest completed round

- **WHEN** 用户在第 2 轮跑完后刷新页面并重新打开文笔优化
- **THEN** 系统 MUST 能恢复出�?2 轮成稿与两轮的条目列�?
#### Scenario: Expired session degrades gracefully

- **WHEN** 会话已过 TTL
- **THEN** 查询 MUST 返回空会话语义，前端 MUST 呈现为可全新开始，MUST NOT 展示错误

### Requirement: Resume from failure without discarding progress

当循环因复诊无法解析、改写中途中断或用户停止而结束时，系统 MUST 在会话中保留可续跑断点：已完成轮次的成稿 MUST 保留；若中断发生在逐段改写中，MUST 记住尚未改写的段落。一轮改写全部完成并进入下一轮复诊前，会话 MUST 已包含该轮成稿，MUST NOT 把刚完成的一轮写成未发生。前端 MUST 提供从该断点继续的入口，且文案 MUST 区分「下一轮复诊」与「本轮剩余段落」。带 `resume: true` 的请求 MUST 从断点继续，MUST NOT 从入库原文重跑已完成轮次，MUST NOT 重做已经改写成功的段落。没有可续跑会话时，`resume: true` MUST 被拒绝，MUST NOT 静默当成全新开始。

复诊 JSON 部分损坏时，解析器 MUST 尽量救出仍合法的条目并继续本轮，MUST NOT 因单条字段漏引号而把整份方案判死。

#### Scenario: Broken item id does not sink the round

- **WHEN** 复诊 JSON 中某条 `id` 漏了收尾引号，但其余条目合法
- **THEN** 系统 MUST 解析出其余合法条目并继续改写，MUST NOT 以 `plan_parse_failed` 结束整轮

#### Scenario: Parse failure can retry the same diagnose round

- **WHEN** 第 2 轮复诊两次都无法解析，而第 1 轮已产出成稿
- **THEN** 会话 MUST 标记可从第 2 轮复诊继续，且 MUST 保留第 1 轮成稿

#### Scenario: Mid-round abort resumes remaining segments

- **WHEN** 用户在第 5 轮改写到第 9/10 段时停止
- **THEN** 再次 `resume` MUST 从第 9 或第 10 段继续改写，MUST NOT 重做本轮已成功的段落，MUST NOT 丢弃第 1～4 轮成稿

#### Scenario: Completed round is persisted before next diagnose

- **WHEN** 第 1 轮改写已完成、第 2 轮复诊尚未返回
- **THEN** 查询会话 MUST 包含第 1 轮成稿，MUST NOT 把最终稿写成入库原文

### Requirement: Configurable loop task prompts

系统 MUST 新增两个可在 Settings 编辑�?task prompt：`chapter.optimize.loop.plan` �?`chapter.optimize.loop.draft`，且 MUST 落入现有「文笔优化」分组。二�?MUST 支持既有的草�?/ 发布 / 回滚 / 恢复仓库默认能力。默认文�?MUST �?util 运行时种子、API 白名单与 orchestrator 兜底三处保持一致。`chapter.optimize.loop.draft` MUST 纳入写作风格样本注入白名单，`chapter.optimize.loop.plan` MUST NOT�?
#### Scenario: Loop prompts appear in the writing group

- **WHEN** 用户打开 Settings �?task prompt 配置
- **THEN** 两个 loop prompt MUST 出现在「文笔优化」分组内，并 MUST 可保存草稿与发布

#### Scenario: Style samples inject into draft but not plan

- **WHEN** 项目已配置写作风格样本且循环正在运行
- **THEN** 风格样本 MUST 注入 `chapter.optimize.loop.draft` 的提示，MUST NOT 注入 `chapter.optimize.loop.plan`

### Requirement: Apply with optimistic lock

应用成稿 MUST 复用现有章节优化应用接口，MUST 携带 `expectedChapterUpdatedAt`，且 MUST 仍需用户确认。若章节在循环期间被他处修改，系�?MUST 返回既有版本冲突错误�?1307，并 MUST 保留本次成稿供用户人工比对，MUST NOT 静默覆盖�?
#### Scenario: Concurrent edit surfaces 1307 without losing work

- **WHEN** 循环运行期间该章节被其他入口修改，用户随后点击应�?- **THEN** 系统 MUST 返回错误�?1307，且 MUST 保留本次成稿供人�?diff，MUST NOT 覆盖他人改动
