## Why

“直接改写”使用 DeepSeek V3 Pro 时可能显示未写完的正文为成功。真实调用链已复现两种情况：供应商返回 `finish_reason=length`，或 SSE 在 `[DONE]` 前结束；编排服务当前仍将非空内容标记为完成，API 因而可能交付残稿。

## What Changes

- 编排服务仅在供应商流正常完成时报告成功；明确的长度截断和缺少完成标记均报告生成失败。
- API 读取编排服务 SSE 时，缺少终止 `end` 事件不得将已有片段当作完整成稿。
- 直接改写遇到截断时沿用现有失败处理，保留此前成功的草稿，不显示“优化正文已生成”，也不将残稿误认为完整结果。
- AQ-394：修复跨生成块的段界在流式预览中丢失；后续块首次输出内容前同步双换行，成功结束始终回传最终完整正文，兼容共用链路的方案改写。

## Capabilities

### New Capabilities

- `direct-rewrite-completeness`: 直接改写的流式完成判定。

### Modified Capabilities

- 无；沿用现有 SSE `error` 事件及 trace 状态。

## Non-goals

- 不自动续写或静默拼接残稿；不调整创作提示词、模型选择或分段边界。

## Impact

- `services/rag-orchestrator` 供应商流结束判定；`services/api` 编排服务 SSE 消费与错误传播；定向回归测试。
- 沿用现有接口合同和错误事件，无新增字段、错误码或配置。
- AQ-394 补齐现有 `end.finalDraftText` 字段的成功必传语义；现有前端已支持全文替换，无需新增事件或前端协议分支。
