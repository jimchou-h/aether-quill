## Context

直接改写经过 Web → API `optimizeChapterDraftStream` → orchestrator `generateStream` → SiliconFlow OpenAI 兼容 SSE。编排服务已经解析 `finish_reason` 并写入 trace，却没有在成功前检查；其内部供应商流在缺少 `[DONE]` 时也自然返回。API 已记录是否看到编排服务 `end`，但生成正文时未使用该判定。

## Decisions

1. 在真实调用边界验收供应商完成状态：`length`、`content_filter` 等非正常结束原因转为错误；无 `[DONE]` 的提前关闭转为错误。正常 `stop` 加 `[DONE]` 成功。中断继续沿用现有取消行为。
2. API 的正文 SSE 消费需要终止 `end`；仅有内容或仅有连接关闭不足以返回成功。既有 `error` 事件继续向前端传播。
3. 失败流沿用现有前端处理：恢复此前成功草稿，保留错误信息，不发出成功终态；不在未知截断点自动接写，以免制造重复、遗漏或状态冲突。
4. trace 落盘保存短小的 `finishReason` 元数据，供之后区分长度截断与其他失败；不落盘模型正文。
5. AQ-394：块间空行由 API 在第二块及后续块第一次非空内容前流出，不在块开始或尚无内容时预写。成功 `end` 始终包含后端校验及后处理后的 `finalDraftText`，前端使用已有替换逻辑校准首尾空白。失败流继续只发错误，不发成功终态。此修复同时适用于直接改写和方案改写，不锁定块内自然段或调整分段策略。

## Verification

- 通过可拆分的本地模拟供应商 SSE，覆盖 `length`、缺 `[DONE]`、正常 `stop`。
- 通过 API 端模拟缺少 orchestrator `end` 的流，覆盖正文成稿不得成功。
- 执行相关 lint、typecheck、test、build；真实模型回归需单独记录，不能以模拟流代替文学质量评测。
- AQ-394 使用真实章节优化服务入口与中性模拟编排流，验证块间空行、单块输出、无后处理改动时的最终稿，以及错误/提前断流。此修复不改变检索、生成请求或文学质量策略，不执行付费模型回归。
