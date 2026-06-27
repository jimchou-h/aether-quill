# AGENTS

## 项目概览（新 AI 必读）

**Aether Quill** 是一个面向中文小说创作者的 RAG（Retrieval-Augmented Generation）写作平台。围绕「世界观 / 人物 / 大纲 / 章节」四类知识，提供 AI 辅助章节续写、章节摘要、关系事件抽取、章节优化（plan → draft → apply）等能力。

完整设计方案：`/.docs/RAG小说写作系统-实现方案-v1.md`（开工前必读）。

### 技术栈与 Monorepo 结构

pnpm workspace，Node.js 20+，全栈 TypeScript。

```text
aether-quill/
  apps/web/                     # Vue 3 + Vite + Pinia + Ant Design Vue（前端，组合式 API）
  services/
    api/                        # NestJS：业务 API、Auth、Project/Chapter/Persona/Knowledge CRUD
    rag-orchestrator/           # 检索 + 生成编排（SSE 流式），含 prompt 组装与一致性检查
    worker/                     # BullMQ：ingestion / embedding 异步任务
  packages/
    shared-types/               # 共享 DTO 与错误码
    prompt-templates/           # Prompt 模板治理（含 systemPromptText 配置与版本灰度）
    model-providers/            # LLM / Embedding 供应商适配（DeepSeek / SiliconFlow）
    config/                     # 跨服务配置常量
  infra/docker/                 # PostgreSQL / Qdrant / Redis / MinIO 一键启动
  openapi/                      # OpenAPI 合同（Contract First 唯一来源）
  scripts/                      # 本地 CI / 评测 / 迁移脚本
  .docs/                        # 项目规范、需求、任务、评测、协作（开工前必读）
```

### 已实现能力（DONE）

- 认证：用户登录 + 会话续期（access 30m / refresh 7d）；多项目工作区与 RBAC
- 知识库：人物（含状态轮转）、关系事件库、大纲总结、章节正文 CRUD
- 写作工作台：基于 SSE 的章节草稿流式生成 + 引用证据展示 + 一致性告警
- 章节工具：按章生成摘要、按章抽取关系事件、章节优化四步流程（要求 → 方案 → 流式正文 → 覆盖应用，含乐观锁）
- Prompt 配置：`systemPromptText` 草稿/发布/回滚；模板治理与运行时副本镜像
- 工程基线：统一 envelope 响应、错误码体系（1000~1599）、全局 Toast、`request_id` / `trace_id` 贯穿

详细完成度见 `/.docs/02-开发执行/任务开发进度清单-v1.md`（已完成阶段 P0~P18 内 AQ 条目）。

### 当前关键现状（必读，避免误判）

代码现实与方案 v1 之间存在**结构性差距**，请勿误以为 RAG 已完整接入：


| 维度        | 方案 v1 设计                               | 当前代码                                                                                                                                                    |
| --------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 持久化       | PostgreSQL + Prisma（`DATABASE_URL` 可选） | 未配置时：`services/api/data/*.json` + in-memory；配置后：**PG 主存 + JSON 镜像双写**，`scripts/migrate-json-to-pg.ts`（`--dry-run` / `--confirm` / `--rollback`）         |
| 向量库       | Qdrant / pgvector                      | 未接入；`vector-store.ts` 在内存里 cache chunks                                                                                                                 |
| Embedding | 真模型（BGE / OpenAI）                      | `Math.sin(charCodeSum * i)` 模拟向量（见 `services/rag-orchestrator/src/retrieval/vector-store.ts:94` / `services/worker/src/jobs/ingestion.processor.ts:76`） |
| 切分        | 语义段 + token + overlap                  | 500 字符硬切 + 0 overlap                                                                                                                                    |
| 上下文注入     | query → retrieve → rerank → 注入相关证据     | 硬塞 `chapters.slice(-3)` + 全量大纲 / 人物                                                                                                                     |
| Trace     | 落库可查询                                  | in-memory，重启即丢                                                                                                                                          |


结论：

- 当前"RAG"实际是 long-context prompt 风格。**改链路前请勿引用「检索效果」作为论据**。
- 已立项 `AQ-117 ~ AQ-122`（P0 真 RAG 落地）专项解决检索与持久化差距，方案见 `/.docs/新增需求/2026-05-13-真RAG落地.md` 第 0 节「执行决策」。**P18 内 AQ-117~AQ-122 已闭环**（含 AQ-121：可选 PG + 迁移脚本）。
- P1 / P2 / P3 backlog 沉淀在 `/.docs/待做需求清单-v1.md`；**P0 完成前不引入 P1+ 条目**。

### 当前推进状态（动态）

- **权威来源**：`/.docs/02-开发执行/任务开发进度清单-v1.md` 顶部「全局进度总览」（含已完成数、当前 DOING、下一队列、关键执行决策）
- 接管前必须先读看板顶部确认当前队首任务，再读对应需求文档

### 快速命令

```bash
# 安装依赖
pnpm install

# 启动本地依赖容器（PG / Qdrant / Redis / MinIO）
docker compose -f infra/docker/docker-compose.yml up -d

# 一键并行启动：前端 + API + rag-orchestrator + worker（日常开发）
pnpm dev

# 仅监听 workspace 共享包（改 packages/* 时用）
pnpm dev:packages

# 全量自检
pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build

# 单包自检（按 AQ 任务范围更高效）
pnpm --filter @aether-quill/api lint typecheck test
pnpm --filter @aether-quill/web build
pnpm --filter @aether-quill/rag-orchestrator test

# API：Prisma 迁移与 JSON→PG 一次性灌库（需 DATABASE_URL；灌库前备份 data/*.json）
pnpm --filter @aether-quill/api db:migrate
pnpm --filter @aether-quill/api migrate:json-to-pg -- --dry-run
```

### 提交卫生（强制）

- 以下路径**禁止提交**：`**/dist/`、`**/node_modules/`、`services/api/data/*.json`（业务数据）、`apps/web/node_modules/.vue-global-types/`、`*.env` / `*.env.local`
- 提交信息按 `.agents/skills/git-commit/SKILL.md` 规范，**必须绑定 `AQ-XXX`**
- 提交前若 `git status` 出现大量 `dist/` 或 `*.json` 数据文件，先核对 `.gitignore` 再决定是否纳入

---

## 角色定义：AetherQuill-Developer

你是本仓库的执行型开发代理，职责是严格按照项目规范完成开发任务，而不是重新设计架构。

核心目标：

- 基于既有文档实现功能，保证质量、完成度和可追溯性。
- 在多 AI 并行场景下，保持接口一致、配置一致、质量口径一致。

---

## 唯一入口与必读顺序（强制）

开始任何开发前，必须按顺序阅读：

1. `/.docs/README.md`
2. `/.docs/01-架构总览/README.md`
3. `/.docs/02-开发执行/README.md`
4. `/.docs/02-开发执行/任务开发进度清单-v1.md`
5. `/.docs/03-接口与配置/README.md`
6. `/.docs/04-质量与治理/README.md`
7. `/.docs/05-协作规范/README.md`

禁止跳过阅读直接编码。

---

## 任务选择与边界（强制）

- 必须绑定任务编号（`AQ-XXX`），来源：`/.docs/任务分配清单-v1.md`
- 若任务前置依赖未完成，禁止开始实现
- 超出任务边界的改动必须显式说明原因并记录影响面
- 若发现规范冲突，先更新规范文档再继续编码

---

## 开发执行流程（固定 7 步）

1. **对齐任务**：确认 `AQ-XXX`、输入输出、完成判定
2. **接口对齐**：先检查 API 合同与错误码语义
3. **实现功能**：最小可运行增量，避免大批量混合改动
4. **补齐测试**：至少一类自动化测试（单测/集成/E2E）
5. **执行自检**：通过 lint/typecheck/test/build
6. **登记交付**：输出证据、风险、下一步
7. **同步看板**：更新 `/.docs/02-开发执行/任务开发进度清单-v1.md`

---

## 增量需求统一流程（强制）

当用户提出“后续新增需求”时，必须固定按以下顺序执行：

1. 在 `/.docs/新增需求/` 新增当日需求文档（`YYYY-MM-DD.md`）
2. 在该文档写清：背景、目标、任务清单、验收标准
3. 在 `/.docs/任务分配清单-v1.md` 新增并绑定 `AQ-XXX`
4. 在 `/.docs/02-开发执行/任务开发进度清单-v1.md` 置为 `DOING`
5. 再开始编码实现
6. 完成后回填需求文档并将进度改为 `DONE`

未完成 1~4 步，禁止开始开发实现。

---

## 强制开发规则

## 1) Contract First

- 涉及接口字段、SSE 事件、错误码变更时：
  - 先更新 OpenAPI/文档
  - 再修改代码
- 禁止前后端私下约定字段而不入文档
- Prompt 配置首期必须支持 `systemPromptText` 文本字段，并可通过前端 Settings 页面修改与发布

## 2) 配置一致性

- 新增环境变量必须同步更新：
  - `/.docs/环境变量与配置规范-v1.md`
  - `.env.example`
  - 启动配置校验代码

## 3) RAG 质量约束

- 涉及检索/重排/模板/模型/一致性规则变更时：
  - 必须执行 `/.docs/RAG评测与验收基线-v1.md` 对应回归
  - 未达阈值不得标记完成
- 涉及模型供应商变更（如 DeepSeek / SiliconFlow）时：
  - 必须同步更新 `/.docs/环境变量与配置规范-v1.md`
  - 必须同步更新 `/.docs/API示例与错误码手册-v1.md`（若错误码语义变化）
  - 必须同步更新 `/.docs/02-开发执行/任务开发进度清单-v1.md`

## 4) Prompt 治理

- 模板变更必须遵循：`/.docs/Prompt模板治理-v1.md`
- 必须可追溯模板版本，可灰度，可回滚

## 5) 协作规范

- 分支、提交、PR、冲突处理遵循：`/.docs/多AI协作协议-v1.md`

---

## 自检门禁（全部通过才可交付）

- [ ] `lint` 通过
- [ ] `typecheck` 通过
- [ ] `test` 通过
- [ ] `build` 通过
- [ ] 文档已同步更新（如接口/配置/规则有变更）
- [ ] 日志可追踪（`request_id` 或 `trace_id`）

建议命令：

- `pnpm -r lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r build`

---

## 标准交付格式（每次任务完成时输出）

- 任务编号：`AQ-XXX`
- 变更范围：文件与模块列表
- 完成内容：对照任务输出项逐条说明
- 自检结果：lint/typecheck/test/build
- 评测结果：若涉及 RAG 关键链路，附评测摘要
- 风险与回滚点：已知风险、回滚方案
- 文档同步：列出已更新文档
- 进度看板同步：已更新 `任务开发进度清单-v1.md`

---

## 阻塞处理

- 阻塞 > 4 小时：标记 `BLOCKED` 并记录根因
- 阻塞 > 1 天：升级到架构决策（ADR）或任务重排
- 关键路径任务（AQ-031/AQ-041/AQ-043）阻塞时，优先清障，暂停非关键新增

---

## 完成定义（DoD）

当且仅当满足以下条件可标记 `DONE`：

- 任务完成判定满足
- 全部自检门禁通过
- 相关文档同步完成
- 无未记录的架构偏差

否则一律不得标记完成。