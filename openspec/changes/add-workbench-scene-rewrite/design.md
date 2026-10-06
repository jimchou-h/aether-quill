## Context

按场成稿（change: add-optimize-scene-workbench，已归档）现有两档 `sex | prose`，其 draft prompt 硬约束「只改写 `<range-original>`、禁止凭空另起无关剧情」，本质是**同义重写**。整章方案改写（`optimize/plan` → `optimize/draft`）具备结构级自由度，但以整章 `chapter.content` 为单元，会波及范围外。

用户实际缺口：在划定的一场内做删拍、加戏、重排、扩写新波折，且散场后必须无缝接回后文。现状只能「整章方案改写后再局部修」，成本高且风险不可控。

约束（沿用既有隔离决策）：

- 不得改 `rewriteMode` 枚举、不得让旧 `direct` 读 `sourceText`、不得改旧三模式任何行为。
- Contract First：OpenAPI 先于代码。
- 新 task prompt 属 RAG 关键链路，三处镜像（`packages/prompt-templates`、API `task-prompt-defaults`、orchestrator `task-prompt-defaults`），走版本治理。
- 范围偏移沿用 UTF-16 码元 + 打开弹窗冻结 `baseText/baseUpdatedAt`。

## Goals / Non-Goals

**Goals:**

- workbench 内新增第三模式「按场创编」：范围 → 方案（可编辑确认）→ 成稿 → 检查 / 点修 → 应用。
- 场内自由度：允许删拍、并拍、加新波折 / 对白、场内顺序重排、篇幅增减。
- 边界硬锁：入场状态、散场状态与原文一致；开头接得住 before、结尾接得住 after；不消费后文情节、不新增跨场伏笔 / 新人物 / 关系转折。
- 方案可审计：输出改动账本 + 篇幅预算 + 入场 / 散场状态清单。
- 行文层不被流程术语污染。

**Non-Goals:**

- 结构级多窗续写（MVP 单窗，超长提示划小）。
- 账本表格化 UI（MVP 可编辑文本）。
- 自动认场、多场连跑。
- 新存储、新错误码、新供应商。

## Decisions

### D1 — 新增 `workbench/plan` 端点，扩展而非分叉 draft

新增 `POST :id/knowledge/chapters/:chapterNo/optimize/workbench/plan`（SSE，事件形态对齐整章 plan：`start/stage/content/end/error`）。

`workbench/draft` 请求体新增**全部可选**字段：

- `mode?: 'direct' | 'from-plan'`（缺省 `direct`，走现状）
- `planText?: string`（`mode=from-plan` 时必填，走与整章 planText 同款非空校验）

不选：给整章 plan/draft 加 range 参数复用旧端点——会改变旧客户端的分段策略与上下文注入，回归面不可拆（与 add-optimize-scene-workbench D2 同理）。

### D2 — 模式与档位正交，MVP 只开放一种组合

前端在 range 步骤选模式：`direct`（现状，继续选 sex/prose 档）与 `scene-plan`（按场创编）。后端保持 `profile: sex|prose` 不变，创编模式不使用 profile 语义，改由固定新模板承担。draft 入参用 `mode` 区分，避免把 `profile` 撑成三义枚举。

### D3 — 范围方案模板（`chapter.optimize.workbench-plan-scene`）

system prompt 职责：只输出方案，禁止输出正文。方案 MUST 含四块：

1. **入场 / 散场状态清单**：在场人物、各自位置 / 衣着 / 伤势 / 情绪落点、与范围后第一句的衔接状态——从 `<range-original>` 与 `<after-context>` 提取，作为成稿硬锁。
2. **改动账本**：逐项 `keep | rewrite | expand | delete`，每项含原文锚点、理由；`delete` MUST 写明该段原承担功能（情节 / 人物 / 情绪递进 / 节奏缓冲 / 伏笔）与功能补偿落点；承担情绪递进或伏笔功能的段落默认只许 rewrite 不许整段 delete。
3. **篇幅预算**：预估成稿总字数与各拍增删；规则为删减腾出的篇幅默认重分配到主戏拍，禁止无补偿净缩水，禁止注水膨胀。
4. **边界声明**：不新增人物 / 跨场伏笔 / 关系转折，不消费后文情节。

user prompt 组成：`【优化目标】` + `【用户优化要求】` + 出场角色 + `<before-context>` + `<range-original>` + `<after-context>` + 「只输出方案」。沿用 2000 字只读衔接上下文，不注入【近期章节摘要】【语义记忆章节】。

### D4 — 创编成稿模板（`chapter.optimize.workbench-draft-scene`）与分层隔离

system prompt 职责：按**已确认方案**对范围正文做结构级重写，只输出范围正文纯文本。允许场内删 / 加 / 重排；硬锁入场散场状态、人称时态人名、占位语禁令、边界衔接、范围外零输出。

关键隔离（防流程伤文笔）：

- draft 的 user prompt 直接携带用户确认后的 `planText` 全文（MVP 不做二次摘要服务，避免再加一次 LLM 跳变）；
- 但 draft system prompt 中 MUST NOT 出现「账本 / 举证 / 准入 / 验收」等流程术语；方案以「编辑交底」姿态呈现，`buildWorkbenchSceneDraftUserPrompt` 只追加行文层约束（只输出正文、锁定状态、禁止摘要式压缩账本外段落、密度不得低于原文对应部分）。
- 方案的规则性条文由 plan 模板承担，draft 只接收结论。

### D5 — MVP 单窗硬顶

创编模式 MUST NOT 走 `splitWorkbenchRewriteWindows`：结构改动后窗边界基于旧原文，状态拼接不可控。`rangeText` 超过现有单窗稳定阈值时，前端在发起前提示划小范围；后端对 `mode=from-plan` 且切窗数 >1 的请求返回 400（沿用现有 400 错误形态，不新增错误码）。

### D6 — 验收与检查复用现状

- 检查 / 点句修复：创编成稿完成后仍走现有 `workbench/review` 与 `workbench/fix-span`。MVP 中 review 的 `profile` 入参对创编模式固定按 `sex` 口径（pose/vocab/regression 全开），因为结构改动最易出姿势 / 空间穿帮；prose 收窄规则不适用于创编。
- 不新增独立连续性自检端点；入场 / 散场状态核对由 plan 方案清单 + draft 硬约束承担。是否新增范围版连续性自检留到二期依据评测结果决定。

### D7 — 前端步骤机扩展

`WorkbenchStep = 'range' | 'plan' | 'generate' | 'review' | 'apply'`。仅创编模式进入 `plan`：方案流式渲染在可编辑文本区，「确认方案 / 重新生成 / 编辑后确认」后进入 generate；direct 两档跳过 plan，行为不变。拼回、对照、apply、乐观锁全部复用现状。

## Risks / Trade-offs

- **散场状态漂移导致接不上后文** → D3 状态清单提取 + D4 硬锁 + review pose 检查三重拦；评测基线增加「加戏后位置 / 衣着 / 伤势接 after-context」场景。
- **流程术语污染文笔（答题感、均匀发力、注水）** → D4 术语隔离 + 篇幅预算 + 评测时对比新老成稿检查「均匀发力 / 注水 / 锚点呼应句」。
- **方案被用户编辑后与状态清单矛盾** → draft prompt 声明以确认后方案为准；不做服务端一致性解析（MVP），冲突结果在 review 阶段暴露。
- **单窗限制使大场不可用** → 前端明确提示；二期再做结构级多窗（需先解决状态漂移）。
- **新模板回归风险** → 三处镜像同 change 落地 + 模板版本治理（草稿 / 灰度 / 回滚）+ RAG 评测基线回归通过后方可发布。

## Migration Plan

无数据迁移。上线顺序：OpenAPI → 模板三处镜像（默认草稿，不切流）→ API 端点与校验 → 前端模式入口 → 模板发布 + 评测回归。回滚：前端隐藏创编模式并下线 plan 路由、draft 不传 `mode=from-plan`，旧两档与整章方案流不受影响。

## Open Questions

- 创编模式 review 固定 sex 口径是否过严（日常戏结构改动也会收到 vocab 条目）？MVP 先按此实现，依据实际丢弃率在二期调整为按用户选择的检查口径。
