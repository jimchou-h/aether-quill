## Why

方案改写（from-plan）本质是整章重写，成稿后常出现衔接断裂、悬空指代、空间/体位不合理等问题。作者必须通读校对、又不敢直接应用，效率低。需要在作者看到终稿前，先由系统对照方案合同做连续性自检，并自动修一刀；作者只需审终检版，并对漏网问题点名修复。

## What Changes

- 新增「连续性自检」步骤：成稿后对照方案中的情节点清单、场景状态、指代依赖与逐字保留项做结构化审查（不审文笔）。
- from-plan 成稿结束后默认自动跑自检；有实质缺口时最多自动 refine 一刀，再向作者展示终稿。
- 前端在终稿旁展示自检摘要；支持作者标出残留问题并触发局部/定向修复（不默认整章重跑）。
- 复用自动循环里已有的「验收缺口 → 再改一稿」模式，尺子改为连续性专用，不替代文笔优化要求。

## Non-goals

- 不自动 apply 覆盖入库章节；应用仍需作者确认。
- 不把按场成稿改成加戏器；本变更聚焦方案改写（from-plan）主路径。
- 不在本变更内强制解析方案为严格 JSON schema（可先以方案全文 + 清单段落为合同输入）。
- 不重做 diff 性能；对照面板保持「点按钮生成对照」。

## Capabilities

### New Capabilities

- `optimize-continuity-self-check`: 方案改写成稿后的连续性自检、自动 refine、以及作者点名修复的端到端行为。

### Modified Capabilities

- （无既有 openspec 主库 capability 需改 REQUIREMENTS；本章为新增能力。）

## Impact

- **OpenAPI**：新增或扩展章节优化相关路径（continuity-review；可选 mark-fix / refine），需先更新 `openapi/`。
- **API**：`projects` 模块章节优化流式编排、task prompt 注册。
- **rag-orchestrator**：新 templateKey 的生成/纯文本调用；不改变检索默认策略时可复用现有 generate。
- **Web**：`ChapterOptimizeDialog` from-plan 流程与终稿展示、问题标记入口。
- **prompt-templates / shared-types**：新 task 默认文案与 DTO。
- **错误码**：若新增失败码需同步手册；优先复用现有优化流错误语义。
