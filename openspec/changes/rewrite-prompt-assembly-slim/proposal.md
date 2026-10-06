## Why

改写正文 prompt 存在指令重复、【用户需求】语义不清、原文/方案夹在上下文中间等问题，导致长章改写注意力分散。按已确认的最小改动草案收紧拼装。

## What Changes

- 精简 `chapter.optimize.draft` / `direct-draft` 的 task system（角色 + 优先级 + 硬约束）
- `buildDraftUserPrompt` / `buildDirectDraftUserPrompt`：方案与原文靠后，尾部唯一【输出要求】，去掉重复约束段
- assembler：【叙事上下文】→【参考上下文】，【用户需求】→【任务输入】；同步引用文案

## Non-goals

- 不改 OpenAPI / templateKey / 生成接口
- 不改按场成稿、auto-loop 单段拼装结构（仅同步「叙事上下文」标签引用）
- 不做叙事/证据长度自动裁剪
- 不批量重写已发布、用户自定义的 task prompt 存库文本（仓库默认与新生成走新文案）

## Capabilities

### New Capabilities

- `rewrite-prompt-assembly`: 改写正文消息拼装顺序、去重与优先级

### Modified Capabilities

（无既有 capability 需求级变更）

## Impact

- `services/api` chapter-optimize.util
- `services/rag-orchestrator` assembler + task-prompt-defaults
- `packages/prompt-templates` draft/direct-draft 默认文本
- OpenAPI / 错误码：无变更
