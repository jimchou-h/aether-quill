## Context

自动循环弹窗的条目面板只渲染 `rounds.at(-1)` 或进行中的 `liveItems`。`onWindowStart` 还会把 `rounds` 清空。多窗时 `roundIndex` 每窗从 1 重计，若只按 `roundIndex` 合并会覆盖上一窗。

引擎外包层 `lastResult.rounds` 只保留**当前窗**内层轮次；窗间 checkpoint 的 `completedRounds` 也是空数组。会话恢复因此也看不见跨窗历史。

Grill 已锁定交互：一条时间线、点选不换正文、跑着可回看、段号提示、不抢焦点。

## Goals / Non-Goals

**Goals:**

- 本次运行（含会话恢复）能回看每一窗每一轮的完整条目。
- 轮次身份为 `(windowIndex, roundIndex)`，切窗追加而非覆盖。
- 选中历史轮不影响预览稿与 apply。

**Non-Goals:**

- 章节页永久历史、Prompt 实验室、段号重定位、改模型/闸门/切窗。

## Decisions

### 1. 轮次主键改为窗 + 轮

`ChapterAutoLoopRound` / `AutoLoopRoundResult` 增加可选 `windowIndex`、`windowTotal`。单窗时缺省或视为 `1/1`。前端列表 `key` 与查找 MUST 用二者，禁止只按 `roundIndex` upsert。

备选「时间线做成两级窗 Tab」已否决。

### 2. 引擎跨窗拼接 `rounds`

`runChapterAutoLoopWindows` 累计已完成窗的 round（已 remap 整章 draft 并打上窗号），再拼上当前窗。窗间 checkpoint 写入 session 的 `rounds` MUST 是累计时间线，不得用空的内层 `completedRounds` 覆盖。内层 `resume.completedRounds` 仍只表示当前窗，供续跑引擎使用。

### 3. 前端累计、选中态独立

`loop_window_start` MUST NOT 清空 `rounds`。进行中轮用 `liveItems`；已结束轮用该 round 的 `items`。

`selectedRoundKey`：默认跟随最新一轮。用户点了历史轮后锁定，直到点「回到当前」或新开一次循环（`reset`）。新 `round_end` / `plan_items` MUST NOT 抢走已锁定的选中。

点选 MUST NOT 调用 `onDraftAvailable`。

### 4. 回看提示

仅当选中轮不是时间线最后一轮时，条目区展示固定文案：条目对应该轮当时的正文，段号可能对不上当前预览。不在编辑器里高亮。

## Risks / Trade-offs

- [session.rounds 变长] → 每轮条目有上限，窗数通常个位数；仍为内存会话。
- [旧会话无 windowIndex] → 按单窗 `1/1` 展示，行为不差于现在。
- [段号与预览不对齐] → 文案提示；不重算。

## Migration Plan

无持久化迁移。回滚：恢复 `onWindowStart` 清空；引擎改回只返回当前窗 `rounds`。

## Open Questions

无（Grill 已关闭）。
