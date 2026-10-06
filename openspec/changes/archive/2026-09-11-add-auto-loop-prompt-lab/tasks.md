## 1. 快照与冻检索

- [x] 1.1 循环每次诊断/改写写入 `promptLabCalls`；`end` 带回 `retrievedEvidence`；orchestrator 在 `frozenRetrievedEvidence` 为 string 时跳过检索
  - 测试：快照含 userPrompt 与 output；冻证据时不走检索路径
- [x] 1.2 GET session 返回 `promptLabCalls`；轮次带 `promptLabCallId`
  - 测试：session store

## 2. 沙盒重跑与顾问

- [x] 2.1 `POST prompt-lab/replay`：冻 user + 冻证据 + 诊断编辑器 + 可选 `projectSystemPromptOverride`；不写章节
  - 测试：请求含冻证据、任务覆盖与项目 system 覆盖，且无 apply
- [x] 2.2 `POST prompt-lab/advise`：返回 `suggestedLayer` + `suggestedText` + `rationale`；解析失败 400 不覆盖
  - 测试：合法 JSON / 非法文本；建议层为 `project_system` 或 `diagnose`

## 3. 实验室抽屉

- [x] 3.1 仅诊断轮可打开；两层编辑器；对照重跑不改 `onDraftAvailable`；无「调改写 Prompt」
  - 测试：绑定 diagnose callId；无 rewrite 入口纯函数或面板断言
- [x] 3.2 对话不自动写入；点选才写入对应层；两层各自保存/发布；system 发布需确认全项目影响；文案说明本轮不换 Prompt
  - 测试：点选写入纯函数；文案常量

## 4. 全屏红绿 diff

- [x] 4.1 文笔优化弹窗三种模式全屏；上方原文/成稿，下方红绿 diff 随成稿刷新
  - 测试：`buildInlineDiffViews` 或面板纯函数 — 成稿变化后新增段出现在右侧
