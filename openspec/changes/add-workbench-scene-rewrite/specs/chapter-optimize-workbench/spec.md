## ADDED Requirements

### Requirement: Scene rewrite mode with confirmed plan

系统 MUST 在按场成稿工作台内提供与「感官加料 / 日常文笔」并列的第三模式「按场创编」。该模式 MUST 按「划范围 → 范围方案 → 用户确认 → 范围成稿」顺序执行；方案未经用户确认时系统 MUST NOT 调用成稿。用户 MAY 在确认前编辑方案文本。现有两个直出档位的步骤、请求与成稿行为 MUST NOT 改变。

#### Scenario: Third mode appears inside the workbench dialog

- **WHEN** 用户打开按场成稿工作台
- **THEN** 界面 MUST 提供「按场创编」选项，且该选项 MUST 在现有工作台弹窗内，MUST NOT 新增独立弹窗或改动文笔优化弹窗

#### Scenario: Direct profiles skip the plan step

- **WHEN** 用户选择「感官加料」或「日常文笔」并发起生成
- **THEN** 系统 MUST 直接流式生成范围成稿，MUST NOT 要求先确认方案，行为与本 change 之前一致

#### Scenario: Draft waits for confirmed plan

- **WHEN** 用户在创编模式生成了方案但尚未确认
- **THEN** 系统 MUST NOT 发起成稿请求，MUST 允许用户编辑方案文本后再确认

### Requirement: Scoped plan contract

系统 MUST 提供 SSE 端点 `workbench/plan`，输入为冻结正文、范围偏移与优化要求，输出仅针对该范围的结构化方案（流式文本），MUST NOT 输出正文。方案 MUST 包含：①入场 / 散场状态清单（在场人物、位置、衣着、伤势、情绪落点及与范围后正文的衔接状态）；②逐拍改动账本（`keep / rewrite / expand / delete`，每项带原文锚点与理由）；③篇幅预算（预估总字数与增删分配）；④边界声明。`delete` 项 MUST 写明被删内容原承担的功能与补偿落点；承担情绪递进或伏笔功能的段落 MUST NOT 被整段删除。方案请求 MUST 注入范围前后各至多约 2000 字只读上下文，MUST NOT 注入【近期章节摘要】或【语义记忆章节】。

#### Scenario: Plan addresses only the drawn range

- **WHEN** 用户对划定范围请求创编方案
- **THEN** 返回方案 MUST 只规划 `<range-original>` 内内容，MUST NOT 规划范围外章节，MUST NOT 输出改写后的正文

#### Scenario: Plan carries state ledger and budget

- **WHEN** 方案生成成功
- **THEN** 方案文本 MUST 含入场 / 散场状态清单、逐拍改动账本、篇幅预算与边界声明四部分

#### Scenario: Deleting an emotional beat requires compensation

- **WHEN** 模型拟删除一段承担情绪递进或伏笔功能的原文
- **THEN** 方案 MUST 改为改写 / 压缩该段或写明功能补偿落点，MUST NOT 将其无补偿整段删除

#### Scenario: Invalid plan request is rejected before calling the model

- **WHEN** 范围为空 / 起止颠倒 / 优化要求为空 / `sourceText` 为空
- **THEN** 系统 MUST 返回 400 且 MUST NOT 调用模型

### Requirement: Boundary-locked structural freedom

`mode=from-plan` 的范围成稿 MUST 允许场内结构性改动：删拍、并拍、加料（新波折、新对白、动作 / 感官扩写）与场内顺序重排，篇幅 MAY 增删。成稿 MUST 与方案中的入场 / 散场状态清单一致，MUST 保持人称、时态、人物名称，MUST 以改写后开头接得住 `<before-context>`、结尾接得住 `<after-context>`，MUST NOT 消费后文情节、MUST NOT 新增人物、跨场伏笔或关系转折。范围外正文 MUST 字节级保留到预览拼回。

#### Scenario: Structure changes are allowed inside the range

- **WHEN** 已确认方案要求删除一个过场拍、新增一次突发打断并把两拍对调
- **THEN** 成稿 MUST 落实这些结构改动，MUST NOT 因「禁止另起剧情」而退回同义重写

#### Scenario: Exit state stays locked

- **WHEN** 方案的散场清单写明人物在门口、衣着完整、情绪压抑
- **THEN** 成稿末尾人物状态 MUST 与该清单一致，MUST NOT 出现在床上 / 衣着损毁等接不住后文的状态

#### Scenario: Draft splices into read-only neighbors

- **WHEN** 创编范围成稿生成完成
- **THEN** 预览 MUST 为「范围前原文 + 成稿 + 范围后原文」，范围外部分 MUST 与冻结原文字节一致

#### Scenario: No cross-scene plot is invented

- **WHEN** 用户未在要求中授权新人物或跨场伏笔
- **THEN** 成稿 MUST NOT 引入新人物、关系转折或在后文才应出现的情节信息

### Requirement: Draft request mode is additive

`workbench/draft` 请求体 MUST 新增可选 `mode`（`direct` / `from-plan`，缺省 `direct`）与可选 `planText`。缺省模式下系统 MUST NOT 读取 `planText`，行为 MUST 与本 change 之前完全一致。`mode=from-plan` 时 `planText` MUST 为非空文本，否则 MUST 返回 400。

#### Scenario: Old clients are unaffected

- **WHEN** 客户端对 workbench draft 不传 `mode` 与 `planText`
- **THEN** 请求 MUST 按现有 sex / prose 直出流程处理，响应事件与成稿行为不变

#### Scenario: From-plan without plan text is rejected

- **WHEN** 请求为 `mode=from-plan` 但 `planText` 为空
- **THEN** 系统 MUST 返回 400，MUST NOT 调用模型

### Requirement: Scene rewrite is single-window

创编模式 MUST NOT 使用续写窗切分。当范围超过单窗稳定长度（约 5200 字）时，前端 MUST 在发起前提示用户划小范围；后端收到 `mode=from-plan` 且范围会被切分为多窗的请求时 MUST 返回 400，MUST NOT 静默只改首窗。

#### Scenario: Oversized scene is blocked, not partially rewritten

- **WHEN** 用户在创编模式划选明显超过单窗长度的范围并发起
- **THEN** 系统 MUST 拒绝成稿并提示划小范围，MUST NOT 只生成开头而后半原样交回

### Requirement: Writing layer is isolated from planning scaffolding

创编成稿 prompt MUST 只携带用户确认后的方案文本与行文层约束（只输出范围正文、锁定入场 / 散场状态、账本外段落信息量不得低于原文、禁止占位语），成稿 system prompt MUST NOT 出现「账本 / 举证 / 准入 / 验收」等流程术语。

#### Scenario: Process terms stay out of the writing prompt

- **WHEN** 组装 `mode=from-plan` 的成稿请求
- **THEN** 成稿 system prompt MUST NOT 含账本、举证、准入、验收类措辞，方案仅作为已确认的编辑交底注入 user prompt

### Requirement: Scene reuses review, span fix and apply

创编模式成稿后 MUST 复用现有 `workbench/review`、`workbench/fix-span` 与整章 apply；检查 MUST 允许 `pose / vocab / regression` 全部三类（结构改动需查动作 / 空间穿帮）。点句修复与乐观锁拼回行为 MUST 与现有工作台一致。

#### Scenario: Structural draft receives full-kind review

- **WHEN** 用户对创编成稿发起检查
- **THEN** 系统 MUST 允许 pose、vocab、regression 三类条目，MUST 继续丢弃非法 kind 与「加深 / 写细」类加料指令

#### Scenario: Span fix and apply work unchanged

- **WHEN** 用户对创编成稿做点句修复并最终应用
- **THEN** 选区替换与整章拼回应用 MUST 沿用现有端点、偏移更新与乐观锁机制

### Requirement: Workbench scene contract is additive

OpenAPI MUST 新增 `workbench/plan` 路径并扩展 `workbench/draft` 请求体，MUST NOT 修改 `rewriteMode` 枚举，MUST NOT 改动旧文笔优化接口。非法请求 MUST 沿用 400，上游生成失败 MUST 沿用 1502，MUST NOT 新增错误码段。新 task prompt MUST 在 `packages/prompt-templates`、API `task-prompt-defaults`、orchestrator `task-prompt-defaults` 三处保持镜像一致并走模板版本治理。

#### Scenario: No new error code segment

- **WHEN** 创编模式发生参数错误或上游失败
- **THEN** 系统 MUST 分别返回现有 400 / 1502 错误形态，MUST NOT 引入新错误码

#### Scenario: Templates are mirrored and versioned

- **WHEN** 发布范围方案与创编成稿模板
- **THEN** 三处模板定义 MUST 内容一致、带版本号且可回滚，RAG 评测基线回归通过前 MUST NOT 发布为默认模板
