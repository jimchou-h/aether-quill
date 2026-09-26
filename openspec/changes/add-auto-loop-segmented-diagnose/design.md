## Context

Grill 结论：用户要 2 万字 / 5000 字一窗、**每窗跑完整自动优化**，不是「只切复诊、整章仍最多改 12 段」。

现有 `runChapterAutoLoop` 仍是单份 `storedContent` 上的多轮循环。外包一层按窗调用即可，窗内命中上限自然按该窗段落数计算。

## Goals / Non-Goals

**Goals**

- 空行切窗、攒满约 `segmentCharSize`、不腰斩。
- 每窗独立循环、N 轮/窗、顺序写回、已完成锁死。
- 只读前文；失败停在当前窗并可续跑。
- `0` 或低于单段阈值：行为与现在一致（整章一窗）。

**Non-Goals**

- 不改 from-plan 均分算法。
- 不并行跑窗。
- 不做窗级 overlap 改写。

## Decisions

### 1. 外包现有引擎，不把整章诊断合并

每窗 `storedContent` = 该窗正文。命中上限、闸门、删段、续跑内层逻辑全部复用。

备选「只切复诊再整章改写」已否决（全章 12 段）。

### 2. 对原始剩余正文 greedy 切窗

开跑时按入库全文切好窗列表（段落 + `joinAfter`）。窗 1 改完写回的是该窗成稿，窗 2 仍优化**原始窗 2 文本**，但复诊带上窗 1 成稿末尾只读。等价于「对剩余未优化原文往下攒」，因为未处理尾永远是原文。

### 3. 拼回用原始窗间分隔串

`finalDraft = Σ (windowDraft_i + joinAfter_i)`。前端 `round.draft` / `onDraftAvailable` MUST 是拼好的**整章**，禁止把单窗稿写进编辑器。

### 4. 失败与续跑

`aborted` / `plan_parse_failed` / `round_rolled_back` 停止后续窗。session 存 `windowPack` + 内层 `resume`。`resume: true` 从该窗内层断点继续，不重跑已锁死窗。

`converged` / `budget` 视为该窗收工，进入下一窗。

### 5. 只读前文

`extractAutoLoopWindowTail`：上一窗成稿最后一段；超过 400 字则取末 400 字。写入复诊 prompt【上一窗末文·只读】。

复诊（`loop.plan`）MUST NOT 注入【下章衔接】：窗内编号从 1 起，下章开头会被模型抄进 `anchorQuote` 导致 `skipped_unlocatable`。改写仅末窗/整章可保留下章锚点。

## Risks / Trade-offs

- [时间 × 窗数 × N] → 默认 N=2；可提前收敛。
- [窗内仍最多约 12 段/轮] → 第 2 轮捡 deferred；比整章 12 段完整。
- [窗内编号从 1 起] → 活动条带「第 i/M 窗」避免和全章编号混淆。
- [一条超长无空行段落] → 整段单独成窗，可超过 5000。

## Migration Plan

无数据迁移。`segmentCharSize=0` 回退为单窗。回滚：service 改回只调 `runChapterAutoLoop`。

## Open Questions

无（Grill 已关闭）。
