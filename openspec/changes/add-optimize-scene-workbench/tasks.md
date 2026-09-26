## 1. Contract 与纯函数

- [x] 1.1 OpenAPI：新增 `chapter-optimize-workbench-draft.yaml` / `review.yaml` / `fix-span.yaml` 及 schema（`profile`、`startOffset`、`endOffset`、`baseUpdatedAt`、review `items[].kind`）；挂进 `openapi.yaml`；**禁止**改 `rewriteMode` 枚举与 direct 忽略 `sourceText` 的描述；补契约单测或 snapshot 断言新路径存在、旧 draft 枚举仍为 `from-plan|direct`
- [x] 1.2 纯函数：`spliceChapterRange`、`locateUniqueAnchor`、`filterWorkbenchReviewItems`（丢弃非法 kind 与含「加深/写细/补接吻」的 instruction）；单测覆盖拼回、0/2 次锚点、过滤

## 2. Prompt 与编排

- [x] 2.1 登记 `chapter.optimize.workbench-draft-sex` / `workbench-draft-prose` / `workbench-review` / `workbench-fix-span`：`packages/prompt-templates` + API + orchestrator `task-prompt-defaults` 三处文本一致；Settings 分组测落入「文笔优化」；写作档注入仅 draft 两档
- [x] 2.2 rag-orchestrator：实现 workbench draft（只吃范围正文、**不**走 `splitIntoSegments`；超长同场续写窗）、review JSON、fix-span（只输出选区）；API 新路由转发 SSE/JSON；单测：不走旧分段、direct 旧路径仍忽略 sourceText

## 3. 独立前端工作台

- [x] 3.1 新增 `ChapterOptimizeWorkbenchDialog.vue`（及必要 composable/utils）：划选范围、性爱/日常档、生成范围成稿、预览拼回、一次检查列表、划句/勾条目 fix-span、应用走现有 apply；**禁止**修改 `ChapterOptimizeDialog.vue` 行为
- [x] 3.2 `Chapters.vue` 仅增加「按场成稿」入口与弹窗挂载；`api.ts` 只追加 workbench 方法；补工作台纯函数/组件测（范围校验、预览拼回、条目过滤）
- [x] 3.3 现有文笔优化相关单测（步骤条、direct/from-plan、循环 prefs）保持通过，证明旧弹窗未改预期

## 4. 自检

- [x] 4.1 `pnpm --filter @aether-quill/web` 与 api / rag-orchestrator / prompt-templates / shared-types 的 lint、typecheck、相关 test 通过
