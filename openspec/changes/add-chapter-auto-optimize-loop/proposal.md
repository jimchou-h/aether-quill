## Why

现有文笔优化是「方案 → 正文」单向一次。已落地的 multi-pass 虽能连跑，但方案第 2 轮吃的仍是**上一版方案**，正文轮是**整章重写**：模型看不到自己刚写出来的结果，无法发现「改坏的地方」，且每轮整章重吐会把本来没问题的句子一起洗一遍（越改越平），单章 3 轮耗时 5～15 分钟。

作者需要真正的 critique → revise 闭环：方案读**刚写出的新正文**复诊，正文只重写**被复诊命中的段落**，其余原样保留。

## What Changes

- 文笔优化新增第三种改写模式 `auto-loop`，与 `from-plan` / `direct` 并列。
- 循环由**后端单条 SSE** 驱动：`复诊 → 局部改写` 为一轮，跑 1～3 轮（默认 2）。
- 方案输出**结构化条目**（`paragraphIndex` + `anchorQuote` + `severity` + 改写指令），不再是自由文本。
- 正文只重写命中段落，未命中段落原样拼回（机器保证不经模型）。
- 定位双保险：后端按空行切段并打 `[n]` 编号喂给模型；编号与引文不一致时先做引文模糊挽救，挽救失败则**跳过该条并在 UI 明列**，绝不静默丢。
- 分层闸门：单段超限只回滚该段；仅全章累积字数越界才整轮回滚。
- 收敛提前退出：本轮无 `severity=high` 条目即停。
- 每轮条目实时摊出并逐条回填状态；用户可随时「停在当前轮并收下这稿」。
- 中间稿存后端轻量 session（进程内 + TTL），扛前端刷新与误关弹窗。

## Capabilities

### New Capabilities

- `chapter-auto-optimize-loop`: 章节自动优化循环（复诊 → 局部改写，多轮）。

## Non-goals

- 不改 `from-plan` / `direct` 两条现有路径的任何行为。
- 不做批量多章（单章为限）。
- 不做 apply 时的三方合并；冲突沿用错误码 1307 并保留成稿供人工 diff。
- 不做 session 落库（进程内 + TTL，不扛 API 重启）。
- 不改创作精修 Pipeline、终稿合规、一键终稿、工作台续写。

## Impact

**OpenAPI（契约先行）**

- 新增 `POST /api/projects/{id}/knowledge/chapters/{chapterNo}/optimize/auto-loop`（SSE）。
- 新增 `GET .../optimize/auto-loop/session`（刷新恢复）。
- 新增 schema：`ChapterAutoLoopRequest` / `ChapterAutoLoopItem` / `ChapterAutoLoopRound` / `ChapterAutoLoopSession`。
- 新增 SSE 事件：`loop_round_start` / `loop_plan_items` / `loop_item_status` / `loop_round_end`。
- 复用 `POST .../optimize/apply`，不改其契约。

**错误码**：不新增。沿用 1307（章节版本冲突）、1325（内容安全阻断）。会话不存在按现有 404 语义处理。

**Task prompt**：新增 2 个 key `chapter.optimize.loop.plan` / `chapter.optimize.loop.draft`，落入 Settings 现有「文笔优化」分组（`chapter.optimize.*` 规则免改）。默认文本须三处同步：util 运行时种子、API 白名单 `task-prompt-defaults.ts`、orchestrator 兜底 `WAREHOUSE_TASK_PROMPT_DEFAULTS`。

**文风样本**：`chapter.optimize.loop.draft` 加入注入白名单；`loop.plan` 不注入（与现有 plan 一致）。
