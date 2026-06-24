# RAG Orchestrator Service

检索 + 上下文拼装 + LLM 生成编排服务。API 在写作前同步项目快照，本服务负责组装 prompt 并流式返回结果。

## 目录结构

```text
src/
  main.ts              # HTTP 入口、路由、生成主链路编排
  context/             # 叙事上下文（前章衔接、人物快照、章节摘要记忆）
  retrieval/           # 向量检索、重排、知识库标题匹配、证据裁剪
  generation/          # Prompt 拼装、LLM 调用、Trace、抽取类任务
  consistency/         # 生成后轻量规则检查
  observability/       # 日志、指标、链路 span
```

## 生成主链路（简化）

```text
API POST /context  →  projectContextStore（内存快照）
                         ↓
POST /api/generate 或 /api/generate/draft
                         ↓
    ┌────────────────────┴────────────────────┐
    │ 有 chapterNo + structuredMatchingText?   │
    └────────────────────┬────────────────────┘
           是 ↓                    否 ↓
  标题匹配知识库全文/裁剪     Qdrant 向量检索 → Reranker
           └────────┬───────────────────┘
                    ↓
         buildNarrativeContextText（叙事上下文）
                    ↓
         GenerationService.buildLlmMessages
           system ← 全局默认 + 项目 system + 任务 prompt
           user   ←【叙事上下文】【检索证据】【用户需求】
                    ↓
              LLM 流式 / 非流式
```

`LLM_PROMPT_LEGACY_SINGLE_USER=1` 时回退为单条 user（含【系统指令】段）。

## 叙事上下文 vs 检索证据

| 段落 | 来源模块 | 内容 |
|------|----------|------|
| 叙事上下文 | `context/narrative-context` | 前章衔接、人物快照、近期摘要、语义记忆、大纲、关系备忘 |
| 检索证据 | `retrieval/knowledge-retrieval` | 向量 chunk 或标题匹配后的知识库文档 |

二者在 `GenerationService.buildUserMessage` 中分段注入；system 角色由 `buildSystemMessage` 单独拼装，勿混淆。

## 开发

```bash
pnpm install
pnpm dev   # 默认 http://localhost:3001
```

### 调试：查看大纲 / 正文完整 Prompt

写作工作台「生成大纲」「生成正文」时，`rag-orchestrator` 终端会打印送入 LLM 的完整拼装 prompt（含系统指令、叙事上下文、检索证据、用户需求）。

- 默认开启；设置 `LOG_WRITE_CHAPTER_PROMPT=false` 可关闭
- trace `context` 记录 `system_message`、`user_message` 与 `assembled_prompt`，可通过 `GET /api/traces/:traceId` 查看

## 主要 API

| 端点 | 说明 |
|------|------|
| `POST /api/projects/:id/context` | 同步项目快照（大纲、章节、知识库、人物等） |
| `POST /api/generate` | 通用生成（续写、章节优化、大纲等） |
| `POST /api/generate/draft` | 写作工作台正文（须 confirmedOutlineText） |
| `POST /api/preview-retrieval` | 预览本次生成将注入的上下文/证据池 |
| `POST /api/summarize` | 章节摘要（单次 LLM，无 RAG） |
| `POST /api/extract/*` | 人物状态、关系事件等抽取 |
| `GET /health` | 健康检查 |

详细字段见 `openapi/` 合同与 `src/main.ts` 文件头注释。
