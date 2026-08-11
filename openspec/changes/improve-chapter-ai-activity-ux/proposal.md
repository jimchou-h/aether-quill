## Why

章节页与优化弹窗里，AI 任务状态被拆成多套互不统一的信号：`message` 文案、`AiTaskProgressPanel`、多个 `*ChapterNo` 忙标、摘要 job 圆点，以及弹窗内部 step/`running`。用户在**保存后处理**、**创作精修/写作优化**时经常无法判断「AI 正在做什么、卡在哪一步、能否中断」。需要把「当前 AI 活动」做成可感知、可中断、文案可读的统一体验。

## What Changes

- **保存后处理**：摘要 / 关系事件等 after-save SSE 走统一进度模型，展示人类可读阶段（不再是 `action (status)` 技术串），支持中断与失败原因
- **优化 / 精修弹窗**：步骤条与当前子阶段（准备中 / 生成中 / 待确认 / 失败）对齐；运行中明确「正在执行哪一步 + 做什么」；可中断时可见
- **章节页统一活动条**：无论从列表按钮、保存后处理还是弹窗触发，页面始终有一处 SSOT 展示当前 AI 活动（任务名、章节号、阶段、步骤、错误/中断）；弹窗内进度与页面活动条同源或同步
- 收敛重复的「忙标 + Toast 双报」：进行中以活动条为准，成功/失败短反馈可保留，但不再与进度文案互相打架

## Non-goals

- 不重做创作精修业务模块顺序、gate 规则或 prompt 内容
- 不新建后端任务队列/持久化 job 中心（沿用现有 SSE + SummaryJob）
- 不改 Workbench 写作台（若后续需要另开 change）
- 不引入多任务并行调度 UI（首期：**同一时刻一条主活动**；新任务可替换或拒绝，行为写死并提示）
- 不在本 change 内完成 `unify-generation-settings-frontend`（并行进行中的另一 change）

## Capabilities

### New Capabilities

- `chapter-ai-activity-visibility`: 章节页统一 AI 活动可见性（含 after-save、优化/精修弹窗同步、可读阶段与中断）

### Modified Capabilities

- （无已归档同名能力需 MODIFIED；行为以本 change delta 为准）

## Impact

- **Frontend**：`Chapters.vue`、`useAiTaskProgress` / 新 activity 组合、`AiTaskProgressPanel`（或升级为 ActivityBar）、`chapterAfterSave`、写作优化 / 创作精修 / 终稿 / 合规等弹窗进度同步
- **API / SSE**：优先复用现有 `AiTaskProgressEvent`；若 after-save 事件缺可读 `message`/`stage`，可做最小契约补齐（OpenAPI 先行）
- **Tests**：进度映射纯函数 + 关键弹窗/页面同步的单元测试
