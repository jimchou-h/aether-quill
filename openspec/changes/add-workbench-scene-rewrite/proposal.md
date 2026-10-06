## Why

按场成稿现有「感官加料 / 日常文笔」两档只允许范围内同义重写，prompt 明确禁止另起剧情；用户若想在一场内部做结构级改动（删拍、加戏、重排顺序、扩写新波折），只能用整章「方案改写」，但那会波及范围外正文。两条路径之间缺一档：**拥有方案改写的结构自由度、但作用域严格限定在划定的一场内**。

## What Changes

- 按场成稿工作台新增第三种模式「按场创编」：划范围 → 生成**范围方案**（用户可编辑、确认）→ 按方案生成范围成稿 → 现有检查 / 点句修复 → 拼回整章应用。
- 新增 SSE 端点 `POST .../optimize/workbench/plan`：吃划选范围与优化要求，流式输出范围方案。
- 扩展 `workbench/draft`：新增可选入参 `mode`（`direct` 默认 / `from-plan`）与 `planText`；旧两档不传新参数时行为完全不变。
- 新增两个 task prompt 模板（三处镜像：`packages/prompt-templates`、API `task-prompt-defaults`、orchestrator `task-prompt-defaults`）：范围方案模板、按场创编成稿模板，走模板版本治理。
- 范围合同：方案 MUST 输出版内改动账本（保留 / 改写 / 加料 / 删减 + 删减功能补偿）、篇幅预算、**入场 / 散场状态核对清单**；成稿允许场内删拍、加戏、重排，但 MUST 锁定入场与散场状态、MUST 接得住范围前后只读上下文。
- 成稿层 prompt 只接收收敛后的写作说明，MUST NOT 出现账本 / 举证等流程术语，避免流程污染文笔。
- MVP 限定单窗：创编模式不做多窗续写，范围超长时前端提示划小。
- OpenAPI Contract First；非法请求沿用 400，上游失败沿用 1502，MUST NOT 新增错误码段。

## Non-goals

- 不改整章 plan / draft、`rewriteMode` 枚举及旧三种文笔优化模式的任何行为。
- 不做整章多场连跑、自动认场、按高潮自动拆场。
- 不做方案账本表格化 UI；MVP 方案为可编辑文本。
- 不做创编模式的结构级多窗续写（二期）。
- 不引入新供应商、新错误码段或新存储。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `chapter-optimize-workbench`：新增「按场创编」模式（范围内方案确认 + 场内结构级自由度 + 入场 / 散场状态锁定 + 新端点与 draft 入参扩展）。

## Impact

- `services/api`：`projects.controller.ts`、`projects.service.ts`、`chapter-optimize-workbench.util.ts`（新端点编排、请求校验、范围方案 / 成稿 prompt 组装）。
- `packages/prompt-templates/src/templates.ts` 与 API、orchestrator 两处 `task-prompt-defaults.ts`：2 个新模板三处镜像。
- `apps/web`：`ChapterOptimizeWorkbenchDialog.vue`（新模式与方案确认步骤）、`services/api.ts`（新 SSE 客户端与 draft 入参）。
- `openapi/`：新增 workbench plan 路径，扩展 workbench draft 请求体。
- 属 RAG 关键链路（新 task prompt），发布前 MUST 过 Prompt 模板治理与 `RAG评测与验收基线` 回归。
