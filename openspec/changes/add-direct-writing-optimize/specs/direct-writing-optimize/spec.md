## ADDED Requirements

### Requirement: Direct rewrite mode skips plan generation

文笔优化 MUST 提供「直接改写」模式。该模式下，用户提交非空 `instruction` 后，系统 MUST 直接启动正文生成；MUST NOT 调用方案生成接口（`chapter-optimize-plan`）；MUST NOT 要求用户确认优化方案。现有「方案改写」路径 MUST 保持可用且默认行为不变。

#### Scenario: User generates body from instruction only

- **WHEN** 用户在文笔优化弹窗选择「直接改写」，填写非空优化要求并触发生成
- **THEN** 系统 MUST 开始流式生成优化正文，MUST NOT 先展示或生成优化方案

#### Scenario: Plan-based flow remains available

- **WHEN** 用户选择「方案改写」并填写非空优化要求
- **THEN** 系统 MUST 仍先生成可编辑优化方案，确认后再生成正文（与本 change 之前行为一致）

### Requirement: Direct draft request contract

`POST .../chapters/{chapterNo}/optimize/draft` MUST 接受 `rewriteMode`：`from-plan` | `direct`。省略时 MUST 视为 `from-plan`。`rewriteMode=direct` 时 `instruction` MUST 非空，`planText` MAY 省略或为空；系统 MUST 将 `instruction` 作为改写依据注入 user prompt，MUST NOT 注入 `<optimization-plan>`。`rewriteMode=from-plan` 时 `planText` 与 `instruction` MUST 均非空（与现状一致）。非法组合 MUST 返回 400，且 MUST NOT 新增错误码。

#### Scenario: Direct mode accepts instruction without planText

- **WHEN** 客户端以 `rewriteMode=direct` 且非空 `instruction`、无 `planText` 请求正文流
- **THEN** 系统 MUST 接受请求并开始 SSE 正文生成

#### Scenario: From-plan mode still requires planText

- **WHEN** 客户端省略 `rewriteMode` 或传 `from-plan`，且 `planText` 为空
- **THEN** 系统 MUST 拒绝请求（400），MUST NOT 开始生成

#### Scenario: Direct prompt does not include optimization plan

- **WHEN** 系统以直接改写模式组装 draft user prompt
- **THEN** 提示中 MUST 包含用户 `instruction` 与原文 `<chapter-original>`，MUST NOT 包含 `<optimization-plan>`

### Requirement: Direct rewrite UI steps and apply gate

直接改写模式下，弹窗步骤 MUST 为「优化要求 → 正文对比」，MUST NOT 展示待确认的方案步骤。正文生成过程 MUST 复用现有 SSE 中断与章节页 AI 活动条。未确认应用前 MUST NOT 覆盖章节原文。正文对比步 MUST 提供返回修改要求与重新生成；MUST NOT 提供「返回方案」。

#### Scenario: Stepper has two steps in direct mode

- **WHEN** 用户处于直接改写模式且尚未生成正文
- **THEN** 步骤条 MUST 显示优化要求与正文对比，MUST NOT 显示「优化方案」为必经步骤

#### Scenario: Apply still requires confirmation

- **WHEN** 直接改写已生成可编辑正文但用户尚未点击应用
- **THEN** 章节原文 MUST 保持不变

#### Scenario: Interrupt works during direct draft

- **WHEN** 直接改写正文 SSE 正在进行
- **THEN** 用户 MUST 能从活动条或弹窗中断控件停止生成

### Requirement: Long chapter direct rewrite without plan diagnosis

直接改写遇到超字数章节时，系统 MAY 按现有分段字数策略分段生成并合并；MUST NOT 执行方案阶段的 `segment_diagnosis` 或 `plan_synthesis`。合并后的字数/删减校验 MUST 依据 `instruction`（而非 `planText`）判断是否允许压缩篇幅。

#### Scenario: Segmented direct rewrite skips plan diagnosis stages

- **WHEN** 章节触发分段策略且 `rewriteMode=direct`
- **THEN** SSE 过程 MUST NOT 发出 `segment_diagnosis` 或 `plan_synthesis` 阶段；MUST 仍可发出正文相关 `draft_segment` / `merge_validation`（若走分段）

#### Scenario: Reduction allowance reads instruction in direct mode

- **WHEN** 直接改写的 `instruction` 含明确删减/压缩篇幅意图，且合并正文短于原文 95%
- **THEN** 质量校验 MUST NOT 仅因字数不足而失败

### Requirement: Direct draft prompt is configurable

系统 MUST 将直接改写登记为独立 task prompt（`chapter.optimize.direct-draft`），出现在项目 Settings「文笔优化」分组，默认可编辑、可发布。该模板 MUST 走写作档模型路由，并 MUST 与 `chapter.optimize.draft` 一样注入文风样本（若项目已配置）。仓库默认文本 MUST 在 prompt-templates 与 API / orchestrator 运行时默认三处保持一致。

#### Scenario: Settings lists direct-draft prompt under writing optimize

- **WHEN** 用户打开项目任务 Prompt 设置
- **THEN** 「文笔优化」分组 MUST 包含直接改写正文对应条目

#### Scenario: Writing style sample injects into direct draft

- **WHEN** 项目已配置文风样本且运行直接改写
- **THEN** 系统 MUST 按写作类 draft 规则注入样本，不得因新 templateKey 而跳过
