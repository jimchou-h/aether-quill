## Context

三项用户问题落在同一使用路径（知识库 ↔ 人物设定），但根因不同：

1. **关联显示**：HTTP 客户端已把 `GET .../documents` 解包为数组；`Persona.vue` 仍取 `.data`，得到 `[]`，关联 map 恒空。Knowledge 页已有 `Array.isArray` 兼容。
2. **按章状态**：后端已有 `Persona.chapterStates` + `resolvePersonaSnapshotAsOfChapter`（生成侧在用）；Persona UI 只渲染 `persona.state`。
3. **保存延迟**：`documents.service` create/update `await persistStateAndAwaitPgSync()`，且 `syncDocumentsToPostgres` 对**全库**文档删建 versions/chunks。

约束：Contract First；不改生成语义；PG 空快照防误擦已有保护需保留。

## Goals / Non-Goals

**Goals:**

- Persona 关联展示与 Knowledge 绑定一致
- Persona 可按「截至第 N 章」查看状态快照
- 单文档保存不再同步等待全库 rewrite

**Non-Goals:**

- 历史 `chapterStates` 的手工编辑 API
- 向量 ingestion 链路重构
- 整页 Persona/Knowledge UI 重设计

## Decisions

### D1 — 关联显示：统一 unwrap，不改 API

- **选择**：Persona（及任何漏网调用方）用与 Knowledge / `unwrapPayload` 相同的数组安全解包。
- **备选**：改拦截器再包一层 envelope — 会破坏全站约定，否决。
- **测试**：纯函数或组件级：给定已解包数组 + 带 `personaId` 的 card → 显示标题。

### D2 — 按章状态：前端复用既有解析语义

- **选择**：在 web 侧抽出/移植与 `resolvePersonaSnapshotAsOfChapter` 等价的纯函数；UI 增加章节选择（项目章节列表或 `chapterStates` 中出现过的 `chapterNo`）。默认「最新」= `persona.state`。
- **备选**：新增 `GET .../personas/:id/snapshot?chapterNo=` — 本期不必要（payload 已含 `chapterStates`），标为非目标。
- **OpenAPI**：无合同变更（只读既有字段）。

### D3 — 保存延迟：增量 PG sync（优先）+ 可选异步等待策略

- **选择（主）**：`syncDocumentsToPostgres`（或新 helper）按**变更文档 id** 增量 upsert meta/versions/chunks；未变更文档不 deleteMany chunks。
- **选择（辅）**：若增量仍偏慢，create/update 可先持久化内存/JSON 并返回，PG sync fire-and-forget **仅当**能保证读路径与防空擦语义；默认仍 await **增量** sync，避免引入可见不一致。
- **备选**：只去掉 await、保留全量 sync — 延迟仍会堵队列，否决为唯一手段。
- **保留**：空内存快照不覆盖非空 PG 的安全闸。

### D4 — 竖切交付顺序

1. 关联显示（最小、可独立验收）
2. 按章状态查看
3. 增量 PG sync + 测试

## Risks / Trade-offs

- [增量 sync 漏字段] → 对照现全量 upsert 字段表做单测；灰度时对比 list 后内容
- [异步 PG 若误开] → 本期默认仍 await 增量；异步仅作显式 follow-up
- [章节选择 UX 歧义] → 文案标明「查看截至第 N 章（只读）」；编辑仍作用于最新态
- [索引回调仍全量 sync] → 与用户保存解耦；若同队列仍拖慢，后续将 `commitIndexResult` 也改为增量

## Migration Plan

- 无数据迁移；`chapterStates` / `persona_id` 已存在
- 回滚：还原 Persona unwrap、隐藏章节筛选、恢复全量 sync 函数（性能回退，行为正确）

## Open Questions

- 章节选择器数据源：项目全部章节 vs 仅有 `chapterStates` 的章号？（建议：有章列表用章列表；否则用 `chapterStates` 章号 +「最新」）
- 保存延迟是否需要前端 loading 文案/超时提示改进？（非阻塞，可顺带）
