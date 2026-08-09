## Why

人物设定页在知识库已绑定角色卡后仍显示「未关联」；人物状态只展示最新镜像、无法按章查看；知识库保存因全量 PG 同步阻塞响应达数秒。这三项直接损害日常写作闭环，需一并修复。

## What Changes

- 修复人物设定页文档列表解包，使「关联角色卡」与知识库绑定一致显示
- 人物设定页支持按章节查看 `chapterStates` 快照（默认仍可读最新；可选「截至第 N 章」）
- 知识库文档保存改为增量/非阻塞 PG 持久化，显著缩短保存等待
- 补充前端/API 回归测试锁定上述行为

## Non-goals

- 不重做人物设定/知识库整页 UI
- 不改生成侧 `resolvePersonaSnapshotAsOfChapter` 语义（已按章；本次对齐展示）
- 不引入新持久化后端（仍用现有 PG / JSON 路径）
- 不改 OpenAPI 错误码体系；若仅内部同步策略变化且对外字段不变，可不改合同；若暴露「截至章号」查询参数再补合同

## Capabilities

### New Capabilities

- `persona-card-link-display`: 人物设定页正确展示知识库 `persona_card.personaId` 绑定关系
- `persona-chapter-status-view`: 人物状态按章节快照查看（读 `chapterStates`，不仅 `persona.state`）
- `knowledge-document-save-latency`: 知识库文档保存响应路径避免全量同步阻塞

### Modified Capabilities

- （无：`openspec/specs/` 尚无既有能力规格）

## Impact

- **Frontend**: `apps/web/src/pages/Persona.vue`、`PersonaCardView.vue`、相关 utils/tests；Knowledge 页一般无需改绑定写入
- **API**: `documents.service` 持久化调用、`documents-pg-sync` 增量同步；人物 API 字段已有 `chapterStates`，优先只读展示
- **OpenAPI**: 问题 1/3 预计无合同变更；问题 2 若仅 UI 消费既有 `Persona.chapterStates` 则无合同变更；若新增查询参数再更新 `openapi/`
- **Error codes**: 无预期变更
