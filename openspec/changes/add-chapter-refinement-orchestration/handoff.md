# DeepSeek-v4-flash 开发交接

本 change 已进入开发；2026-10-07 tasks.md 登记 AQ-380～AQ-382 完成，真实模型质量评测尚未完成。本次文档调整未独立复验代码或测试。开发执行者是 DeepSeek-v4-flash；生产运行模型沿用用户项目配置。

当前接手优先阅读 [early-sample-validation.md](early-sample-validation.md)，沿用既有任务编号，把真实候选稿与作者反馈前置。完成当前小步 TDD，若缺少必要的流完整性／预算保护则先完成 AQ-383 对应部分；不要重做已经完成的任务或重新拆全套票。

## 1. 可直接给开发代理的指令

> 按 unified-dev-workflow 接管 openspec/changes/add-chapter-refinement-orchestration。先阅读仓库 AGENTS.md、必读索引、该 change 的 README、proposal、design、spec、api-contract、prompt-design、evaluation、early-sample-validation、tasks 和 handoff；核验现有代码事实与当前任务队列。沿用已经绑定的任务／issue，从首个未完成任务继续，先按前置样章验证安排取得真实候选稿及反馈。Contract First 更新所需 OpenAPI，不跳过测试和正式发布验收，不修改旧写作模式默认行为；发现规范或代码事实冲突先修正文档。逐项勾选真实完成任务，不将 mock 测试当成质量验收。

最初设计轮只批准文档；作者现已说明另一个开发代理在执行到 AQ-382。本次只调整验证文档，不在此聊天启动开发、调用模型、修改业务正文或向其他聊天发送指令。

## 2. 接管检查

1. 先读 `.docs/README.md` 及架构、开发执行、接口配置、质量治理、协作索引和进度看板顶部。新需求 SSOT 为本 change，不另建一套 active `.docs` 需求。
2. 阅读 `CONTEXT.md`、`docs/agents/issue-tracker.md`、`docs/agents/domain.md`；只有开始实现时才按规范映射 AQ 编号和 issue。旧看板登记仅放编号／状态／链接。
3. 查看 `git status`，保留无关文件和用户改动；不要误提交 dist、node_modules、业务 JSON、环境变量及本地指南。
4. 仓库存在 `.codegraph/`，理解代码优先 CodeGraph。本设计阶段 CLI/MCP 不可用才降级到 rg；开发时重新检测可用性，不把这个暂时状况当作永久配置。
5. 若 openspec 可用，先运行状态和 strict validate，修正结构；设计阶段该 CLI 不可用，验证状态为 skipped。模板变更遵循 `.docs/Prompt模板治理-v1.md`，评测遵循 `.docs/RAG评测与验收基线-v1.md`。

## 3. 代码导航与复用边界

以下路径为已检查过的导航入口；实现前核对最新代码，函数名比历史行号可靠。

| 入口 | 用途／需注意 |
|---|---|
| `services/api/src/modules/projects/chapter-optimize.util.ts` | 旧分段及 draft 执行解析；按段落数分组的 splitIntoSegments 不满足新场景范围要求 |
| `services/api/src/modules/projects/chapter-auto-loop.util.ts` | 保留分隔串的窗口拆分、锚点纯工具可复用；旧 tail 默认 400 不作为新上下文策略 |
| `services/api/src/modules/projects/chapter-auto-loop.engine.ts` | DI 测试风格、局部条目筛选可参考；不复制整个每窗独立循环引擎 |
| `services/api/src/modules/projects/chapter-auto-loop.service.ts` | SSE 生成 client 的现有使用、设置解析与项目授权参考 |
| `services/api/src/modules/projects/chapter-auto-loop-session.store.ts` | 旧 Map session 不能当 PG checkpoint；新 run 独立存储 |
| `services/api/src/modules/projects/chapter-generation-stream.client.ts` | 共用 orchestrator SSE client；新增严格 completion 为可选兼容扩展 |
| `services/api/src/common/sse-stream.util.ts` | 15 秒心跳；其订阅断开 abort 只能断观察，不绑定新后台 run |
| `services/api/src/modules/projects/projects.service.ts` | workbench scene 链路及 applyChapterOptimization；复用最终 apply，不临时保存候选 |
| `services/api/src/modules/projects/projects.module.ts` | 新窄服务、repository 和生成 gateway 的 DI 注册 |
| `services/api/prisma/schema.prisma` | 新独立 run 表；参考现有 Project、Chapter 关系及可选 PG 行为 |
| `services/api/src/modules/task-prompts/task-prompt-defaults.ts` | Settings task key 白名单及默认文本；必须同步治理包和镜像 |
| `services/rag-orchestrator/src/main.ts` | /api/generate 上下文、prompt override、冻结参考的入口 |
| `services/rag-orchestrator/src/generation/generation.service.ts` | 原 provider finishReason 与 stream 完成统计；路径变化时用符号定位 |
| `services/rag-orchestrator/src/retrieval/knowledge-retrieval.ts` | 模板分类、短 query 与注入策略；不要把原文全文当 query |
| `packages/config/src/generation-profile/index.ts` | utility/writing tier 与运行时模型路由 |
| `packages/config/src/writing-style-samples/index.ts` | 文风样本分类、预算及当前章节排除 |
| `apps/web/src/components/chapters/ChapterOptimizeDialog.vue` | 新入口、旧 mode 隔离、原有对比／应用 UI |
| `openapi/`、`packages/shared-types/`、`packages/prompt-templates/` | 合同、DTO、模板版本治理的实际修改范围 |

建议新增名字：`chapter-refinement.engine.ts`、`chapter-refinement-range.util.ts`、`chapter-refinement.service.ts`、`chapter-refinement-run.repository.ts`。名字可按项目规范微调，职责不能混成一个巨大 ProjectsService 分支。

## 4. 易误判处

- 历史文档写「正文整章生成」，当前 direct/from-plan 已有分段代码；不要基于旧描述重复开发。
- 自动循环在窗内看前后段落，不等于能看下一诊断窗；新链路要显式传真实邻文和场内状态。
- 当前 workbench review 的输入不足以锁定原文／计划／后文；新检查不能直接沿用旧候选单独检查。
- provider 能解析 finishReason，不等于 API client 能拒绝非空截断稿；完整性元数据需要贯穿三层。
- 在一个地方加入 templateKey 不等于档位、样本、摘要、记忆注入全都正确；按五键矩阵测试。
- 旧 apply 的 1307 手册 HTTP 和异常实现有差异；核验全局 filter，先修合同说明，保持旧路径语义。
- DeepSeek-v4-flash 的名称不是 token 窗口／输出限额的来源；记录真实运行配置，未知时采取保守估算。
- mock 长章、检索离线评测、任务 checkbox 均不能替代真实文字盲评或发布证据。

## 5. 实施完成后的交付

交付绑定任务编号与本 change，列出范围、各 AC 证据、lint/typecheck/test/build、真实模型评测及模板版本、未通过项、回滚方法。任务进度只维护 tasks.md，旧看板按需要同步链接及状态。

若因环境没有真实模型、PG 或评审人员而不能完成门禁，写清未完成项，保留对应 checkbox 未勾选和入口未发布；不要以「主体开发完成」将整个 change 宣告 DONE。
