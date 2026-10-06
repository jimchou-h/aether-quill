## Why

自动循环跑完后，弹窗里只能看见最后一轮的诊断条目；切到下一窗还会把前面的轮次清掉。作者无法在当场核对「AI 刚才说要改什么、改没改上」，只能对着最新稿猜。

## What Changes

- 自动优化弹窗内提供一条「窗 + 轮」时间线，每一行可点开该轮完整条目（问题 / 改法 / 状态）。
- 切窗 MUST NOT 清空已完成轮次；跑着的时候也可以点历史轮，不把视线拽回最新一轮。
- 点历史轮只换条目面板；正文预览与「应用」仍对着最新可接受稿。
- 回看非最新轮时提示：条目段号对应该轮当时的稿，可能对不上当前预览。
- `ChapterAutoLoopRound` 增加可选 `windowIndex` / `windowTotal`，便于时间线标注与会话恢复后仍能按窗分组。

## Capabilities

### New Capabilities

- `auto-loop-history-timeline`: 自动循环弹窗内回看每一窗、每一轮的诊断条目。

### Modified Capabilities

- （无。主 specs 尚未归档 `chapter-auto-optimize-loop`。）

## Non-goals

- 不在关弹窗或刷新后的章节页上保留永久优化历史（下一刀）。
- 不把点选历史轮与正文预览/应用目标绑定。
- 不按 `anchorQuote` 在当前稿里重新定位或高亮。
- 不做 Prompt 实验室（对话调优、冻输入重跑）；那是独立变更。
- 不改复诊/改写模型行为、闸门或切窗算法。

## Impact

**OpenAPI**：`ChapterAutoLoopRound` 增加可选 `windowIndex`、`windowTotal`；SSE `loop_round_end` 的 `round` 与 session `rounds[]` 同步带上。无 **BREAKING**。无新错误码。

**代码**：前端时间线状态（选中轮、切窗不清空、跑着不抢焦点）；`useChapterAutoLoop` 停止在 `loop_window_start` 清空 rounds；后端 round 对象写入窗号。
