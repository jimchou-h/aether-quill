## Why

现有「文笔优化」强制先生成可编辑优化方案（界面称「方案」，用户口语常叫「大纲」），再据此改写正文。用户已有明确改写要求时，这一步增加一轮等待与确认，却不提供额外价值。需要保留原流程的同时，增加一版 **输入要求 → 直接生成正文** 的路径。

## What Changes

- 文笔优化弹窗增加模式：**方案改写**（现状：要求 → 方案 → 正文）与 **直接改写**（要求 → 正文对比 → 应用）
- 直接改写 **MUST NOT** 调用方案生成接口，**MUST NOT** 向模型注入 `<optimization-plan>`
- 扩展正文 SSE 契约：`rewriteMode=direct` 时 `instruction` 必填、`planText` 可省略；缺省 / `from-plan` 行为不变
- 新增 task prompt `chapter.optimize.direct-draft`（Settings「文笔优化」分组可编辑）；写作档、文风样本注入与现有 `chapter.optimize.draft` 对齐
- 长章仍按现有字数策略分段改写，但不跑方案阶段的 `segment_diagnosis` / `plan_synthesis`；删减字数判定改看 `instruction`

## Non-goals

- 不改「创作精修」流水线（角色/特征/感官大纲 gate、意向书、批量精修）
- 不删除或替换现有方案改写路径
- 不自动覆盖原文（仍须用户确认应用）
- 不改错字检查、终稿合规、Workbench 续写
- 本 change 不引入新错误码段；非法请求沿用现有 400 语义

## Capabilities

### New Capabilities

- `direct-writing-optimize`: 文笔优化直接改写（跳过方案/大纲生成，要求直出正文）

### Modified Capabilities

- （无已归档同名能力；正文 SSE 行为以本 change delta 为准，实现时按 Contract First 改 OpenAPI）

## Impact

- **OpenAPI**：`ChapterOptimizationDraftRequest` 增加 `rewriteMode`；`direct` 时 `planText` 非必填。错误码不新增
- **API / orchestrator**：draft 流按模式选模板与 user prompt；prep `stage` 事件复用现有
- **Frontend**：`ChapterOptimizeDialog` 模式切换与步骤条；步骤视觉纯函数扩展
- **Prompt 治理**：`packages/prompt-templates` + API/orchestrator `task-prompt-defaults` 三处同步
- **Tests**：prompt 拼装、校验、步骤视觉、from-plan 回归
