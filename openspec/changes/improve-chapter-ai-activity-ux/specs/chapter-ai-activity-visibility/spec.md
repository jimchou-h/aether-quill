## ADDED Requirements

### Requirement: Page-level single AI activity surface

章节页 MUST 提供唯一的当前 AI 活动展示面（活动条），在任务进行中、已取消、失败、或刚完成尚未关闭时可见；MUST 展示至少：人类可读任务说明、可选章节号、可选步骤进度（如 `2/4`）、失败时的可读错误。进行中的进度 MUST NOT 仅依赖顶栏/Toast 式 `message` 字符串作为唯一信号。

#### Scenario: User can see active AI work on the chapter page

- **WHEN** 用户在章节页触发任意纳入本能力的 AI 任务且任务处于进行中
- **THEN** 页面活动条 MUST 可见，并显示可读任务说明（非原始 `action (status)` 技术串）

#### Scenario: In-progress status is not toast-only

- **WHEN** AI 任务正在运行
- **THEN** 系统 MUST 通过活动条表达进度；MUST NOT 仅用会被下一条通知覆盖的短暂 Toast 作为唯一进度展示

### Requirement: Single active task without silent overwrite

同一章节页在同一时刻 MUST 最多展示一条主活动。若已有进行中的活动，用户再触发冲突的新 AI 操作时，系统 MUST 阻止静默覆盖，并提示先等待或先中断；仅在用户明确确认「中断并开始新任务」（若提供该选项）或当前活动结束后，才可开始新活动。

#### Scenario: Conflicting start while busy

- **WHEN** 活动条已有 `active` 任务，用户再次触发另一 AI 操作
- **THEN** 系统 MUST NOT 在无确认的情况下用新任务状态覆盖旧任务；MUST 给出可理解的忙碌/冲突提示

### Requirement: Readable after-save progress

章节保存（或插入）后用户确认执行的后处理（如摘要、关系事件等）MUST 将进度写入页面活动条；阶段文案 MUST 为中文可读描述（例如「正在生成第 N 章摘要…」）；若任务可中断，活动条或关联控件 MUST 提供中断入口；失败时 MUST 展示可读错误。

#### Scenario: After-save summarize is understandable

- **WHEN** 用户保存章节并确认执行包含摘要的后处理，且摘要阶段开始
- **THEN** 活动条 MUST 显示可读摘要进度文案，MUST NOT 仅显示类似 `summarize (processing)` 的技术串

#### Scenario: After-save can be interrupted when supported

- **WHEN** after-save SSE 处于可中断运行中
- **THEN** 用户 MUST 能从活动条或明确关联控件中断；中断后活动条 MUST 进入已取消态并提示可重试

### Requirement: Optimize and pipeline dialogs sync activity and step clarity

写作优化与创作精修（以及同页的终稿、合规等 AI 弹窗）在 AI 运行期间 MUST 将进度同步到章节页活动条；弹窗内步骤条 MUST 反映当前模块/步骤，并区分至少：未开始、进行中、待用户确认、已完成、失败（或等价视觉状态）。活动条 `message` MUST 说明当前子阶段（例如生成方案、流式生成正文、对照大纲验收）。

#### Scenario: Pipeline running shows module and sub-stage

- **WHEN** 用户在创作精修中执行某一模块且 AI 正在生成
- **THEN** 步骤条 MUST 高亮该模块为进行中，且页面活动条 MUST 同步显示该任务的可读说明与子阶段

#### Scenario: Waiting for user confirmation is distinct from running

- **WHEN** AI 已返回结果、等待用户确认/编辑/应用
- **THEN** UI MUST 将该步呈现为待确认（或非「生成中」），MUST NOT 继续显示为正在生成

#### Scenario: Writing optimize steps remain legible

- **WHEN** 用户处于写作优化的方案或正文生成阶段
- **THEN** 步骤状态与活动条 MUST 让用户能区分「正在生成」与「已生成待继续」

### Requirement: Interruptible streams expose interrupt affordance

对已支持 SSE 中断的章节 AI 流式任务，当 `interruptible` 为真且任务进行中时，活动条或紧邻控件 MUST 提供中断操作；中断后 MUST 更新活动状态为已取消，且 MUST NOT 假装任务仍在成功进行。

#### Scenario: User interrupts a streaming optimize draft

- **WHEN** 写作优化或精修的流式生成进行中且支持中断，用户触发中断
- **THEN** 流 MUST 停止，活动条 MUST 显示已取消（或等价），用户 MUST 能再次发起

## REMOVED Requirements

- （无）
