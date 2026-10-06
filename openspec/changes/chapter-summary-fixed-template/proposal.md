## Why

章节摘要 prompt 要求自由散文却又列多项内容，模型常自造小标题，与 fallback 正文截断格式不一致；注入与向量记忆按整段字符串消费，不稳定长摘要浪费 token。需要固定短模板以服务跨章连续性。

## What Changes

- LLM 摘要改为固定三行标签模板（情节 / 人物 / 未收线），目标约 180~280 字
- 生成后规范化校验；不合规则回退 fallback
- fallback 改为同模板结构（情节取正文短摘，人物/未收线标「待补全」），不再裸截断冒充语义摘要
- 共享规范化逻辑放入 `@aether-quill/config`

## Non-goals

- 不改摘要 API 合同字段（仍为单一 `summary` 字符串）
- 不批量重生成历史摘要
- 不做 JSON 结构化落库字段
- 不改摘要注入条数 / 记忆检索策略

## Capabilities

### New Capabilities

- `chapter-summary-template`: 固定标签摘要模板、规范化与 fallback 形态

### Modified Capabilities

- `chapter-summary-on-save`: fallback 由「正文截断」改为「同模板规则摘要」

## Impact

- `packages/config`：新增 chapter-summary 工具
- `services/rag-orchestrator`：`buildChapterSummaryPrompt` / `summarizeChapterContent`
- `services/api`：`buildFallbackChapterSummary` 与相关单测
- OpenAPI / 错误码：无变更
