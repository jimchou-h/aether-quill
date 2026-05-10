# Worker Service

异步任务处理服务

## 技术栈

- Node.js / Express
- TypeScript
- BullMQ (任务队列)
- Redis

## 开发

```bash
pnpm install
pnpm dev
```

服务将在 http://localhost:3002 启动

## API 端点

- `GET /` - 服务信息
- `GET /health` - 健康检查
- `GET /api/jobs` - 获取任务列表
- `POST /api/jobs` - 创建新任务
- `GET /api/jobs/:id` - 获取任务详情
