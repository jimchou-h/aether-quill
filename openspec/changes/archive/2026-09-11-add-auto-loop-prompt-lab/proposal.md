## Why

自动循环诊断差了，作者不知道是项目 system 还是诊断 Prompt 写坏了。现有实验室只改一条任务 Prompt，还挂了改写入口；文笔优化弹窗也看不清成稿相对原文改了哪些字。

## What Changes

- 实验室只从自动循环**已结束诊断轮**进入；拿掉「调改写 Prompt」。
- 可编辑两层：项目 `systemPromptText`、诊断任务 Prompt（`chapter.optimize.loop.plan`）。仓库全局默认与 user 拼装稿不可改。
- 对话：助手可建议更像哪一层，并给出该层建议全文；必须作者点「写入项目 system」或「写入诊断 Prompt」才进对应编辑器。MUST NOT 因对话自动重跑或发布。
- 「用这次输入重跑」用冻住的 user 稿与检索证据，加上编辑器里两层未发布稿；只更新实验室对照区的诊断输出。MUST NOT 改章节、时间线、可应用成稿。
- 两层各自保存草稿 / 发布。项目 system 发布须单独确认：会影响本项目所有生成。已打开的循环不换 Prompt。
- 文笔优化弹窗（方案改写 / 直接改写 / 自动循环）改为全屏；上面原文只读 + 成稿可编辑，下面红绿 diff 随成稿刷新。

## Capabilities

### New Capabilities

- `auto-loop-prompt-lab`: 诊断轮冻输入、双层 Prompt 调试、点选写入、沙盒重跑。
- `writing-optimize-fullscreen-diff`: 文笔优化弹窗全屏与原文/成稿红绿对照。

### Modified Capabilities

- （无主规格变更以外的 capability。）

## Non-goals

- 不挂续写、合规、流水线的实验室入口。
- 不改仓库全局默认、不改 user 拼装结构。
- 不自动定位并改 Prompt、不自动发布、不把重跑写回章节。
- 不做改写 Prompt 实验室、样章集、设置页 Playground。
- 不在关弹窗后的章节页保留实验室历史。

## Impact

**OpenAPI**：`advise` 增加建议层；`replay` 可带项目 system 覆盖。任务 Prompt 与项目 system 的保存/发布仍走现有路径。无 BREAKING（实验室尚未验收）。无新错误码。

**代码**：循环快照；冻检索；实验室双编辑器；orchestrator 支持本次请求覆盖项目 system；弹窗全屏 + 现有 `diff` 包对照。
