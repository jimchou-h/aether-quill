## ADDED Requirements

### Requirement: Lab opens only from an auto-loop diagnose round

自动优化弹窗 MUST 在已结束诊断轮提供「调诊断 Prompt」入口。第一期 MUST NOT 提供「调改写 Prompt」，MUST NOT 在续写、合规或流水线提供实验室入口。打开实验室 MUST 加载该轮冻住的 user 拼装稿（只读），以及可编辑的项目 system 与诊断任务 Prompt（`chapter.optimize.loop.plan`）。

#### Scenario: Diagnose entry binds to that round's call

- **WHEN** 用户在第 1 窗第 2 轮点「调诊断 Prompt」
- **THEN** 实验室 MUST 展示该轮复诊的 user 拼装稿，MUST NOT 展示其他轮的 user 拼装稿

#### Scenario: Rewrite lab entry is absent

- **WHEN** 用户查看一条状态为已改写的条目
- **THEN** 系统 MUST NOT 展示「调改写 Prompt」

### Requirement: Replay freezes user input and evidence, overrides two prompt layers

「用这次输入重跑」MUST 使用快照中的 user 拼装稿与 `frozenRetrievedEvidence`。MUST 使用诊断编辑器作为任务 `systemPromptOverride`。若项目 system 编辑器有内容，MUST 以 `projectSystemPromptOverride` 替换本次请求的项目 `systemPromptText`，MUST NOT 改仓库全局默认。重跑 MUST NOT 重新检索。重跑结果 MUST 只出现在实验室对照区。系统 MUST NOT 因此修改章节正文、时间线条目或可应用成稿。

#### Scenario: Replay does not write the chapter

- **WHEN** 用户改了诊断 Prompt 并点重跑，得到与原诊断不同的文本
- **THEN** 对照区 MUST 显示新诊断输出，章节预览与 apply 目标 MUST 仍为重跑前的循环成稿

#### Scenario: Replay does not re-retrieve

- **WHEN** 快照含非空 `frozenRetrievedEvidence` 且知识库在重跑前被改过
- **THEN** 重跑注入的检索证据 MUST 与快照逐字节相同

### Requirement: Chat suggests a layer but writes only on author click

实验室对话 MUST 根据冻输入、原输出、最新重跑（若有）、当前项目 system、当前诊断 Prompt 与作者评点，返回 `suggestedLayer`（`project_system` 或 `diagnose`）、`suggestedText` 与 `rationale`。对话 MUST NOT 直接生成章节正文，MUST NOT 自动写入任一编辑器，MUST NOT 自动重跑或发布。作者点「写入项目 system」或「写入诊断 Prompt」后，系统 MUST 把 `suggestedText` 写入对应编辑器后停止。

#### Scenario: Critique does not touch editors until click

- **WHEN** 作者发送「别再抓语气，要抓动作节奏」且顾问返回建议
- **THEN** 系统 MUST 展示建议层与理由，MUST NOT 改编辑器；作者再点「写入诊断 Prompt」后该编辑器 MUST 变为建议全文

#### Scenario: Chat sees original and latest replay

- **WHEN** 对照区已有一次重跑结果，作者再发评点
- **THEN** 顾问输入 MUST 同时包含原输出与最新重跑，并 MUST 标明二者

### Requirement: Save and publish stay explicit and do not hijack the open loop

抽屉 MUST 为项目 system 与诊断 Prompt 分别提供「保存草稿」与「发布」。保存 MUST NOT 改变已发布稿。诊断 Prompt 发布 MUST 走现有任务 Prompt 版本机制。项目 system 发布 MUST 走现有系统提示词机制，并 MUST 单独确认：发布后本项目所有生成都会使用新 system。已打开的这一轮自动循环 MUST NOT 改用刚发布的任一 Prompt。

#### Scenario: Publish does not rewrite the open loop

- **WHEN** 用户在抽屉里发布了新的诊断 Prompt，而当前弹窗里的循环已经跑完
- **THEN** 时间线条目与成稿 MUST 保持不变；新 Prompt MUST 只在之后新开的自动优化中生效

#### Scenario: Save draft is not publish

- **WHEN** 用户只保存诊断 Prompt 草稿、未点发布
- **THEN** 下一次新开的自动优化 MUST 仍使用此前已发布（或仓库默认）的诊断任务 Prompt

#### Scenario: System publish warns it affects all generation

- **WHEN** 用户点项目 system 的「发布」
- **THEN** 系统 MUST 先确认会影响本项目所有生成，确认后才发布
