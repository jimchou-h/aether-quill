# Aether Quill — 小说创作者的 RAG 写作助手

> **一句话介绍**：Aether Quill 是一个面向中文小说创作者的 AI 写作辅助平台，围绕「世界观 / 人物 / 大纲 / 章节」四类知识，提供检索增强生成（RAG）、章节续写、摘要、关系抽取与一致性检查等能力。

---

## 目录

1. [这个项目能做什么](#1-这个项目能做什么)
2. [整体结构长什么样](#2-整体结构长什么样)
3. [快速开始（5 分钟上手）](#3-快速开始5-分钟上手)
4. [日常使用流程](#4-日常使用流程)
5. [常见问题](#5-常见问题)
6. [开发者入口](#6-开发者入口)

---

## 1. 这个项目能做什么

假设你正在写一本小说，里面有很多角色、世界观设定和复杂的时间线。你面临几个问题：

- **设定记不住**：写到第 20 章时，容易忘了某个角色的年龄或某个事件发生的顺序
- **前后矛盾**：前面说主角左撇子，后面写他用右手拔剑
- **知识分散**：角色设定、地理信息、势力关系散落在不同文档里，写的时候找不到

**Aether Quill 就是来解决这些问题的。**

| 功能 | 说明 |
| :--- | :--- |
| 📚 **知识库与文档** | 管理世界观、角色卡、参考资料等文档；支持类型标注、版本历史与向量索引 |
| 👤 **人物设定** | 人物卡草稿/发布、按章出场状态与结构化快照（着装、状态等） |
| 🔗 **关系管理** | 关系事件库（剧情互动）+ **身份关系图**（师徒/恋人等稳定称谓，双视图切换） |
| 🔍 **智能检索** | 基于 Qdrant 向量检索 + 重排，写作时召回相关设定与章节证据 |
| ✍️ **写作工作台** | SSE 流式生成章节草稿，展示引用证据与一致性告警 |
| 📖 **章节管理** | 正文 CRUD、批量/单章摘要、导入导出、结构化解析、四步章节优化（方案 → 草稿 → 应用） |
| ⚙️ **项目设置** | 系统提示词、摘要注入条数、生成温度、保存后自动更新人物/关系事件等 |
| 📊 **可观测性** | 生成 trace、指标与日志，便于排查一次写作请求 |

---

## 2. 整体结构长什么样

```text
aether-quill/
├── apps/web/                  # 前端（Vue 3 + Vite + Pinia + Ant Design Vue）
├── services/
│   ├── api/                   # NestJS：认证、项目、人物、章节、知识库 CRUD
│   ├── rag-orchestrator/      # Express：检索、重排、生成编排、一致性检查
│   └── worker/                # BullMQ：文档入库、切分、Embedding 异步任务
├── packages/
│   ├── shared-types/          # OpenAPI 生成的共享类型
│   ├── model-providers/       # LLM / Embedding 供应商适配
│   ├── prompt-templates/      # Prompt 模板治理
│   └── config/                # 跨服务配置常量
├── openapi/                   # API 合同（Contract First）
├── scripts/                   # 部署、迁移、评测脚本
├── infra/docker/              # PostgreSQL / Redis / Qdrant / MinIO
└── .docs/                     # 需求、架构、任务进度与协作规范
```

**技术栈速览**：

- **前端**：Vue 3 + TypeScript + Vite + Pinia + Ant Design Vue
- **后端**：NestJS（API）+ Express（RAG 编排）+ BullMQ Worker
- **存储**：默认 JSON 落盘（`services/api/data/`）；可选 PostgreSQL + Prisma 双写
- **向量与队列**：Qdrant + Redis + BullMQ
- **模型**：DeepSeek / SiliconFlow（LLM 与 Embedding 可分别配置）

---

## 3. 快速开始（5 分钟上手）

### 前置条件

- Node.js 20+
- pnpm（`npm install -g pnpm`）
- Docker Desktop（PostgreSQL、Redis、Qdrant、MinIO）

### 第一步：下载项目

```bash
git clone <仓库地址>
cd aether-quill
```

### 第二步：安装依赖

```bash
pnpm install
```

### 第三步：启动依赖服务

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

验证容器状态：

```bash
docker compose -f infra/docker/docker-compose.yml ps
curl http://localhost:6333/healthz   # Qdrant
```

### 第四步：配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，**至少**配置 LLM 与 Embedding（RAG 链路启动时会校验向量相关变量）：

```env
# LLM（二选一或按 .env.example 说明配置）
DEEPSEEK_API_KEY=sk-your-deepseek-key
# SILICONFLOW_API_KEY=sk-your-siliconflow-key

# 向量 / Embedding（本地开发默认走 Qdrant + SiliconFlow BGE）
VECTOR_PROVIDER=qdrant
QDRANT_URL=http://localhost:6333
EMBEDDING_PROVIDER=siliconflow
EMBEDDING_MODEL=BAAI/bge-large-zh-v1.5
SILICONFLOW_API_KEY=sk-your-siliconflow-key
```

完整变量说明见 `.env.example` 与 `/.docs/环境变量与配置规范-v1.md`。

> 本地 CI 或无密钥调试可设 `AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION=true`（**禁止用于生产**）。

### 第五步：启动应用

**推荐：一条命令并行启动前端 + API + RAG 编排 + Worker**

```bash
pnpm dev
```

| 服务 | 地址 |
| :--- | :--- |
| 前端 | http://localhost:5173 |
| API | http://localhost:3000 |
| RAG 编排 | http://localhost:3001 |
| Worker | http://localhost:3002 |

也可单独启动某一服务，例如：

```bash
pnpm --filter @aether-quill/web dev
pnpm --filter @aether-quill/api dev
pnpm --filter @aether-quill/rag-orchestrator dev
pnpm --filter @aether-quill/worker dev
```

### 第六步：打开浏览器

访问 **http://localhost:5173**，注册或登录后即可创建项目。

---

## 4. 日常使用流程

```text
注册/登录 → 创建项目 → 录入知识/人物 → 配置写作风格 → 章节管理 → 写作工作台生成
```

进入项目后，左侧导航包含：

| 页面 | 用途 |
| :--- | :--- |
| **写作工作台** | 填写章号、目标、视角等，流式生成草稿并查看引用证据 |
| **知识库** | 维护设定文档（角色卡、世界观等），触发索引供检索使用 |
| **人物** | 管理人物卡；查看**身份关系 / 剧情事件**双视图关系图 |
| **关系事件** | 维护章节级 protagonist ↔ counterparty 剧情互动 |
| **章节** | 正文编辑、摘要、导入导出、关系事件抽取、章节优化 |
| **设置** | 系统提示词、摘要/温度/自动更新开关等项目级配置 |

### 4.1 创建项目

在项目列表页点击「创建项目」，填写名称与简介。

### 4.2 准备知识与人设

1. **知识库**：新建或导入设定文档，按类型标注（角色卡、世界观等），保存后执行索引。
2. **人物**：创建人物卡并发布；保存章节正文后可自动更新出场状态与按章快照。
3. **关系**：保存章节时可抽取关系事件；对章节跑 **LLM 摘要** 后，系统会非阻塞抽取**身份关系**（如师徒、恋人），并在人物关系图中展示。

### 4.3 配置系统提示词

在「设置」中编写项目级 `systemPromptText`，调整摘要注入条数、生成温度等。Prompt 配置模块另支持草稿 / 发布 / 回滚（见设置与 API 文档）。

### 4.4 章节管理与优化

在「章节」页可以：

- 编辑章节正文与标题
- 单章或批量生成摘要（摘要成功后合并身份关系）
- 导入/导出小说章节
- 对单章发起**优化流程**：填写要求 → 生成方案 → 流式正文 → 确认覆盖（含乐观锁）

### 4.5 在写作工作台生成草稿

1. 填写章节号、本章目标、叙事视角、必须包含/禁止内容等。
2. 点击生成，观察 SSE 流式输出、引用证据与一致性告警（pass / warn / block）。
3. 满意后接受草稿，正文写入项目章节。

---

## 5. 常见问题

### Q：我完全不懂代码，可以用这个项目吗？

目前需要基础环境搭建能力（Node.js、Docker、命令行）。搭建完成后，日常使用以浏览器为主。

### Q：没有 AI 模型的 API Key 怎么办？

- **DeepSeek**：<https://platform.deepseek.com>
- **SiliconFlow**：<https://siliconflow.cn>（Embedding 与部分 LLM 常用）

未配置密钥时，可通过 `AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION=true` 跳过基础设施校验以便跑通界面，但**真实生成与向量检索仍需有效 Key**。

### Q：支持哪些 AI 模型？

内置 **DeepSeek**、**SiliconFlow** 适配；Embedding 默认 `BAAI/bge-large-zh-v1.5`。扩展新供应商见 `packages/model-providers/`。

### Q：数据存在哪里？

| 数据 | 默认位置 |
| :--- | :--- |
| 项目 / 人物 / 章节 / 身份关系等 | `services/api/data/project-workspaces.json` |
| Prompt 模板 | `services/api/data/prompt-templates.json` |
| 生成 trace（编排层） | 内存 + 可选落盘（重启可能丢失，见 `.docs`） |
| 向量 | Qdrant 容器 |
| 可选 PostgreSQL | 配置 `DATABASE_URL` 后 PG 主存 + JSON 镜像双写 |

迁移脚本：`pnpm --filter @aether-quill/api migrate:json-to-pg -- --dry-run`

### Q：想重置所有数据怎么办？

```bash
docker compose -f infra/docker/docker-compose.yml down -v
rm -rf services/api/data/ services/rag-orchestrator/data/
docker compose -f infra/docker/docker-compose.yml up -d
```

### Q：如何部署到服务器？

```bash
./scripts/deploy-canary.sh api v1.0.0   # 金丝雀
./scripts/deploy.sh all v1.0.0          # 全量
./scripts/deploy-smoke.sh               # 冒烟验证
```

### Q：运行时出了问题怎么排查？

```bash
./scripts/health-check.sh
curl http://localhost:3001/api/observability/metrics
curl http://localhost:3001/api/observability/traces/<trace-id>
```

### Q：为什么 `http://localhost:3000/api/projects/workbench` 会报错？

`workbench` 是前端路由名，不是项目 ID。先登录拿 token，再查项目列表取得真实 `projectId`：

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"demo@aetherquill.local\",\"password\":\"demo123\"}"

curl http://localhost:3000/api/projects \
  -H "Authorization: Bearer <token>"

curl http://localhost:3000/api/projects/1715403000000/workspace \
  -H "Authorization: Bearer <token>"
```

`workspace` 响应含 `personas`、`knowledge`、`identityRelations` 等写作快照字段（OpenAPI：`GET /api/projects/{id}/workspace`）。

---

## 6. 开发者入口

参与开发或二次集成前，请先阅读：

| 文档 | 说明 |
| :--- | :--- |
| [`AGENTS.md`](./AGENTS.md) | AI / 开发者协作入口、快速命令、提交规范 |
| [`.docs/README.md`](./.docs/README.md) | 需求、架构、接口、质量与任务看板 |
| [`openapi/openapi.yaml`](./openapi/openapi.yaml) | API 合同（Contract First） |

常用自检：

```bash
pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build
```

单包示例：

```bash
pnpm --filter @aether-quill/api lint typecheck test
pnpm --filter @aether-quill/rag-orchestrator test
pnpm --filter @aether-quill/web build
```

---

## 开源协议

MIT License —— 可以自由使用、修改和分发。
