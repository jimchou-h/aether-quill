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

## 数据持久化（当前实现）

- 项目工作区数据会自动落盘到 `services/api/data/project-workspaces.json`
- 进程重启后会自动恢复项目设置、人物设定、知识库与索引任务状态

## API 端点

- `GET /` - 服务信息
- `GET /health` - 健康检查
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户
- `GET /api/projects` - 获取项目列表
- `GET /api/projects/:id` - 获取项目详情
- `POST /api/projects` - 创建项目
- `GET /api/projects/:id/workspace` - 获取项目写作工作区快照（设置、人物、知识、索引任务）
- `GET /api/projects/:id/export` - 导出项目“总结+设定”JSON

### 项目设置与人物设定

- `GET /api/projects/:id/settings` - 获取项目设置（含 `systemPromptText`）
- `PUT /api/projects/:id/settings` - 更新项目设置
- `GET /api/projects/:id/personas` - 获取人物设定列表
- `POST /api/projects/:id/personas` - 新建人物设定草稿
- `POST /api/projects/:id/personas/:personaId/publish` - 发布并生效人物设定

### 知识库与索引

- `GET /api/projects/:id/knowledge` - 获取项目知识库
- `PUT /api/projects/:id/knowledge/outline` - 更新项目大纲总结
- `POST /api/projects/:id/knowledge/chapters` - 新增/更新章节内容与摘要
- `POST /api/projects/:id/knowledge/chapters/:chapterNo/summarize` - 单章语义摘要任务
- `POST /api/projects/:id/knowledge/chapters/summarize` - 批量语义摘要任务
- `GET /api/projects/:id/knowledge/summarize/:jobId` - 查询摘要任务状态
- `POST /api/projects/:id/knowledge/reindex` - 重建章节摘要索引（全量/增量）
- `GET /api/projects/:id/knowledge/reindex/:jobId` - 查询索引任务状态

### 写作编排

- `POST /api/projects/:id/write` - 基于项目上下文生成章节草稿，并自动回写章节摘要/设定进展
