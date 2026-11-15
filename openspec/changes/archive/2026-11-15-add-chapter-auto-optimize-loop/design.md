## Context

现状三条改文链路：文笔优化（instruction 驱动，`from-plan` / `direct`）、创作精修 Pipeline（分维度 + 大纲 gate + session 版本链）、一键终稿（run-all 多 gate + 错字 + 规则质检）。
本变更在**文笔优化**内新增第三种模式，不动其余两套。关键既有资产：

- `createSseStreamContext`（`services/api/src/common/sse-stream.util.ts`）：`isAborted()` 支持中断。
- `chapter-pipeline-session.store.ts`：进程内 `Map` + 4h TTL 的 session 先例。
- `compliance-check/session`：GET 恢复接口先例。
- `validateMergedChapterDraft`（`chapter-optimize.util.ts`）：占位语检测可复用。
- `runAllModules`：单条 SSE 内跑多次 LLM 调用的先例。

## Goals / Non-Goals

**Goals**

- 方案轮读**上一轮成稿**复诊，输出可机器定位的结构化条目。
- 正文轮只重写命中段落，未命中段落不经模型。
- 中断/失败/降级都保留可用成稿，且原因对用户可见。

**Non-Goals**

见 `proposal.md` 的 Non-goals；此外不引入新错误码、不改 apply 契约。

## Decisions

### 1. 循环由后端驱动，单条 SSE 跑完全程

备选是前端连打两个接口（现有 multi-pass 的做法）。否决原因：每轮要把整章正文来回搬运；且中间稿本来就要落服务端 session。`runAllModules` 已证明长 SSE 可行。
一轮 = `loop_round_start` → 复诊（1 次 LLM）→ `loop_plan_items` → 逐段改写（N 次 LLM，N = 命中段数）→ 逐条 `loop_item_status` → 闸门 → `loop_round_end`（带本轮成稿）。

### 2. 段落切分与无损拼回

按 `\n\s*\n` 切段但**保留原始分隔符**，使未改动段落可字节级还原。编号从 1 开始，以 `[n] 段落文本` 形式喂给模型——模型只需照抄编号，不靠自己数行。
一个槽位允许吐成多段（长段拆成对白 + 动作是合理改法），不允许跨槽位合并。同一段落被多条命中时**合并成一次改写**（否则后一条覆盖前一条）。

### 3. 定位双保险与两级降级

条目须带 `paragraphIndex` 与 `anchorQuote`。校验 `anchorQuote` 是否出现在该段：

1. 命中 → 直接用该段。
2. 不命中 → 拿 `anchorQuote` 在全章做归一化模糊匹配（去标点/空白）。匹配到**唯一**段落则以引文为准，条目状态 `relocated`。
3. 匹配不到或匹配到多处 → 条目状态 `skipped_unlocatable`，计入 `loop_round_end.unlocatableCount`，UI 明列。

### 4. 单轮命中上限，防退化为整章重写

若不限，模型可能命中全部段落，等于绕回整章重写并丢掉本方案全部收益。上限 = `min(12, max(3, floor(总段数 × 0.35)))`，按 `severity` 降序 + `paragraphIndex` 升序截断，被截断条目状态 `deferred`（下一轮仍可再被提出）。
**末轮豁免**：`roundIndex >= roundBudget` 时放开上限，可定位条目（含上一轮 `deferred` 硬入队）全部改完再收口，避免 `deferred` 永远停在「顺延」。

### 5. 分层闸门

- **段级**：只拒收空输出、占位语、Markdown、说明性开头。不设字数上下限——扩写是用户要求。失败只回滚该段，状态 `rolled_back`。
- **章级**：只守正文丢失兜底——成稿低于入库原文的 20%（`ROUND_COLLAPSE_RATIO`）视为链路故障而非编辑意图，整轮回滚。不裁决改动幅度：改多改少由用户要求与 prompt 决定；不设上限，避免合法扩写被打回。

章级基准始终是入库原文而非上一轮稿。兜底防止循环把整章悄悄删空。

### 6. 收敛提前退出

方案条目须带 `severity: high | medium | low`。本轮复诊无 `high` 条目 **且 `discardedCount === 0`** 时不再进入下一轮，`loop_round_end.converged = true`。轮数上限仍是硬上界（1～5，默认 2），因为模型自评严重度不完全可信。
medium / low 不再续跑：复诊只允许出「要求明显未落地」或「上轮改坏」，这两类标 high；把「还能更贴要求」标成 medium 续跑，会变成一直润色。

收敛判定必须搭上"诊断是否被完整读懂"这个前提。只看 `items` 里有没有 `high` 有严重的假阴性：条目因格式不合法被丢弃后 `items` 变空，"没有 high"就自动成立，于是一轮什么都没读懂的复诊会被报成"未发现严重问题，可以收工"，用户拿回一份未经改动的原文却以为章节已经干净。因此：

- `discardedCount > 0` → 本轮诊断不完整 → `converged = false`，继续用掉轮数预算。
- `items.length === 0 && discardedCount > 0` → 整轮零信息量，等价于 JSON 解析失败 → `stoppedReason = plan_parse_failed`，保留当前稿。

反过来，`{"items":[]}` 且 `discardedCount === 0`（prompt 规则 6：模型明确表示无问题）才是真收敛。
为降低丢弃率，`severity` 与字段名解析对常见抖动做容忍：中文档位（严重/中等/轻微 等）归一化到三档，未知或缺省归一化为 `medium`（不因 severity 丢弃条目），`quote` / `suggestion` 这类同义键名一并接纳。定位信息（编号 + 引文）与可执行指令仍是硬前提，缺失即丢弃——没有它们无法安全地做局部替换。

### 7. 两个 task prompt key，首诊/复诊共用

`chapter.optimize.loop.plan` 与 `chapter.optimize.loop.draft`。首诊与复诊共用 plan prompt，差异由 user prompt 的输入材料承载（有无 `<previous-items>` / 稿件来源）。不拆第三个 key：两个近乎相同的 prompt 会被改歪一个忘一个，且每个 key 都要三处同步。
原始 `instruction` **每轮重申**，作为不变的北极星；复诊输入 = `instruction` + 上一轮条目及其最终状态 + 带编号的新正文。让模型知道哪些要求上轮没落实。

### 8. Session 与中断语义

进程内 `Map`，key = `projectId:chapterNo:userId`，4h TTL，存 `rounds[]`（每轮条目 + 成稿）与 `baseUpdatedAt`。
中断（用户点停）：前端 abort SSE，服务端 `isAborted()` 后停止写事件；前端**已持有**最近一次 `loop_round_end` 的成稿，可直接进入 diff 与 apply。session 仅用于刷新/误关后恢复。
`resume: true` 无可续跑会话时 MUST 拒绝（400 语义），不静默当成全新开始。
Apply 沿用 `optimize/apply` + `expectedChapterUpdatedAt`；冲突返回 1307 并保留成稿。

## Risks / Trade-offs

- **裁判不独立**：复诊与改写是同一模型、同一上下文，存在自我确认偏差——更容易挑出"上轮没顾上的"而非"上轮改坏的"。缓解手段是章级闸门 + 收敛只认 `high` + 轮数硬上界；但这是设计的固有局限，不是可消除的缺陷。
- **逐段改写调用次数变多**：一轮 1 + N 次调用。虽然单次输出短得多、总 token 更省，但请求数上升，需注意供应商速率限制。
- **段落级粒度对"跨段结构问题"无力**：如「这一场戏顺序该颠倒」无法用段内替换表达，只会反复被诊断为 `high` 却改不动。v1 接受此局限，靠 `deferred` / 轮数上界兜住，不做结构级重排。
- **进程内 session 不扛 API 重启**：与 pipeline session 同等级别，已知且接受。