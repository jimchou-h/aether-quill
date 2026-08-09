## Why

章节编辑保存后，已有的 LLM 摘要会被强制改成正文截取（fallback），用户感知为「摘要等信息被重置」。手工保存与优化 apply（默认保留摘要）行为不一致，日常改文体验差。

## What Changes

- 正文变更写入时：**保留有效 LLM 摘要**（或仅在无摘要 / 已是 fallback 时才写 fallback）
- 可选：前端保存不再因整章 `trim()` 误触发 content hash 变更
- 补充单测锁定「有 llm 摘要则保留」

## Non-goals

- 不改变 after-save（结构化解析 / 人物同步 / 关系事件重生）的确认与执行语义
- 不在本次改关系事件「先删后生成」策略
- 不自动重新跑 LLM 摘要（仍由用户点「生成摘要」）
- 无 OpenAPI / 错误码变更（内部 util 行为变更）

## Capabilities

### New Capabilities

- `chapter-summary-on-save`: 章节正文保存时的摘要字段保留策略

### Modified Capabilities

- （无既有同名主规格需改写以外的能力；新建上述 capability）

## Impact

- **API**: `resolveChapterSummaryOnContentWrite`（`chapter-summary.util.ts`）、`projects.service` upsert 路径
- **Frontend（可选）**: `ChapterList.vue` save trim
- **OpenAPI / error codes**: 无
- **Tests**: `chapter-summary.util.test.ts`
