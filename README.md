# Aether Quill — 小说创作者的 RAG 写作助手

> **一句话介绍**：Aether Quill 是一个面向小说创作者的 AI 写作辅助平台，能帮助你管理世界观设定、知识库，并通过 RAG（检索增强生成）技术生成情节连贯、设定一致的小说章节。

---

## 目录

1. [这个项目能做什么](#1-这个项目能做什么)
2. [整体结构长什么样](#2-整体结构长什么样)
3. [快速开始（5 分钟上手）](#3-快速开始5-分钟上手)
4. [日常使用流程](#4-日常使用流程)
5. [常见问题](#5-常见问题)

---

## 1. 这个项目能做什么

假设你正在写一本小说，里面有很多角色、世界观设定和复杂的时间线。你面临几个问题：

- **设定记不住**：写到第 20 章时，容易忘了某个角色的年龄或某个事件发生的顺序
- **前后矛盾**：前面说主角左撇子，后面写他用右手拔剑
- **知识分散**：角色设定、地理信息、势力关系散落在不同文档里，写的时候找不到

**Aether Quill 就是来解决这些问题的。**

它提供一个写作工作台，你可以在里面：

| 功能 | 说明 |
|------|------|
| 📚 **管理项目"知识库"** | 上传你的世界观设定、角色介绍、章节草稿等文档 |
| 🔍 **智能检索** | 写作时自动从知识库中召回相关设定和上下文 |
| ✍️ **AI 辅助生成** | 输入写作目标，AI 根据你的设定生成章节草稿 |
| ✅ **一致性检查** | 生成后自动检测是否有角色/时间线/世界规则冲突 |
| 📋 **系统提示词配置** | 自定义 AI 的写作风格约束，可版本化管理 |
| 📊 **可观测性** | 所有生成请求可追踪（谁、什么时候、用了多少 token） |

---

## 2. 整体结构长什么样

```
aether-quill/
├── apps/web/                  # 前端界面（Vue 3 + TypeScript）
│   └── 你在浏览器里看到的页面都在这
│
├── services/
│   ├── api/                   # 后端 API（NestJS）
│   │   └── 处理登录、项目、文档、模板等业务逻辑
│   ├── rag-orchestrator/      # RAG 编排服务（Express）
│   │   └── 检索、重排、生成、一致性检查
│   └── worker/                # 异步任务队列
│       └── 文档入库、向量化等耗时任务
│
├── packages/                  # 共享代码包
│   ├── shared-types/          # 前后端共享的类型定义
│   ├── model-providers/       # AI 模型适配器（DeepSeek / SiliconFlow）
│   └── prompt-templates/      # Prompt 模板管理
│
├── openapi/                   # API 接口合同（OpenAPI 3.0）
├── scripts/                   # 部署和运维脚本
└── infra/docker/              # 本地开发环境容器配置
```

**技术栈速览**：
- **前端**：Vue 3 + TypeScript + Vite + Pinia + Vue Router
- **后端**：NestJS（API）+ Express（RAG 编排）
- **数据库**：PostgreSQL 16 + Redis 7 + Qdrant（向量库）
- **队列**：BullMQ（基于 Redis）

---

## 3. 快速开始（5 分钟上手）

### 前置条件

- Node.js 20+
- pnpm（`npm install -g pnpm`）
- Docker Desktop（用于启动数据库等依赖服务）

### 第一步：下载项目

```bash
git clone <仓库地址>
cd aether-quill
```

### 第二步：安装依赖

```bash
pnpm install
```

### 第三步：启动依赖服务（数据库、缓存等）

```bash
# 一键启动 PostgreSQL + Redis + Qdrant + MinIO
cd infra/docker && docker compose up -d
```

启动后可以用以下命令验证：
```bash
curl http://localhost:5432      # PostgreSQL
curl http://localhost:6379      # Redis
curl http://localhost:6333      # Qdrant
```

### 第四步：配置环境变量

复制环境变量模板并编辑（至少需要配置 AI 模型的 API Key）：

```bash
cp .env.example .env
```

编辑 `.env` 文件，最少需要填写一项：

```env
# 任选一个 AI 模型供应商配置即可
DEEPSEEK_API_KEY=sk-your-deepseek-key
# 或
SILICONFLOW_API_KEY=sk-your-siliconflow-key
```

### 第五步：启动服务

你需要开三个终端窗口（或者使用 `pnpm -r dev` 统一启动）：

```bash
# 终端 1：启动 API 服务（端口 3000）
pnpm --filter @aether-quill/api dev

# 终端 2：启动 RAG 编排服务（端口 3001）
pnpm --filter @aether-quill/rag-orchestrator dev

# 终端 3：启动前端界面（端口 5173）
pnpm --filter @aether-quill/web dev
```

### 第六步：打开浏览器

访问 **http://localhost:5173**，你应该能看到登录页面。

默认情况下，你可以注册一个新账号开始使用。

---

## 4. 日常使用流程

当你成功登录后，整体的使用流程如下：

```
注册/登录 → 创建项目 → 上传设定文档 → 配置写作风格 → 开始写作
```

### 4.1 创建项目

登录后你会看到项目列表页，点击「创建项目」按钮，输入项目名称和描述（比如小说名和简介）。

### 4.2 管理知识库

进入项目后，点击左侧导航的「知识库」，你可以：

- **上传文档**：把你的世界观设定、角色介绍、章节草稿等以文档形式上传
- **查看版本**：每次编辑文档都会自动创建新版本，可以回溯
- **触发索引**：上传后点击「索引」，系统会将文档切分成片段并向量化

> 💡 **提示**：首次使用建议先上传你的小说大纲和主要角色设定，这样 AI 生成时才有上下文可以参考。

### 4.3 配置系统提示词

点击「设置」，你可以：

- **编写系统提示词**：告诉 AI 你想要的写作风格（例如"冷峻克制的第三人称叙事"）
- **发布版本**：修改后保存草稿 → 确认无误后点击「发布」
- **版本回滚**：任何时候都可以回滚到之前发布的版本
- **查看版本历史**：所有版本的变更记录一目了然

### 4.4 在写作工作台生成草稿

这是核心功能入口，点击「写作工作台」，界面分左右两栏：

**左侧** — 项目上下文面板，展示：
- 项目名称
- 已录入章节数
- 大纲状态
- 当前人物设定

**右侧** — 操作区域，包含：

1. **填写生成参数**
   - 章节号：比如第 5 章
   - 本章目标：用一句话描述这章要写什么（例如"主角在港口与导师对峙"）
   - 叙事视角：第一人称/第三人称等
   - 必须包含：列出这章一定要出现的情节元素
   - 禁止内容：列出要避免的剧情

2. **点击「生成章节草稿」**
   - AI 会根据你的设定、大纲、历史章节和系统提示词生成草稿
   - 生成过程是流式的（逐字显示），就像 ChatGPT 打字一样

3. **查看生成结果**
   - 草稿正文
   - 引用证据：显示 AI 参考了哪些设定文档
   - 一致性提示：如果有角色设定冲突或时间线问题会告警
     - 🟢 **pass**：无冲突
     - 🟡 **warn**：有潜在风险，建议检查
     - 🔴 **block**：有严重冲突，建议修改

4. **接受草稿**
   - 满意的话点击「接受草稿」，草稿会自动保存到项目章节中
   - 不满意可以修改参数重新生成

---

## 5. 常见问题

### Q：我完全不懂代码，可以用这个项目吗？

目前 Aether Quill 需要一些基础的技术知识来启动（安装 Node.js、运行命令行等）。如果你只是想试用，建议找一位开发者朋友帮你搭建好环境，之后日常使用只需要浏览器即可。

### Q：没有 AI 模型的 API Key 怎么办？

- **DeepSeek**：注册 [platform.deepseek.com](https://platform.deepseek.com) 获取 API Key，新用户有免费额度
- **SiliconFlow**：注册 [siliconflow.cn](https://siliconflow.cn) 获取 API Key

### Q：不想花钱能用吗？

项目启动后即便没有配置真实模型 API，RAG 编排服务也会使用**模拟模式**（Mock Mode），会生成示例文本供你体验界面功能。但需要真实的 AI 生成效果则需要配置 API Key。

### Q：支持哪些 AI 模型？

目前内置支持：
- **DeepSeek**（deepseek-chat 等模型）
- **SiliconFlow**（Qwen/Qwen2-7B-Instruct 等模型）

通过 Provider Adapter 模式可以方便地扩展更多供应商。

### Q：数据存在哪里？

所有数据默认存储在本地：
- **用户和项目数据**：`services/api/data/` 目录下的 JSON 文件
- **生成追踪记录**：`services/rag-orchestrator/data/traces.json`
- **Prompt 模板**：`services/api/data/prompt-templates.json`
- **向量数据**：存储在 Qdrant 容器中

### Q：想重置所有数据怎么办？

```bash
# 停止容器（会清除持久化数据）
docker compose down -v

# 删除本地数据文件
rm -rf services/api/data/ services/rag-orchestrator/data/

# 重新启动
docker compose up -d
```

### Q：如何部署到服务器？

项目提供了部署脚本：

```bash
# 金丝雀部署（分阶段 10% → 30% → 100%）
./scripts/deploy-canary.sh api v1.0.0

# 全量部署
./scripts/deploy.sh all v1.0.0

# 部署后验证
./scripts/deploy-smoke.sh
```

### Q：运行时出了问题怎么排查？

```bash
# 检查所有服务健康状态
./scripts/health-check.sh

# 查看 observability 指标
curl http://localhost:3001/api/observability/metrics

# 按 trace ID 追踪一次生成请求
curl http://localhost:3001/api/observability/traces/<trace-id>
```

---

## 开源协议

MIT License —— 可以自由使用、修改和分发。
