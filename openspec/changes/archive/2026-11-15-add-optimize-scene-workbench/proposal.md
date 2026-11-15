## Why

日常文笔优化要先整章（或按字数切窗）重写，再靠人通读防砍、防体位穿帮、防词表泄漏。一场里多次性爱被切窗后衔接也容易断。需要一条**不改现有三模式**的新路径：按用户划定范围加料，跑完一次检查，成稿上点句修。

## What Changes

- 章节页新增独立入口「按场成稿」（新弹窗）。**不改**现有「文笔优化」里的方案改写 / 直接改写 / 自动循环行为与契约
- 用户划定正文起止（一场可含多次性爱；过场也可划）。选档：**性爱加料** 或 **日常文笔**
- 只把划定范围送给模型；生成后拼回全章预览。范围内不分段
- 跑完一次分诊，产出体位/空间、用词、改差三类条目；没有改差不得出「还能更色」
- 成稿可划句（或勾条目）只改选区，不对就撤这一处
- 可选：多块范围排队跑，块与块之间停一下看接缝

## Non-goals

- 不改、不删除现有三种文笔优化模式及其 OpenAPI / prompt / 分段策略
- 不做自动认场（第一期只手划）
- 不把「文笔检查」做成加料或张力巡查
- 不自动覆盖原文（仍须确认应用）
- 不改创作精修、终稿合规、错字检查、Workbench 续写

## Capabilities

### New Capabilities

- `chapter-optimize-workbench`: 按场成稿台（划范围、分档加料/顺文笔、一次检查、点句修复、拼回应用）

### Modified Capabilities

- （无。现有 `direct-writing-optimize` / 循环 / 全屏对照规格不改需求）

## Impact

- **OpenAPI**：新增 workbench 路径与 schema（draft / review / fix-span）。现有 `ChapterOptimizationDraftRequest` 的 `rewriteMode` 枚举与「direct 忽略 sourceText」**不改**。错误码不新增段，非法请求沿用 400
- **API / orchestrator**：新 task prompt 三枚（draft 性爱、draft 日常、review、span-fix 可合并登记）；apply 复用现有整章 apply，由前端拼好全文
- **Frontend**：新弹窗组件；章节列表多一个按钮。`ChapterOptimizeDialog.vue` 本 change **禁止改行为**
- **Tests**：范围拼回、检查条目形状、划句只改选区、旧三模式回归（不改其单测预期）
