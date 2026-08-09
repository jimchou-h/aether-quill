# CONTEXT

Aether Quill 领域词汇表（single-context）。随功能演进用 `/grill-with-docs` 或手工增补。

## Product

- **Aether Quill**：面向中文小说创作者的 RAG 写作平台
- **知识库（静态）**：世界观 / 设定 / 角色静态卡（`persona_card` 等文档）
- **人物设定页（动态）**：当前状态 / 状态轮转 / 关系事件；可按「最新」或「截至第 N 章」查看 `chapterStates` 快照（只读）
- **章节**：正文、摘要、结构化匹配文本（`structuredMatchingText`）
- **叙事上下文**：生成时注入的前章衔接、出场人物设定、大纲、关系备忘等（与【检索证据】分离）
- **检索证据**：标题匹配 + 向量补足融合后的知识库片段
- **关联角色卡**：知识库 `persona_card.personaId` ↔ 人物设定；人物页须正确展示绑定

## Prefer these terms

| Prefer | Avoid |
|--------|--------|
| 角色卡 / persona_card | 人设文档（含糊） |
| 出场人物 | 「当前启用人物」兼作出场名单 |
| 结构化匹配文本 | 「章节关键词」 alone |
| chapterStates / 截至第 N 章 | 只用「最新状态」指代全部历史 |
| OpenSpec change | 平行新建第二套需求树 |

## Out of scope for this file

实现细节、环境变量清单、任务看板进度 → 见 `AGENTS.md`、`.docs/`、`openspec/`。
