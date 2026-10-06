## Context

第二轮 Grill 已锁定：实验室只调「为什么提出这些诊断项」；项目 system 与诊断 Prompt 可改、点选才写入；改写入口拿掉；文笔优化弹窗全屏，原文/成稿下方红绿 diff。不归档旧实验室，改同一份变更。

## Goals / Non-Goals

**Goals:**

- 诊断轮可重放：冻 user 与检索证据，替换未发布的项目 system + 诊断 Prompt。
- 对话只建议层与全文；写入、重跑、发布都由作者点。
- 三种文笔优化模式都能全屏对比成稿与原文。

**Non-Goals:** 见 proposal。

## Decisions

### 1. 实验室只绑诊断快照

入口仅「调诊断 Prompt」。快照仍可记录改写调用（循环实现不必删），但 UI 不提供改写入口。`promptLabCallId` 仍可挂在轮次上供诊断入口。

### 2. 两层覆盖，不省略仓库全局默认

重跑：`systemPromptOverride` = 诊断编辑器；`context.projectSystemPromptOverride` 为 string 时替换项目 `systemPromptText`。仓库 `GLOBAL_SYSTEM_DEFAULT_TEXT` 仍拼接。冻检索逻辑不变。

顾问 JSON：`suggestedLayer`（`project_system` | `diagnose`）、`suggestedText`、`rationale`。解析失败 400，不覆盖编辑器。

### 3. 发布分两路

诊断 Prompt → 现有 task-prompt saveDraft/publish。  
项目 system → 现有 promptConfig 草稿/发布，确认文案写明会影响本项目所有生成。  
已打开的循环两层都不换。

### 4. 全屏 diff 复用现有 diff 工具

弹窗 `width: 100%` 铺满。上面原文 + 成稿编辑框（apply 目标仍是成稿）。下面 `buildInlineDiffViews` / `buildChapterDiffLines`，成稿一变就刷新。三种模式共用。

## Risks / Trade-offs

- [项目 system 误发布] → 单独确认文案；保存草稿不是发布。
- [顾问 JSON 失败] → 400，编辑器不动。
- [全屏弹窗信息多] → 成稿仍可编辑；diff 只读。

## Migration Plan

无数据迁移。回滚：恢复 1080 弹窗、下线实验室入口与两层覆盖字段。

## Open Questions

无（Grill 已关闭）。
