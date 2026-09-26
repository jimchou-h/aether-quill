## Why

自动循环复诊把【用户优化要求】和文风目标当成待办，`medium`（部分未落实）也会续跑，所以每轮都能再润色，停不下来。

## What Changes

- 复诊只允许两类条目：要求明显未落地、上轮改坏或新引入偏离。
- 禁止把 systemPrompt /「还能更贴要求」拆成润色条目。
- 收敛只认 `high`；medium/low 不再续跑。
- 复诊调用跳过项目 systemPrompt，避免文风圣经变成条目。

## Capabilities

### New Capabilities

- `auto-loop-gap-only-diagnose`: 自动循环复诊只抓漏点与改坏，不再开卷润色。

### Modified Capabilities

- `chapter-auto-optimize-loop`: 收敛判定从 high+medium 改为仅 high。

## Non-goals

- 不改方案改写闭环、直接改写、终稿合规。
- 不改自动循环的定位/局部改写引擎。
- 不强制改用户已发布的 Settings 文本（user prompt 仍带限定，旧发布稿也会收到）。

## Impact

- OpenAPI / 错误码：无变更。
- API：`chapter-auto-loop.util` 复诊 prompt 与 `shouldContinueAutoLoop`；diagnose 带 `omitProjectSystemPrompt`。
- rag-orchestrator：`chapter.optimize.loop.plan` 仓库默认文本三处同步。
- 前端：收敛文案。
