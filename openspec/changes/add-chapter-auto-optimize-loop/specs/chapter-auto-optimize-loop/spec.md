## ADDED Requirements

### Requirement: Auto-loop mode entry and round budget

文笔优化 MUST 提供第三种改写模�?`auto-loop`，与 `from-plan` / `direct` 并列。用�?MUST 能设置轮数上限，范围 1�?，默�?2；浏览器 MUST 记住上次选择。选择 `auto-loop` MUST NOT 改变 `from-plan` / `direct` 两条路径的任何行为�?
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

正文�?MUST 只重写被命中的段落；未命中段�?MUST 原样保留�?MUST NOT 经过模型。同一段落被多条命中时 MUST 合并为一次改写。一个段落槽�?MAY 产出多个段落，但 MUST NOT 跨槽位合并。单轮命中段落数 MUST NOT 超过 `min(12, max(3, floor(总段�?× 0.35)))`；超出部�?MUST �?`severity` 降序、`paragraphIndex` 升序截断，被截断条目状�?MUST �?`deferred`�?
#### Scenario: Untouched paragraphs are byte-identical

- **WHEN** 本轮仅命中第 3 段与�?7 �?- **THEN** 成稿中除�?3�? 段外的所有段�?MUST 与输入稿逐字节相�?
#### Scenario: Cap prevents degenerating into full rewrite

- **WHEN** 正文�?10 段而方案给�?9 条分布在 9 个不同段落的条目
- **THEN** 本轮实际改写段落�?MUST NOT 超过 3，其余条目状�?MUST �?`deferred`

#### Scenario: Multiple items on one paragraph merge into one rewrite

- **WHEN** 两条条目都指向第 5 �?- **THEN** 系统 MUST 对第 5 段只发起一次改写，且该次改�?MUST 同时包含两条指令

### Requirement: Layered quality gate

段级校验 MUST 检查替换段字数处于原段 50%�?50% 之间，且 MUST 拒绝含占位语、Markdown 包裹或说明性开头的输出；失败时 MUST 只把该段回滚为原文、状态为 `rolled_back`，MUST NOT 影响同轮其他段落。章级校�?MUST �?*入库原文**为基准，要求本轮成稿总字数处�?90%�?50%（`instruction` 明确允许删减时下限放宽至 60%）；越界�?MUST 整轮回滚到上一轮成稿并终止循环�?
#### Scenario: One bad segment does not sink the round

- **WHEN** �?3 段替换文本以「以下是修改后的段落：」开�?- **THEN** �?3 �?MUST 回滚为原文且状态为 `rolled_back`，第 7 段的改写 MUST 保留

#### Scenario: Chapter-level drift rolls back the whole round

- **WHEN** 本轮成稿总字数达到入库原文的 160% �?`instruction` 未允许扩写至�?- **THEN** 本轮 MUST 整轮回滚到上一轮成稿，`rolledBack` MUST �?true，且循环 MUST 终止

#### Scenario: Chapter-level baseline is the stored chapter

- **WHEN** 已跑�?2 轮，每轮相对上一轮各增长 20%
- **THEN** 章级校验 MUST 以入库原文而非上一轮成稿为基准，因�?MUST 判定越界

### Requirement: Convergence and early exit

方案每一条目 MUST �?`severity`，取�?`high` / `medium` / `low`。当某轮复诊未产出任�?`high` 条目时，系统 MUST NOT 再进入下一轮，�?MUST 标记 `converged`。轮数上�?MUST 始终作为硬上界生效，即使仍有 `high` 条目�?MUST 停止�?
#### Scenario: No high severity items ends the loop early

- **WHEN** 轮数上限�?3，第 2 轮复诊只产出 `medium` �?`low` 条目
- **THEN** 系统 MUST NOT 发起�?3 轮，`converged` MUST �?true

#### Scenario: Budget caps an unconverged loop

- **WHEN** 轮数上限�?2，第 2 轮仍产出 `high` 条目
- **THEN** 系统 MUST 在第 2 轮结束后停止，`converged` MUST �?false

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
