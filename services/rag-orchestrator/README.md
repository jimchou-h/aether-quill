# RAG Orchestrator Service

RAG 检索与生成编排服务

## 技术栈

- Node.js / Express
- TypeScript
- LangChain JS (用于流水线组件)

## 开发

```bash
pnpm install
pnpm dev
```

服务将在 http://localhost:3001 启动

## API 端点

- `GET /` - 服务信息
- `GET /health` - 健康检查
- `GET /api/projects/:projectId/context` - 获取项目上下文快照
- `POST /api/projects/:projectId/context` - 更新项目上下文（systemPrompt / persona / outline / chapters）
- `POST /api/retrieve` - 按 `projectId` 检索章节摘要
- `POST /api/rerank` - 对检索结果进行重排
- `POST /api/generate` - 基于项目上下文生成章节草稿
