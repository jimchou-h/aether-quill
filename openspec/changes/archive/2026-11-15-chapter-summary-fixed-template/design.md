## Context

摘要经 `POST /api/summarize` 生成后写入章节 `summary`，并注入叙事上下文与 Qdrant 记忆（约 480 字截断）。当前 prompt 与 fallback 形态不一致。

## Goals / Non-Goals

- Goals: 统一 LLM/fallback 为固定三行；生成后校验；控制长度服务注入
- Non-Goals: 新 API 字段、历史批量重跑、UI 专门解析器

## Decisions

1. **字符串模板而非 JSON**：下游已按纯文本注入；标签行对人与模型皆可读，无需合同变更。
2. **共享包 `@aether-quill/config`**：api 与 rag-orchestrator 共用 `format` / `normalize` / 常量，避免双份规则。
3. **校验失败 → fallback**：缺标签或空字段时不落库乱散文；api 侧对 LLM 返回再 normalize 一次作双保险。
4. **fallback 同形**：`情节：{正文短摘}` + `人物：待补全` + `未收线：待补全`，便于 UI/注入识别未语义化摘要。

## Risks / Trade-offs

- 旧 `llm` 散文摘要仍保留直至用户重新生成；新旧并存可接受。
- 模型偶发多行说明：normalize 取首个匹配标签块，失败则 fallback。

## Migration Plan

无需数据迁移。用户对章节点「生成摘要」即可得到新格式。

## Open Questions

无。
