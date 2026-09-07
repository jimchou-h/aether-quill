## 1. 短章直接改写（端到端）

- [x] 1.1 Contract First：OpenAPI `ChapterOptimizationDraftRequest` 增加 `rewriteMode`（`from-plan` | `direct`）；文档写明 `direct` 时 `planText` 可省略、省略 mode 等于 `from-plan`；`chapter-optimize-draft.yaml` 描述同步
- [x] 1.2 Prompt 与纯函数：新增 `chapter.optimize.direct-draft` 默认文本与 `buildDirectDraftUserPrompt`（或等价）；direct 拒绝空 instruction、不注入 `<optimization-plan>`；`validateMergedChapterDraft` 在 direct 下用 instruction 判断删减；单测覆盖上述行为及 from-plan 回归
- [x] 1.3 API SSE：`rewriteMode=direct` 走新模板生成正文（含现有 prep `stage`）；`from-plan` 仍要求 `planText`；单测或 service 测覆盖接受/拒绝
- [x] 1.4 弹窗：模式切换「方案改写 / 直接改写」；直接模式主按钮「直接生成正文」，步骤为要求 → 正文对比 → 应用；步骤视觉纯函数单测；生成中可中断并写入现有活动条

## 2. 长章分段直接改写

- [x] 2.1 直接模式复用现有分段字数策略，跳过 `segment_diagnosis` / `plan_synthesis`；无 diagnoses 时分段 prompt 仅带 instruction + 段原文；SSE 不发方案诊断阶段；单测覆盖策略与阶段约束

## 3. Prompt 治理与设置

- [x] 3.1 白名单与 Settings：`TASK_PROMPT_DEFINITIONS` 增加「文笔优化 · 直接正文」；`packages/prompt-templates` 与 API / orchestrator `task-prompt-defaults` 默认文本一致；`isWritingStyleInjectionTemplateKey` 包含新 key；分组测试确认落在「文笔优化」

## 4. 回归

- [x] 4.1 方案改写路径（生成方案 / 修订方案 / 再出正文 / 应用）行为不变；相关包 lint / typecheck / test 通过
