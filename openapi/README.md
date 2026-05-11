# Aether Quill OpenAPI Specification

本目录包含 Aether Quill RAG 小说写作系统的完整 API 规范，遵循 OpenAPI 3.0.3 标准。

## 目录结构

```
openapi/
├── openapi.yaml                    # 主规范文件
└── paths/                          # API 端点定义
    ├── auth/
    │   ├── login.yaml              # POST /api/auth/login
    │   └── me.yaml                 # GET /api/auth/me
    ├── projects/
    │   ├── index.yaml              # GET/POST /api/projects
    │   ├── by-id.yaml              # GET/PATCH /api/projects/:id
    │   ├── documents.yaml          # GET/POST /api/projects/:id/documents
    │   ├── generate.yaml           # POST /api/projects/:id/generate
    │   ├── generation-traces.yaml   # GET /api/projects/:id/generation-traces
    │   ├── prompt-config.yaml       # GET/PUT /api/projects/:id/prompt-config
    │   ├── prompt-config-publish.yaml    # POST /api/projects/:id/prompt-config/publish
    │   └── prompt-config-rollback.yaml  # POST /api/projects/:id/prompt-config/rollback
    ├── documents/
    │   ├── reindex.yaml            # POST /api/documents/:id/reindex
    │   └── chunks.yaml             # GET /api/documents/:id/chunks
    └── drafts/
        ├── accept.yaml             # POST /api/drafts/:id/accept
        └── rewrite.yaml            # POST /api/drafts/:id/rewrite
```

## API 端点概览

### 认证
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息

### 项目管理
- `GET /api/projects` - 获取项目列表
- `POST /api/projects` - 创建项目
- `GET /api/projects/:id` - 获取项目详情
- `PATCH /api/projects/:id` - 更新项目

### 文档管理
- `GET /api/projects/:id/documents` - 获取项目文档列表
- `POST /api/projects/:id/documents` - 创建文档
- `POST /api/documents/:id/reindex` - 重新索引文档
- `GET /api/documents/:id/chunks` - 获取文档分块

### 生成与写作
- `POST /api/projects/:id/generate` - 生成内容（支持 SSE）
- `GET /api/projects/:id/generation-traces` - 获取生成记录
- `POST /api/drafts/:id/accept` - 接受草稿
- `POST /api/drafts/:id/rewrite` - 重写草稿

### Prompt 配置
- `GET /api/projects/:id/prompt-config` - 获取 Prompt 配置
- `PUT /api/projects/:id/prompt-config` - 更新 Prompt 配置（保存草稿）
- `POST /api/projects/:id/prompt-config/publish` - 发布 Prompt 配置
- `POST /api/projects/:id/prompt-config/rollback` - 回滚 Prompt 配置

## 使用方法

### 1. 在线查看

使用 Swagger UI 或 Redoc 查看交互式 API 文档：

```bash
# 安装 Swagger UI
npm install -g @redocly/cli

# 启动本地文档服务器
redocly preview-docs openapi/openapi.yaml
```

访问 `http://localhost:8080` 查看文档。

### 2. 验证规范

```bash
# 使用 Redocly CLI 验证
redocly lint openapi/openapi.yaml

# 使用 OpenAPI Generator 验证
npx @openapitools/openapi-generator-cli validate -i openapi/openapi.yaml
```

### 3. 生成客户端 SDK

```bash
# 生成 TypeScript 客户端
npx @openapitools/openapi-generator-cli generate \
  -i openapi/openapi.yaml \
  -g typescript-axios \
  -o packages/api-client

# 生成 Vue 组件
npx @openapitools/openapi-generator-cli generate \
  -i openapi/openapi.yaml \
  -g typescript-vue3 \
  -o apps/web/src/api
```

### 4. 生成服务器代码

```bash
# 生成 NestJS 控制器
npx @openapitools/openapi-generator-cli generate \
  -i openapi/openapi.yaml \
  -g typescript-nestjs \
  -o services/api/src/generated
```

## 数据模型

### Envelope（统一响应格式）

```typescript
{
  code: number;        // HTTP 状态码
  message: string;     // 响应消息
  data: T;            // 响应数据
  requestId: string;   // 请求 ID（用于追踪）
}
```

### User（用户）

```typescript
{
  id: string;          // UUID
  email: string;       // 邮箱
  name: string;        // 用户名
  createdAt: string;    // ISO 8601 日期时间
}
```

### Project（项目）

```typescript
{
  id: string;          // UUID
  name: string;        // 项目名称
  description?: string; // 项目描述
  userId: string;      // 用户 ID
  createdAt: string;   // ISO 8601 日期时间
  updatedAt: string;   // ISO 8601 日期时间
}
```

### Document（文档）

```typescript
{
  id: string;          // UUID
  projectId: string;   // 项目 ID
  title: string;       // 文档标题
  content?: string;    // 文档内容
  indexStatus: 'pending' | 'indexing' | 'completed' | 'failed';
  createdAt: string;   // ISO 8601 日期时间
  updatedAt: string;   // ISO 8601 日期时间
}
```

### GenerationTrace（生成记录）

```typescript
{
  id: string;          // UUID
  projectId: string;   // 项目 ID
  prompt: string;       // 用户提示词
  status: 'pending' | 'generating' | 'completed' | 'failed';
  traceId?: string;    // 追踪 ID
  createdAt: string;   // ISO 8601 日期时间
  completedAt?: string;// ISO 8601 日期时间
}
```

### PromptConfig（Prompt 配置）

```typescript
{
  id: string;          // UUID
  projectId: string;   // 项目 ID
  systemPromptText: string; // 系统提示词文本
  version: number;     // 版本号
  isPublished: boolean; // 是否已发布
  createdAt: string;   // ISO 8601 日期时间
  updatedAt: string;   // ISO 8601 日期时间
}
```

## 认证

所有 API 端点（除了登录）都需要 JWT Bearer Token 认证：

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/projects
```

## SSE 流式生成

生成接口支持 Server-Sent Events（SSE）流式响应：

```bash
curl -N -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Write a chapter","useSSE":true}' \
  http://localhost:3000/api/projects/{id}/generate
```

## 错误处理

所有错误响应遵循统一格式：

```typescript
{
  code: number;        // 错误码
  message: string;     // 错误消息
  requestId: string;   // 请求 ID
  details?: object;     // 额外错误详情
}
```

## 版本控制

- 当前版本：`1.0.0`
- OpenAPI 版本：`3.0.3`
- 更新日期：`2026-05-11`

## 贡献指南

1. 修改 API 时，必须先更新 OpenAPI 规范
2. 使用 `redocly lint` 验证规范
3. 更新相关文档和示例
4. 重新生成客户端 SDK（如有变更）

## 相关文档

- [实现方案](../.docs/RAG小说写作系统-实现方案-v1.md)
- [API 示例与错误码手册](../.docs/API示例与错误码手册-v1.md)
- [环境变量与配置规范](../.docs/环境变量与配置规范-v1.md)
