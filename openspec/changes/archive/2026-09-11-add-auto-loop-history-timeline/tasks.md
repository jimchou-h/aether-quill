## 1. 跨窗轮次身份与会话累计

- [x] 1.1 OpenAPI `ChapterAutoLoopRound` 增加可选 `windowIndex` / `windowTotal`；引擎 `round_end` 写入这两字段；多窗 `rounds` 按窗追加而非只留当前窗
  - 测试：`chapter-auto-loop.engine.test.ts` — 两窗各 1 轮时 `result.rounds` 长度为 2 且窗号分别为 1、2
- [x] 1.2 窗间 checkpoint / GET 会话的 `rounds` 保留上一窗已结束轮次，不被空的内层 `completedRounds` 覆盖
  - 测试：`chapter-auto-loop.engine.test.ts` 或 session store 测 — 窗 1 结束后进入窗 2 时 checkpoint `rounds` 仍含窗 1

## 2. 弹窗时间线回看

- [x] 2.1 前端按 `(windowIndex, roundIndex)` 追加轮次；`loop_window_start` 不清空 `rounds`；默认展示最新轮条目；点历史轮不触发 `onDraftAvailable`
  - 测试：`chapterAutoLoopItems.test.ts`（或新的 timeline 纯函数测）— 两窗同 `roundIndex` 不合并；选中历史轮时 draft 回调不被测试替身调用
- [x] 2.2 条目面板可点选时间线；非最新轮显示段号对不齐提示；进行中可回看且不抢焦点；提供「回到当前」
  - 测试：选中态纯函数 — 锁定历史后新 `round_end` 不改选中；`backToCurrent` 回到最新；最新轮不显示提示
