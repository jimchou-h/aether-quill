## Why

章节页并行堆了创作精修、终稿合规、一键终稿、批量精修与独立错字等入口，日常主路径只用「文笔优化三模式 + 按场成稿」。多余能力增加维护与提示词表面积，且与主路径耦合弱，适合一次竖切删除以方便回退与后续主路径减噪。

## What Changes

- **BREAKING**：移除章节「创作精修」产品面（含批量精修、一键终稿质检）及其 `/pipeline/*` API/SSE。
- **BREAKING**：移除「终稿合规检验」产品面及其 `/compliance-check/*` API/SSE。
- **BREAKING**：移除已废弃的独立错字检查/修正入口与 `optimize/typo-*` API（校对需求改由自动循环/直接改写指令覆盖）。
- 清理对应 OpenAPI paths、前端 Dialog/菜单/设置页 pipeline 偏好、仓库 task-prompt 默认中的 `chapter.pipeline.*` / `chapter.compliance.*` / typo 模板登记。
- 保留文笔优化（方案 / 直接 / 自动循环）与按场成稿；自动循环仍依赖的 SSE/人物块等共享 helper **抽取或降级保留**，不得因删精修而打断自动循环。

## Non-goals

- 不改文笔优化三模式与按场成稿的业务逻辑、分段策略、prompt 文学策略。
- 不做巨石 Dialog / SSE 层大重构（列为后续增量刀）。
- 不清理用户本地已发布的 task-prompts 数据文件；不 rewrite 远端历史。
- 不删除项目内容安全规则引擎本身（`content-safety`），仅去掉章节精修/合规产品链。

## Capabilities

### New Capabilities

- `chapter-ai-surface`: 定义章节页对外可用的 AI 能力面（仅文笔优化 + 按场成稿）及必须移除的能力面。

### Modified Capabilities

- （无已归档主规格需改；本仓库 `openspec/specs/` 暂无对应 SSOT，以本 change delta 为唯一需求来源。）

## Impact

- **OpenAPI**：删除 pipeline / compliance-check / typo-check / typo-fix 相关 paths 与 schema 引用（Contract First，先合同后代码）。
- **错误码**：若仅被上述路径使用的专用码随路径删除；保留路径错误码语义不变。
- **代码**：`apps/web` 章节页与设置；`services/api` projects 模块中 pipeline/compliance 服务与路由；`packages/prompt-templates` 与 rag-orchestrator / api task-prompt 默认登记。
- **共享依赖**：`chapter-pipeline-orchestrator.client`、人物块构建等被自动循环引用的符号须在删除前迁到中性模块或保留最小实现。
