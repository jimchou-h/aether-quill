## ADDED Requirements

### Requirement: Plan and draft pass counts

文笔优化「方案改写」MUST 允许用户分别设置方案次数与正文次数，范围为 1～3，默认 1。浏览器 MUST 记住上次选择（含自动开写开关），换章节也沿用。直接改写 MUST NOT 展示或应用这些次数。

#### Scenario: Default counts are one

- **WHEN** 用户在未保存过偏好的浏览器首次打开文笔优化方案改写
- **THEN** 方案次数与正文次数均为 1，自动开写为关

#### Scenario: Direct mode hides pass controls

- **WHEN** 用户切换到直接改写
- **THEN** 系统 MUST NOT 按方案/正文次数连跑，MUST NOT 自动开写

### Requirement: Plan multi-pass refine

方案第 1 轮 MUST 走现有生成方案（长章可分段诊断）。第 2～3 轮 MUST 以上一轮完整方案为底稿，复用按意见修订接口，使用固定收紧说明，MUST NOT 再次分段诊断。失败或中断 MUST 保留上一轮已成功方案。进度 MUST 标明方案第 k / N 轮。

#### Scenario: Second plan pass revises previous plan

- **WHEN** 方案次数为 2 且第 1 轮已成功
- **THEN** 第 2 轮 MUST 提交 currentPlanText 为第 1 轮方案，并带固定收紧意见，MUST NOT 走无 currentPlanText 的全新诊断生成

### Requirement: Auto-start draft after plan passes

方案改写 MUST 提供「方案完成后自动生成正文」开关（默认关，可记住）。打开时，MUST 在全部方案轮次成功结束后立刻开始正文连跑；连跑过程中 MUST NOT 允许编辑或返回方案。全部结束后 MUST 允许返回方案。应用覆盖原文仍 MUST 确认。

#### Scenario: Auto-start waits for all plan passes

- **WHEN** 自动开写开启、方案次数为 2、正文次数为 1
- **THEN** 系统 MUST 先完成两轮方案，再开始一轮正文，MUST NOT 在第 1 轮方案结束后就写正文

### Requirement: Draft multi-pass with previous draft as source

正文第 1 轮 MUST 以入库章节正文为 `<chapter-original>`。第 2～3 轮 MUST 以上一轮成功正文为 `sourceText` 注入 `<chapter-original>`，方案仍注入 `<optimization-plan>`；MUST 追加按方案收紧上一稿、不得另起方案的约束。对比区左侧与字数/删减校验 MUST 仍对入库原文。失败或中断 MUST 保留上一轮成功正文。进度 MUST 标明正文第 k / M 轮。

#### Scenario: Second draft pass uses previous draft as chapter-original

- **WHEN** 正文次数为 2 且第 1 轮已成功
- **THEN** 第 2 轮 draft 请求 MUST 带非空 `sourceText` 为第 1 轮正文，提示中 `<chapter-original>` MUST 为该稿而非入库原文

#### Scenario: Quality gate still uses stored chapter

- **WHEN** 第 2 轮合并正文相对入库原文过短且方案未允许删减
- **THEN** 质量校验 MUST 失败，不得因 `sourceText` 改成对上一稿比长度而放行
