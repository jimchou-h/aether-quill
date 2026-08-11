## Context

现状：`useAiTaskProgress` + `AiTaskProgressPanel` 已存在，但章节页仍大量用 `message` 字符串并行报进度；after-save 直接写 `正在执行：${action} (${status})`；优化/精修弹窗各自持有 `aiTaskProgress` 与复杂 `step` 机，页面级活动条看不到弹窗内进度。

本 change 是**前端状态与展示统一**为主，必要时对 after-save SSE 补可读字段。属复杂交互，需明确状态机与边界。

## Goals / Non-Goals

**Goals**

- 章节页有唯一「当前 AI 活动」展示面（活动条）
- after-save / 列表 AI 操作 / 弹窗内 AI 运行，都写入同一进度模型
- 用户始终能读懂：章号、任务名、阶段、可选步骤 n/m、是否可中断、失败原因
- 弹窗步骤条状态（待办 / 进行中 / 待确认 / 完成 / 失败）与真实运行态一致

**Non-Goals**

- 多任务并行队列 UI、Workbench、改 pipeline 业务逻辑

## Decisions

### D1 — 单一活动状态（页面 SSOT）

- 在章节页引入（或升级）**一个** `AiActivity` 状态对象，字段至少：
  - `active` / `cancelled` / `error`
  - `source`: `page` | `after-save` | `dialog:<name>`
  - `chapterNo`（可空，如批量）
  - `taskKey` + 人类可读 `title` / `message`
  - `stage`（如 `queued` | `running` | `awaiting-user` | `completed` | `failed` | `cancelled`）
  - `currentStep` / `totalSteps`（可选）
  - `interruptible` + 中断回调绑定
- `AiTaskProgressPanel` 升级或包装为 **ChapterAiActivityBar**，固定挂在章节页主内容上方（弹窗打开时仍可见，或弹窗顶部镜像同一状态）
- 弹窗内可保留局部进度展示，但 **MUST 同步写入页面 SSOT**（emit / provide-inject / 传入 shared ref）

### D2 — 同时刻一条主活动

- 首期不做队列。若已有 `active` 任务：
  - 用户再触发冲突操作 → 明确提示「请先等待或中断当前任务」，**禁止静默覆盖**
  - 或：仅当用户确认「中断并开始新任务」才替换
- 成功完成后短延迟可清空，或保留「已完成」态直至下一次操作 / 手动关闭（实现选一种并在 UI 一致；推荐：**完成态保留至下次 start 或用户关闭**）

### D3 — After-save 可读阶段

- 映射表：`summarize` / `relation-events` / … → 中文阶段文案（「正在生成第 N 章摘要…」）
- 进度写入页面活动条；`confirm()` 可保留，但确认后立刻 `start` 活动
- 优先使用 SSE 已有 progress；若只有 `action+status`，前端映射层补齐 `message`；若契约缺字段再最小补 OpenAPI

### D4 — 弹窗步骤可见性

- 写作优化：`instruction → plan → draft → apply` 每步标注状态；AI 请求中步骤为「进行中」，返回待用户操作为「待确认」
- 创作精修：现有 `pipelineSteps` 与 `step`/`running` 对齐；子阶段（大纲生成、正文流式、验收、修订）反映在活动条 `message`，步骤条高亮当前模块
- 终稿 / 合规：同样同步到页面活动条（同能力覆盖，避免遗漏入口）

### D5 — 与 Toast/`message` 分工

- **进行中**：只走活动条（不再用顶栏 `message` 重复刷「正在…」）
- **终态短反馈**：可用现有 `presentSuccess` / `presentError`（一次性），不替代活动条错误态

## Risks / Trade-offs

- 弹窗与页面共享状态若用 prop 钻透，改动面大 → 优先 **provide/inject 或传入 shared Ref**
- 静默覆盖会导致「以为在跑 A 实际已是 B」→ D2 禁止静默覆盖
- 并行 change `unify-generation-settings-frontend` 可能同改错误展示 → 活动条错误优先展示服务端 `message`，与之兼容不冲突

## Migration

- 无数据迁移；纯前端状态与可选 OpenAPI 小补丁
