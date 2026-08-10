## Context

`upsertChapter` 在 content hash 变化时调用 `resolveChapterSummaryOnContentWrite`，当前**无视** `existing`，一律 `buildFallbackChapterSummary`。注释写明是为避免旧 LLM 摘要与新正文脱节，但代价是每次手改都丢摘要；优化 apply 路径默认 `preserveSummary`，策略不一致。

## Goals / Non-Goals

**Goals:**

- 手改保存不无故丢掉已有 LLM 摘要
- 无摘要或仅有 fallback 时，仍可用正文截取兜底
- 与现有单测/调用点最小改动对齐

**Non-Goals:**

- 自动检测「摘要已过期」并重生成 LLM 摘要
- after-save / 关系事件流水线改造

## Decisions

### D1 — 保留非空 LLM 摘要

- **选择**：若 `existing.summarySource === 'llm'` 且 `summary` 非空 → 保留 `summary` / `summarySource` / `summaryUpdatedAt`
- 否则 → 现行为 fallback（无摘要、或已是 fallback、或 source 缺失）
- **备选**：永远保留任意 summary — 可能留下过时手工/fallback 文案与新正文严重不符；否决为默认。永远 fallback — 即现状，否决。
- **与 optimize apply**：手改保留 llm；用户若要刷新语义摘要仍点「生成摘要」。

### D2 — 前端 trim（加固，可选同一竖切）

- **选择**：空校验用 trim，emit 的 `content` 尽量保持与编辑器一致（或仅 trim 首尾空行策略与入库一致），降低「只改标题也丢摘要」概率。
- 即使 hash 仍变，D1 已保护 llm 摘要。

## Risks / Trade-offs

- [正文大改后摘要过时] → 文案/文档说明需再点「生成摘要」；可后续加「摘要可能过期」提示（非本 change 必做）
- [依赖 summarySource 标记] → 缺 source 的旧数据走 fallback，行为与今接近

## Migration Plan

- 无数据迁移
- 回滚：恢复 util 一律 fallback

## Open Questions

- 无（默认按 D1；D2 纳入同一任务组若成本低）
