## ADDED Requirements

### Requirement: Isolated workbench entry

系统 MUST 在章节页提供与「文笔优化」分开的「按场成稿」入口，MUST 打开独立弹窗。现有文笔优化三种模式的请求契约、分段策略与弹窗行为 MUST NOT 因本能力改变。

#### Scenario: Existing optimize dialog stays unchanged

- **WHEN** 用户只打开「文笔优化」
- **THEN** 系统 MUST 仍只提供方案改写、直接改写、自动循环，MUST NOT 要求用户先划场

#### Scenario: Workbench is a separate dialog

- **WHEN** 用户打开「按场成稿」
- **THEN** 系统 MUST 打开工作台弹窗，MUST NOT 复用 `ChapterOptimizeDialog` 的模式切换来完成划场或检查

### Requirement: User-drawn range is the only send unit

系统 MUST 让用户在冻结的章节正文上划定连续范围（`startOffset` / `endOffset`）。一场 MAY 包含多次性爱。系统 MUST 只把该范围当作一场改写目标，MUST NOT 按高潮次数拆场，MUST NOT 走旧文笔优化的 `splitIntoSegments`。超长范围 MAY 按续写窗顺序生成并拼回，后窗 MUST 只读已改写前文作衔接。系统 MUST 把范围前后各至多约 2000 字作为只读衔接上下文注入，MUST NOT 把它们写入模型输出或改写进预览。按场成稿 MUST NOT 注入【近期章节摘要】或【语义记忆章节】。范围外正文 MUST 字节级保留到预览拼回。

#### Scenario: One range with multiple sex beats stays one scene

- **WHEN** 用户划定客厅内连续三次插入的整段并开始加料
- **THEN** 系统 MUST 仍把它当作同一场，MUST NOT 按高潮次数拆成互不衔接的多次独立任务

#### Scenario: Long range continues in rewrite windows

- **WHEN** 用户划选的连续范围明显长于单窗可稳定加料的长度
- **THEN** 系统 MUST 按同一场顺序续写并拼成一篇范围成稿，MUST NOT 只改开头、后半原样交回

#### Scenario: Adjacent chapter text is read-only stitch context

- **WHEN** 用户从章中某一场开始划选
- **THEN** 系统 MUST 把该范围前、后各至多约 2000 字作为只读上下文送给模型，MUST NOT 要求模型输出或改写这些文字

#### Scenario: Outside the range is not rewritten

- **WHEN** 用户只划浴室一段
- **THEN** 预览中浴室以外的正文 MUST 与打开弹窗时的冻结原文一致

#### Scenario: Empty or inverted range is rejected

- **WHEN** 起止为空或 `startOffset >= endOffset`
- **THEN** 系统 MUST NOT 调用模型，MUST 提示用户重新划选

### Requirement: Sex and prose profiles

系统 MUST 提供两档：性爱加料、日常文笔。性爱档 MUST 按加料要求改范围内正文。日常档 MUST NOT 按性爱加料要求增色、增动作或跑体位/词表检查。

#### Scenario: Prose profile does not thicken sex

- **WHEN** 用户对过场选「日常文笔」并生成
- **THEN** 系统 MUST 使用日常 draft prompt，MUST NOT 注入性爱加料要求

### Requirement: Single review after draft

范围成稿完成后，系统 MUST 允许一次检查。条目 `kind` MUST 为 `pose`、`vocab` 或 `regression`。`regression` MUST 仅描述缩写、并段、当拍接触被删或比喻被砍残。系统 MUST 允许返回空列表。系统 MUST NOT 把「加深」「写细」「补接吻」「更色」当作合法检查指令。

#### Scenario: Empty review is success

- **WHEN** 检查模型认为没有体位、用词或改差问题
- **THEN** 系统 MUST 展示空列表，MUST NOT 为凑数生成条目

#### Scenario: Additive review items are dropped

- **WHEN** 某条 instruction 含「加深」「写细」「补接吻」或 `kind` 非法
- **THEN** 前端 MUST 丢弃该条，MUST NOT 提供修复

#### Scenario: Prose review skips pose and vocab

- **WHEN** 当前档为日常文笔
- **THEN** 检查 MUST NOT 要求补体位特写或词表替换

### Requirement: Span fix only replaces the selection

用户划选成稿中的连续文本，或勾选带 `anchorQuote` 的检查条目时，系统 MUST 只改该选区（或锚点唯一命中的片段），MUST NOT 把范围外或选区外正文送进改写输出。锚点无法唯一命中时 MUST 跳过并说明，MUST NOT 改整段或整场。

#### Scenario: Sentence selection rewrite

- **WHEN** 用户划「囊袋拍打着她臀肉……」并指令改为拍会阴
- **THEN** 返回文本 MUST 只替换该选区，选区前后 MUST 保持不变

#### Scenario: Unlocatable item is skipped

- **WHEN** 条目 `anchorQuote` 在当前成稿中出现 0 次或超过 1 次
- **THEN** 系统 MUST 不改写，MUST 将该条标为无法定位

### Requirement: Apply splices the full chapter

用户确认应用时，系统 MUST 把「范围前原文 + 当前范围成稿 + 范围后原文」作为整章正文提交现有 apply，MUST 带打开时的乐观锁。MUST NOT 只把范围片段当作整章覆盖。

#### Scenario: Apply keeps unslected scenes

- **WHEN** 用户只优化了浴室范围并应用成功
- **THEN** 库中该章浴室外正文 MUST 与冻结原文一致

#### Scenario: Reselecting frozen text keeps the current draft

- **WHEN** 范围内成稿已生成，用户又在冻结正文上划了另一段
- **THEN** 系统 MUST 保留当前成稿与检查结果，MUST 仍按生成时的范围做对照和整章拼回，MUST NOT 因这次划选清空成稿

#### Scenario: Draft is compared with the selected original

- **WHEN** 范围内成稿已生成
- **THEN** 系统 MUST 并排展示生成时划选的原文与成稿增删对照

#### Scenario: Range draft must rewrite the selected original

- **WHEN** 用户对性爱加料或日常文笔发起范围内成稿
- **THEN** 送给模型的要求 MUST 禁止大段照抄与原样交回 <range-original>
- **AND** 若返回几乎等于划选原文，界面 MUST 提示几乎未改，MUST NOT 把它当成一次成功加料

### Requirement: Workbench contract is additive

OpenAPI MUST 新增 workbench draft / review / fix-span，MUST NOT 修改现有 `rewriteMode` 枚举，MUST NOT 让 `direct` 开始读取 `sourceText`。非法请求 MUST 沿用 400，MUST NOT 新增错误码段。

#### Scenario: Direct mode sourceText behavior unchanged

- **WHEN** 客户端仍对旧 draft 接口发送 `rewriteMode=direct` 与 `sourceText`
- **THEN** 服务 MUST 仍忽略该 `sourceText`，行为与本 change 之前一致
