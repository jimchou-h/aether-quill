## Context

文笔优化已有三条互斥路径，都在 `ChapterOptimizeDialog`：`from-plan`、`direct`（`rewriteMode=direct` 时 **忽略** `sourceText`，长章仍按字数切窗）、`auto-loop`（复诊条目 + 只改命中段）。用户要按场加料、跑完检查、点句修，但不能再改这三条的行为，以免回归难拆。

## Goals / Non-Goals

**Goals:**

- 独立弹窗 + 独立契约，从章节页另开入口
- 用户划定的连续范围当作一场；超长时同场续写窗顺序生成并拼回，不按高潮拆场
- 性爱 / 日常两档 prompt，检查只报体位、用词、改差
- 划句或勾条目只改选区
- 应用复用现有整章 apply（前端拼全文）

**Non-Goals:**

- 改 `ChapterOptimizeDialog` 的模式切换、SSE、分段或 prompt
- 改 `ChapterOptimizationDraftRequest.rewriteMode` 枚举
- 自动认场、整章按场队列（可列后续，本 change 不做自动连跑）
- 检查里出「加深 / 更色 / 补接吻」

## Decisions

### D1 — 新弹窗，不往旧弹窗加第四个单选

**选择**：`ChapterOptimizeWorkbenchDialog.vue`，章节页按钮「按场成稿」。  
**不选**：在现有 `mode-toggle` 加一项。旧弹窗状态机、步骤条、分段进度已经缠在一起，加第四模等于改现有。  
**替代**：同弹窗只加入口按钮，本 change 禁止改其 script 逻辑。

### D2 — 新 OpenAPI 路径，不复用 draft 的 direct

`direct` 明确忽略 `sourceText`。若给 direct 开 sourceText，旧客户端与分段策略会一起变。

新路径（均挂现有章节优化鉴权）：

- `POST .../optimize/workbench/draft` SSE：范围正文 → 范围成稿
- `POST .../optimize/workbench/review` JSON：范围成稿 + 档位 → `{ items: [] }`
- `POST .../optimize/workbench/fix-span` SSE：选区 + 指令 → 选区替换

Apply：`POST .../optimize/apply`，body 为拼好的**整章**。乐观锁仍用章节 `updatedAt`。

### D3 — 范围用 `startOffset` / `endOffset`（UTF-16 码元，与前端 `String` 一致）

打开弹窗时冻结 `baseText` + `baseUpdatedAt`。划选得到偏移。生成后：

`preview = baseText.slice(0, start) + rangeDraft + baseText.slice(end)`

其后 `end` 随 `rangeDraft` 长度更新。并发保存导致偏移失效时，apply 走现有冲突，用户重开。

服务端从冻结 `sourceText` 再切范围前、后各至多 2000 字，以 `<before-context>` / `<after-context>` 只读注入，让范围稿头尾能接上本章未划进的文字。按场成稿不注入【近期章节摘要】与【语义记忆章节】；角色卡只走【检索证据】，叙事出场块只留动态快照，避免静态卡灌两遍。旧三模式叙事块不变。

**不选**锚点摘句定位：重复对白会定位错。

### D4 — 不走旧 `splitIntoSegments`，超长场用同场续写窗

用户为防接缝才手划一场，禁止按高潮拆场，也禁止复用旧文笔优化的 `splitIntoSegments`（那条路径会换 prompt、按章切窗）。  
超长范围按约 5200 字在段落/句号处切开，顺序续写：后窗只吃已改写前文作 `<before-context>`，只输出本窗。短范围仍一次生成。硬顶与现有 `sourceText` 相同（200000）。

### D5 — 档位 = task prompt，检查种类写死

- `chapter.optimize.workbench-draft-sex`
- `chapter.optimize.workbench-draft-prose`
- `chapter.optimize.workbench-review`
- `chapter.optimize.workbench-fix-span`

Settings「文笔优化」分组按 `chapter.optimize.*` 自动收入。  
Review 的 `kind`：`pose` | `vocab` | `regression`。`regression` 仅：缩写、并段、当拍接触被删、比喻砍残。空列表合法。性爱档才跑 `pose`/`vocab`；日常档只跑 `regression`（可加衔接接不上，不得加色）。

### D6 — 点句修复与检查修复同一条 fix-span

勾条目时用 `anchorQuote` 在**当前范围成稿**里定位；找不到则 `skipped_unlocatable`，不整段重写。划句则用选区原文当 span。前后各带只读上下文（约 400 字），禁止改选区外。

### D7 — 三处默认 prompt 同步

`packages/prompt-templates`、API `task-prompt-defaults`、orchestrator `task-prompt-defaults` 必须同 change 落地。仓库默认只写档位职责与检查禁令，**不**把用户私有词表写进默认。

## Risks / Trade-offs

- **偏移失效** → 打开时冻结 base；apply 冲突则提示重开。不在服务端猜场。
- **超长一场** → 同场续写窗，避免开头加料、后半照抄；窗缝靠已改写前文衔接，不按高潮拆。
- **检查模型加料** → prompt 写死空列表优先；前端丢弃 `kind` 非法或 instruction 含「加深/写细/补接吻」的条目。
- **旧三模式回归** → 本 change 的 diff 不得改 `ChapterOptimizeDialog.vue` 行为；CI 保留其单测。

## Migration

无数据迁移。旧入口原样。回滚：隐藏章节页按钮并下线新路由，旧优化不受影响。

## Open Questions

- 无。整章多场连跑留到后续 change。
