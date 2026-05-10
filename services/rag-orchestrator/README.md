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
- `POST /api/retrieve` - 向量检索
- `POST /api/rerank` - 重排
- `POST /api/generate` - 生成编排
