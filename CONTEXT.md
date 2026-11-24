# CONTEXT

Aether Quill 领域词汇表（single-context）。随功能演进用 `/grill-with-docs` 或手工增补。

## Product

- **Aether Quill**：面向中文小说创作者的 RAG 写作平台
- **知识库（静态）**：世界观 / 设定 / 角色静态卡（`persona_card` 等文档）
- **人物设定页（动态）**：当前状态 / 状态轮转 / 关系事件；可按「最新」或「截至第 N 章」查看 `chapterStates` 快照（只读）
- **章节**：正文、摘要（`summarySource: llm | fallback`）、结构化匹配文本（`structuredMatchingText`）；手改保存时保留已有非空 LLM 摘要，不自动截断覆盖
- **章节锁定标记（`isLocked`）**：章节元数据，默认 false；纯标记，不阻止编辑/保存/删除/AI 优化，单独切换不改 `updatedAt`、不触发后处理（锁定 ≠ 只读保护）
- **叙事上下文**：生成时注入的前章衔接、出场人物设定、大纲、关系备忘等（与【检索证据】分离）
- **情节梳理（plot context）**：`rewriteMode=direct` 实际切出多段时，正文生成前用工具档对整章原文输出 `chapterSynopsis` 与逐段 `plotChecklist`；按实际段号校验完整覆盖，失败重试一次，连续失败以「情节梳理失败」结束且不产出正文
- **情节保留清单（plotChecklist）**：每段按原文顺序列出要保留的事件、动作与人物状态变化；清单与原文冲突时以原文为准
- **段首接入状态**：第 N 段起笔时人物位置、姿态、衣着、随身物件与情绪取第 N-1 段成稿末尾；本段事件、动作顺序与信息揭晓仍以第 N 段原文与清单为准
- **检索证据**：标题匹配 + 向量补足融合后的知识库片段
- **关联角色卡**：知识库 `persona_card.personaId` ↔ 人物设定；人物页须正确展示绑定

## Prefer these terms

| Prefer | Avoid |
|--------|--------|
| 角色卡 / persona_card | 人设文档（含糊） |
| 出场人物 | 「当前启用人物」兼作出场名单 |
| 结构化匹配文本 | 「章节关键词」 alone |
| chapterStates / 截至第 N 章 | 只用「最新状态」指代全部历史 |
| LLM 摘要保留（手改保存） | 「改正文必清摘要」 |
| 章节锁定标记（纯元数据） | 「锁定 = 禁止编辑」 |
| 情节梳理 / plotChecklist | 与「章节大纲」「优化方案」混用 |
| 段首接入状态 | 「前段原文状态」 |
| OpenSpec change | 平行新建第二套需求树 |

## Out of scope for this file

实现细节、环境变量清单、任务看板进度 → 见 `AGENTS.md`、`.docs/`、`openspec/`。
