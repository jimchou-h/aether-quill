## ADDED Requirements

### Requirement: Optimize prep stages visible as progress

写作优化（方案 / 正文）在发出 LLM `start` 或首包 content 之前，系统 MUST 通过 SSE `stage` 事件向客户端报告准备阶段，至少包含：`syncing_context`（同步项目上下文）、`retrieving`（检索知识）、`waiting_llm`（等待模型开始流式输出）。前端 MUST 将上述阶段映射为可读文案与进度条（步骤或百分比），避免用户在长时间准备期看不到进度。

#### Scenario: Plan generation shows prep progress before start

- **WHEN** 用户触发写作优化「生成方案」
- **THEN** 在收到 `event:start` 之前，客户端 MUST 至少收到一次准备阶段 `stage`（如 `syncing_context` 或 `retrieving`），且活动条/进度条 MUST 更新为对应可读说明

#### Scenario: Progress bar advances across prep stages

- **WHEN** 准备阶段依次经过同步上下文 → 检索 → 等待模型
- **THEN** 进度展示 MUST 前进（步骤序号或百分比上升），MUST NOT 长时间停留在无进度的空白态
