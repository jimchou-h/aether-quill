## Context

文笔优化（`ChapterOptimizeDialog`）现状为三步：`instruction` → SSE 生成方案（`chapter.optimize.plan`）→ 用户确认/修订 → SSE 按 `<optimization-plan>` 生成正文（`chapter.optimize.draft`）→ 对比后 apply。Draft 契约强制 `planText` + `instruction`。

用户要的「不生成大纲、要求直出正文」落在该弹窗，而不是创作精修（角色/特征/感官大纲 gate）。口语「大纲」映射为方案步。

## Goals / Non-Goals

**Goals**

- 同一弹窗内可选直接改写：要求 → 正文 → 应用
- 契约向后兼容：默认仍走方案改写
- 直接模式有独立可治理 prompt，写作档 + 文风样本

**Non-Goals**

- 创作精修 / 终稿合规 / 错字检查
- 去掉方案改写
- 新错误码、新持久化 session

## Decisions

### D1 — 模式枚举而非伪造 planText

请求增加 `rewriteMode: 'from-plan' | 'direct'`（省略 = `from-plan`）。禁止把 `instruction` 塞进 `planText` 复用旧模板：现有 draft 硬约束「必须严格遵循 `<optimization-plan>`」，会把要求误当成已确认方案结构。

### D2 — 新 templateKey `chapter.optimize.direct-draft`

- 登记：`packages/prompt-templates`、`TASK_PROMPT_DEFINITIONS`、API 与 orchestrator `task-prompt-defaults`
- `isWritingStyleInjectionTemplateKey` 纳入该 key（从而写入写作档）
- Settings 分组已按 `chapter.optimize.*` 归入「文笔优化」，无需改分组规则
- System prompt：以原文为蓝本、遵循用户要求、只输出正文；衔接/锚点/禁止占位语与现 draft 对齐，但删除「必须遵循 optimization-plan」

### D3 — 弹窗内切换，不新开入口

章节列表仍一个「文笔优化」。弹窗顶部单选：**方案改写** / **直接改写**。切换时若无进行中 SSE，清空方案/正文中间态，保留 `instruction`。直接模式步骤条两项；对比步「修改要求」替代「返回方案」。

中断、活动条、apply 乐观锁复用现有路径。

### D4 — 长章分段但不跑方案诊断

`resolveChapterOptimizeLengthStrategy` 复用。直接模式：

- 不调用 plan SSE，无 `segmentDiagnoses`
- 分段 draft 只带 instruction + 段原文 + 既有边界锚点
- `validateMergedChapterDraft` 的删减判定：direct 用 `instruction`，from-plan 仍用 `planText`

### D5 — OpenAPI / 错误码

先改 `ChapterOptimizationDraftRequest` 与 `chapter-optimize-draft.yaml` 描述。400 文案区分「direct 缺 instruction」与「from-plan 缺 planText」。不新增 `shared-types` 错误码。

## Risks / Trade-offs

- **质量**：无方案约束时模型更易漏情节或擅自删减；靠原文蓝本 prompt + 既有合并校验缓解
- **双模板漂移**：三处默认文本必须同 change 落地
- **与进行中 UX change**：`improve-chapter-ai-activity-ux` 已改活动条；本 change 只复用，不重做进度模型

## Migration

无数据迁移。旧客户端不传 `rewriteMode` → `from-plan`。
