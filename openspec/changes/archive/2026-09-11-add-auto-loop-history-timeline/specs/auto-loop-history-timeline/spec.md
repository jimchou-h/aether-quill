## ADDED Requirements

### Requirement: Timeline lists every window and round

自动优化弹窗 MUST 用一条时间线列出本次运行中已经结束的每一轮，每一行 MUST 标明窗号与轮号（单窗时可省略窗号或标为第 1/1 窗）。时间线 MUST 按发生顺序追加。切到下一窗 MUST NOT 丢掉上一窗已结束的轮次。

#### Scenario: Two windows keep both rounds visible

- **WHEN** 第 1/2 窗第 1 轮已结束，随后第 2/2 窗第 1 轮开始或结束
- **THEN** 时间线 MUST 仍包含第 1/2 窗第 1 轮，且 MUST 包含第 2/2 窗第 1 轮（若已结束）或进行中标记（若尚未结束）

#### Scenario: Single window omits confusing window chrome

- **WHEN** 本次运行为整章一窗
- **THEN** 时间线 MUST 仍按轮列出条目，MUST NOT 要求用户先选窗再选轮

### Requirement: Clicking a round shows that round's items only

用户 MUST 能点时间线上任意已结束轮，条目面板 MUST 展示该轮的完整诊断条目（严重度、段号、问题、改法、状态）。点选 MUST NOT 改变正文预览，MUST NOT 改变可应用的成稿。

#### Scenario: Selecting an earlier round does not swap the draft

- **WHEN** 用户点选第 1 轮，而当前最新可接受稿来自第 2 轮
- **THEN** 条目面板 MUST 显示第 1 轮的 `items`，正文预览 MUST 仍为第 2 轮可接受稿

#### Scenario: Latest round is the default selection

- **WHEN** 一轮刚结束且用户尚未点选历史轮
- **THEN** 条目面板 MUST 显示刚结束的这一轮条目

### Requirement: Misaligned paragraph index is disclosed

当用户回看的不是时间线上最新一轮时，条目区 MUST 提示：以下条目对应该轮当时的正文，段号可能对不上当前预览。系统 MUST NOT 用 `anchorQuote` 在当前预览中重新定位或高亮。

#### Scenario: Viewing a historical round shows the disclaimer

- **WHEN** 至少有两轮已结束，且用户选中了非最后一轮
- **THEN** 条目区 MUST 显示段号可能对不齐的提示

#### Scenario: Viewing the latest round hides the disclaimer

- **WHEN** 用户选中时间线最后一轮，或正在查看进行中的最新一轮
- **THEN** 条目区 MUST NOT 显示该段号对不齐提示

### Requirement: Browsing history while the loop is running

循环仍在跑时，用户 MUST 仍能点选已经结束的轮查看条目。若用户已选中历史轮，新的 `loop_plan_items` / `loop_item_status` / `loop_round_end` MUST NOT 把选中切回最新一轮。界面 MUST 提供「回到当前」，一点即选中最新一轮（进行中则看 live 条目）。最新一轮 MUST 标明进行中。

#### Scenario: Selection stays put during rewrite

- **WHEN** 用户在第 2 窗改写期间点开了第 1 窗第 1 轮
- **THEN** 条目面板 MUST 保持第 1 窗第 1 轮的条目，直到用户点「回到当前」或开始一次新的自动循环

#### Scenario: Back to current restores live items

- **WHEN** 用户已锁定历史轮，随后点「回到当前」，且最新一轮仍在进行
- **THEN** 条目面板 MUST 显示当前轮的 live 条目

### Requirement: Rounds carry window identity on the wire

`ChapterAutoLoopRound` MUST 包含可选 `windowIndex` 与 `windowTotal`。SSE `loop_round_end` 的 `round` 以及会话 `rounds` MUST 带上这两字段（单窗时可为 1/1 或省略）。会话 `rounds` MUST 累计所有已结束窗的轮次，MUST NOT 在切窗时被当前窗的空 `completedRounds` 覆盖。客户端合并轮次 MUST 以 `(windowIndex, roundIndex)` 为身份，MUST NOT 仅用 `roundIndex` 覆盖上一窗。

#### Scenario: Session restore keeps prior window rounds

- **WHEN** 第 1 窗已结束并写入会话，第 2 窗开始后客户端刷新并 GET 会话
- **THEN** 返回的 `rounds` MUST 仍包含第 1 窗已结束轮次，且这些轮次 MUST 带有 `windowIndex` 1

#### Scenario: Same roundIndex in two windows is not collapsed

- **WHEN** 第 1 窗第 1 轮与第 2 窗第 1 轮均已 `loop_round_end`
- **THEN** 客户端时间线 MUST 出现两行，MUST NOT 用后者覆盖前者
