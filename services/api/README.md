# Aether Quill API

NestJS API 服务

## 技术栈

- NestJS
- TypeScript
- Prisma (ORM)
- PostgreSQL

## 开发

```bash
pnpm install
pnpm dev
```

服务将在 http://localhost:3000 启动

## API 端点

- `GET /` - 服务信息
- `GET /health` - 健康检查
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户
- `GET /api/projects` - 获取项目列表
- `GET /api/projects/:id` - 获取项目详情
- `POST /api/projects` - 创建项目
