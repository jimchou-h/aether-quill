# Tasks — add-workbench-scene-rewrite

> 竖切原则：每项端到端可验收。Contract First，禁止改旧三模式行为与 `rewriteMode` 枚举。

## 1. 合同与纯函数

- [x] 1.1 OpenAPI：新增 `chapter-optimize-workbench-plan.yaml`（SSE：`start/stage/content/end/error`，入参 `instruction/profile?/startOffset/endOffset/baseUpdatedAt/sourceText/appearingCharacters?`）并挂入 `openapi.yaml`；扩展 workbench draft 请求体增加可选 `mode`（`direct|from-plan`，缺省 `direct`）与 `planText`；**禁止**改 `rewriteMode` 枚举与旧 plan/draft 路径；补契约 snapshot：新路径存在、draft 旧请求体仍合法且 `rewriteMode` 枚举不变；AC：contract 校验通过、前端类型由合同生成无破坏
- [x] 1.2 纯函数（`chapter-optimize-workbench.util.ts`）：新增 `assertWorkbenchPlanRequest`（沿用范围/偏移/只读上下文切分校验）、`buildWorkbenchPlanUserPrompt`（四块方案引导 + 只输出方案）、`buildWorkbenchSceneDraftUserPrompt`（携带已确认 planText，行文层约束，**不得**含账本/举证/准入/验收术语）；扩展 draft 请求校验支持 `mode` 与 `planText`（from-plan 缺 planText 抛 400、范围多窗抛 400）；**动 draft 分支前先补旧行为红灯基线**：现有 sex/prose 的 draft 请求规范化结果与 user prompt 文本快照测试先落盘；AC：单测覆盖空范围/空要求/缺 planText/超长范围四类拒绝、prompt 文本断言无流程术语且含散场状态硬锁、旧两档快照在新分支合入前后字节不变

## 2. Prompt 与服务编排

- [x] 2.1 登记 `chapter.optimize.workbench-plan-scene` v1.0.0 与 `chapter.optimize.workbench-draft-scene` v1.0.0：`packages/prompt-templates` + API `task-prompt-defaults` + orchestrator `task-prompt-defaults` 三处文本一致；plan 模板含四要件（入场/散场清单、改动账本、篇幅预算、边界声明）与「情绪/伏笔段删除须补偿」；draft 模板允许场内删/加/重排并锁定散场状态；默认草稿状态、可回滚；AC：三处镜像一致性测试通过，Settings 模板列表可见且旧四模板不变
- [x] 2.2 服务端端到端：API 新增 `POST .../workbench/plan`（鉴权 owner/editor、SSE 转发 orchestrator plain/stream 生成、失败映射 1502）；`optimizeChapterWorkbenchDraftStream` 增加 from-plan 分支（单窗、templateKey 用 draft-scene、仍走现有 context sync 与 SSE 回调、拼回与质量校验复用）；direct 分支零改动；AC：接口测覆盖 plan 流式产出方案、from-plan 成稿成功、from-plan 缺 planText/超长返回 400、旧 sex/prose 请求快照行为不变

## 3. 前端创编流程

- [x] 3.1 `ChapterOptimizeWorkbenchDialog.vue` + `services/api.ts`：range 步骤增加第三模式「按场创编」；选中后步骤机进入 `range → plan → generate → review → apply`；plan 步骤流式渲染可编辑方案，提供「确认方案/重新生成/编辑后确认」，未确认禁止生成；提交 draft 带 `mode=from-plan` 与 `planText`；两直出档跳过 plan 步骤；范围超约 5200 字时发起前提示划小；AC：组件测覆盖模式切换、未确认不可生成、确认后带参发起、直出档无 plan 步骤
- [x] 3.2 创编模式成稿后复用现有 review（前端按全开 kind 口径展示与过滤）、fix-span（锚点唯一命中）、范围对照与整章 apply（乐观锁）；不新增应用路径；AC：组件测覆盖检查条目过滤、点修拼回、应用载荷为整章且范围外字节不变；旧两档同路径测试保持通过
- [ ] 3.3 回归保护：`ChapterOptimizeDialog.vue` 相关单测（from-plan/direct/auto-loop）与工作台旧两档 e2e/smoke 全部保持通过，证明旧行为零改动；AC：`pnpm --filter @aether-quill/web test` 与 e2e（若本地可跑）通过，失败项为零

## 4. 自检与评测

- [ ] 4.1 全量门禁：web / api / rag-orchestrator / prompt-templates / shared-types 的 lint、typecheck、test、build 全部通过；AC：对应 `pnpm --filter` 命令绿灯，无新增诊断
- [ ] 4.2 RAG 评测基线回归：新模板发布前按 `RAG评测与验收基线-v1.md` 跑关键链路回归，重点场景——创编成稿落实删/加/重排、散场状态可接 after-context、范围外零改动、无注水/答题感、长范围被拒；旧两档基线不回退；AC：达阈值后模板发布为默认，未达则保持草稿并在 change 内记录缺口
