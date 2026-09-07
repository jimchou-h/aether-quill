## 1. 契约

- [x] 1.1 OpenAPI `ChapterOptimizationDraftRequest` 增加可选 `sourceText`；写明仅 from-plan 第 2 轮起使用，校验仍对入库原文

## 2. API

- [x] 2.1 `assertOptimizeDraftRequest` / `buildDraftUserPrompt`：有 `sourceText` 时注入该稿为 `<chapter-original>` 并加收紧约束；`validateMergedChapterDraft` 仍对入库正文；单测覆盖

## 3. 前端

- [x] 3.1 次数 clamp、localStorage 偏好、方案固定收紧意见纯函数与单测
- [x] 3.2 方案改写弹窗：次数与自动开写 UI；方案/正文连跑；失败保留上一轮；直接改写不连跑

## 4. 回归

- [x] 4.1 直接改写、单次方案改写、应用确认行为不变；相关 test 通过
