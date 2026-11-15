## Why

文笔优化「方案改写」现在每步只跑一轮：方案要人工确认后才能写正文，正文也只生成一次。作者希望方案和正文都能连跑 1～3 轮（后一轮吃前一轮结果），并可选在方案全部结束后自动开写正文，以提高对方案/要求的执行率。

## What Changes

- 方案改写弹窗增加：方案次数、正文次数（各 1～3）、方案完成后自动开写；浏览器记住上次。
- 方案第 1 轮仍走现有生成（含长章诊断）；第 2～3 轮复用「按意见改方案」，固定收紧意见，不再诊断。
- 正文第 1 轮仍用入库原文；第 2～3 轮用上一稿作 `<chapter-original>`，质量校验仍对入库原文。
- Draft 契约增加可选 `sourceText`。直接改写不做连跑与自动开写。

## Capabilities

### New Capabilities

- `writing-optimize-multi-pass`: 方案/正文多轮连跑与自动开写。

### Modified Capabilities

- （无主 spec 增量以外的独立能力。）

## Impact

- 前端：`ChapterOptimizeDialog`、run prefs、draft/plan SSE 循环。
- API / OpenAPI：`ChapterOptimizationDraftRequest.sourceText`。
- 不改创作精修、终稿合规、工作台续写、直接改写路径。
