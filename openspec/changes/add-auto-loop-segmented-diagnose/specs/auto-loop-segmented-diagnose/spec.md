## ADDED Requirements

### Requirement: Char windows run a full auto-loop each

系统 MUST 读取项目 `chapterOptimizeSegmentCharSize` 与既有单段阈值。配置为 `0` 或章节未超阈值时，MUST 整章只跑一次现有自动循环。否则 MUST 按空行段落把**剩余未优化原文**攒到约配置字数再切窗，MUST NOT 从段落中间截断；单段本身超过配置字数时该窗 MUST 只含该段。每一窗 MUST 独立跑完整自动循环，弹窗轮数上限 MUST 对每一窗生效。窗内改写 MUST 仍只改命中自然段。已完成的窗 MUST 锁死，后续窗 MUST NOT 再改其正文。系统 MUST 顺序执行：上一窗收工后才开始下一窗，下一窗复诊 MUST 能看到上一窗成稿末尾只读上下文（约 1 段或 400 字），MUST NOT 对只读前文出条目或改写。

#### Scenario: Zero size is a single inner loop

- **WHEN** 分段字数为 `0`
- **THEN** 系统 MUST 只调用一次内层循环，输入为整章正文

#### Scenario: 20000 / 5000 yields about four windows

- **WHEN** 章节约 20000 字且分段字数为 5000、超过单段阈值
- **THEN** 系统 MUST 按攒满约 5000 字切出约 4 窗，且 MUST NOT 腰斩自然段

#### Scenario: Each window uses the dialog round budget

- **WHEN** 用户设置最多 2 轮且切出 4 窗
- **THEN** 每一窗 MUST 最多跑 2 轮（仍可提前收敛），MUST NOT 把 2 轮当成整章总预算

#### Scenario: Finished windows stay locked

- **WHEN** 第 1 窗已收工并开始第 2 窗
- **THEN** 第 2 窗的改写 MUST NOT 修改第 1 窗成稿

#### Scenario: Next window sees read-only previous tail

- **WHEN** 第 2 窗开始复诊
- **THEN** 提示 MUST 包含第 1 窗成稿末尾只读片段，且该片段 MUST NOT 作为可改写段落

#### Scenario: Diagnose never sees next-chapter head

- **WHEN** 自动循环复诊任意一窗（含末窗）
- **THEN** 叙事上下文 MUST NOT 注入【下章衔接】，条目 `anchorQuote` MUST 只能取自当前窗 `<indexed-chapter>`

#### Scenario: Non-last window rewrite omits next-chapter head

- **WHEN** 共 3 窗且正在改写第 2 窗
- **THEN** 叙事上下文 MUST NOT 注入第 N+1 章开头

#### Scenario: Last window rewrite may keep next-chapter head

- **WHEN** 共 3 窗且正在改写第 3 窗，或整章未切窗
- **THEN** 改写 MAY 注入【下章衔接】供章末过渡，MUST NOT 把下章原文写入本窗正文

### Requirement: Stop and resume at the failed window

某一窗因用户停止、`plan_parse_failed` 或整轮回滚而结束时，系统 MUST 停止后续窗，MUST 保留已锁死窗的成稿，MUST 允许 `resume: true` 从该窗内层断点继续。拼进编辑器的稿 MUST 是「已完成窗成稿 + 当前窗进度 + 未跑窗原文」。

#### Scenario: Failure does not skip remaining windows

- **WHEN** 第 2 窗复诊无法解析，第 1 窗已有成稿
- **THEN** 系统 MUST NOT 开始第 3 窗，最终稿 MUST 包含第 1 窗成稿

#### Scenario: Resume skips locked windows

- **WHEN** 用户从第 2 窗失败处继续
- **THEN** 系统 MUST NOT 重跑第 1 窗，MUST 从第 2 窗内层断点继续

### Requirement: Window progress is visible

分段时 SSE `stage` MUST 带 `windowIndex` / `windowTotal`。前端 MUST 展示「第 i/M 窗」并叠内层轮次/段进度。不分段时 MUST NOT 把进度显示成多窗。设置页「章节优化分段字数」说明 MUST 写明同时作用于自动循环。

#### Scenario: Stage events include window counters

- **WHEN** 本趟切为 4 窗且正在第 2 窗复诊
- **THEN** `loop_diagnose` stage MUST 含 `windowIndex` 2 与 `windowTotal` 4

#### Scenario: Settings copy mentions auto-loop

- **WHEN** 用户打开分段字数字段
- **THEN** 说明 MUST 提到自动循环
