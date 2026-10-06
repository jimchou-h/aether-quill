## ADDED Requirements

### Requirement: Writing optimize dialog is fullscreen with a live red-green diff

文笔优化弹窗在方案改写、直接改写与自动循环三种模式下 MUST 全屏。正文区 MUST 在上方展示原文（只读）与成稿（可编辑，apply 目标）。下方 MUST 用红绿标出原文相对成稿的删除与新增，并 MUST 在成稿变化时更新。MUST NOT 要求先点「查找差异」才显示对照。

#### Scenario: Auto-loop draft edits refresh the diff

- **WHEN** 自动循环已有成稿，用户改了成稿框中的一字
- **THEN** 下方红绿对照 MUST 按新成稿更新，apply 目标 MUST 为该成稿框

#### Scenario: From-plan and direct share the same layout

- **WHEN** 用户在方案改写或直接改写模式生成了成稿
- **THEN** 弹窗 MUST 同样全屏，并 MUST 在成稿下方展示与原文的红绿对照
