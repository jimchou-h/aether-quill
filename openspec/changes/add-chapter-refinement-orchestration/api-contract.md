# API 与运行状态合同草案

本文件是实施前的合同设计，**本轮没有修改 openapi/**。开发必须先把以下行为落入 OpenAPI，再生成类型和实现；若发现既有错误码映射不一致，先修合同说明，不自行约定新字段。

## 1. 对外路径

统一前缀：`/api/projects/{id}/knowledge/chapters/{chapterNo}/optimize/refinement`。

| 方法／路径 | 行为 | 响应 |
|---|---|---|
| POST `/runs` | 冻结已保存章节并创建执行任务；返回后由 API 后台执行 | 202，统一 envelope 的 RunSummary |
| GET `/runs` | 查询本人最近运行，`limit` 默认 10、上限 20 | 200，RunSummary[] |
| GET `/runs/{runId}` | 读取权威状态、完整已接受稿与问题 | 200，RunView |
| GET `/runs/{runId}/events` | SSE 观察当前运行；不负责启动／取消 | 200，SSE |
| POST `/runs/{runId}/cancel` | 显式中止当前执行尝试，保存最后有效 checkpoint | 200，RunSummary；幂等 |
| POST `/runs/{runId}/resume` | 验证原章节、权限与 revision 后从 checkpoint 继续 | 202，RunSummary |
| POST `/runs/{runId}/discard` | 先取消活动尝试，再标记 discarded；候选不应用 | 200，RunSummary；幂等 |

最终应用复用 `POST .../optimize/apply`，不是本前缀的新接口。P0 不提供候选正文 PATCH；对比区只读。

所有接口使用 JWT 和 owner/editor 项目权限，且只允许 run 创建者访问／操作自己的 run；同项目其他成员不得凭 runId 读取冻结原文和私有 Prompt。权限变更后再次访问／继续须重新校验。

## 2. 创建请求

```ts
type ChapterRefinementCreateRequest = {
  clientRequestId: string; // UUID，重复点击幂等键
  expectedChapterUpdatedAt: string; // ISO，必填，与当前保存章节比较
  instruction: string; // trim 非空，最多 20000 UTF-16 单位
  rewritePolicy?: 'preserve-plot' | 'scene-rewrite'; // 默认 preserve-plot
  diagnosisTargetChars?: number; // 2000..5000，可选；不接受 0
};
```

不接受客户端 `sourceText`；快照从已保存章节取。章节为空拒绝；P0 支持非空且不超过 **30000 UTF-16 单位**的正文，超限返回 400 并告知支持范围，不截前 30000 字。本上限为初期验收范围；扩大需先补评测，不修改旧入口正文上限。

`diagnosisTargetChars` 缺省：项目分段设置正值按 2000..5000 规范化；设置为 0 使用新入口自动值 3000。返回 `resolvedPolicy.diagnosisTargetChars` 与 `normalizationReason`，UI 能解释。旧设置不被改写。

创建阶段冻结要求、正文版本、模板文本／版本、项目文风、模型路由标识、参考内容。同一 `clientRequestId`、同一创建者／项目／章节及同一 payload hash 返回同一个 run；同键不同 payload 返回 409。重复 POST 不重复模型调用。前端每次明确新建生成新键，重试网络请求保留旧键。

## 3. RunSummary 与 RunView

```ts
type RefinementStatus =
  | 'queued' | 'running' | 'paused'
  | 'ready' | 'ready_with_issues' | 'failed' | 'discarded' | 'expired';
type RefinementPhase =
  | 'reading' | 'planning' | 'rewriting' | 'repairing' | 'verifying' | 'finished';
type PauseReason =
  | 'user_cancelled' | 'budget_exhausted' | 'upstream_failure'
  | 'process_restart' | 'context_budget' | 'invalid_model_output'
  | 'boundary_conflict' | 'permission_revoked' | 'source_changed';
type RunSummary = {
  runId: string; projectId: string; chapterNo: number;
  status: RefinementStatus; phase: RefinementPhase;
  revision: number; attemptId: string | null;
  baseUpdatedAt: string; baseHash: string;
  rewritePolicy: 'preserve-plot' | 'scene-rewrite';
  createdAt: string; updatedAt: string; expiresAt: string;
  pauseReason?: PauseReason; resumable: boolean;
  storageMode: 'postgres' | 'memory';
  progress: { unitIndex: number; unitTotal: number; sceneId?: string; message: string };
  resolvedPolicy: {
    diagnosisTargetChars: number; normalizationReason?: string;
    rewriteTargetChars: number; rewriteMaxChars: number;
    maxRepairPasses: number; maxCallsPerAttempt: number; maxActiveMsPerAttempt: number;
  };
  usage: {
    callCount: number; activeElapsedMs: number;
    inputTokens?: number; outputTokens?: number;
    tokenAccounting: 'actual' | 'estimated' | 'mixed' | 'unavailable';
  };
};
type RunView = RunSummary & {
  instruction: string; baseText: string;
  acceptedDraftText: string; // 含所有原文未处理尾部；不能把它等同于已验收终稿
  chapterBrief: string | null;
  changes: Array<{ sceneId: string; startOffset: number; endOffset: number; summary: string }>;
  issues: Array<{
    id: string; category: 'hard_constraint' | 'continuity' | 'style' | 'coverage';
    severity: 'high' | 'medium' | 'low'; sceneId?: string; unitId?: string;
    candidateRevision?: number; anchorQuote?: string;
    message: string; disposition: 'resolved' | 'retained_original' | 'warning' | 'unresolved';
  }>;
  coverage: { sourceChars: number; plannedChars: number; processedChars: number; retainedOriginalChars: number };
  sourceCurrent: boolean; // 查询时检查，变化后不可对旧正文继续／应用
};
```

公共响应不包含创建者密钥、完整原始模型提示、内部游标、原文全文的多份候选历史或 checkpoint JSON。冻结原文／候选稿只在 RunView 获取，不随每个进度事件重复传输。

## 4. 状态语义

- `queued → running`：后台开始执行。status 独立于 phase，reading 等不是 status。
- `running → paused`：取消、预算、可恢复错误；已接受稿和待办范围保留。没有足够预算做最终检查时也暂停，不能伪装 ready。
- `paused → running`：POST resume 使用 `expectedRunRevision` 条件更新。先校验冻结原文版本、权限、模板快照可用；另开 attemptId，恢复已持久化游标，不重跑已接受单位。补修次数累计保留。
- `running → ready`：全文范围处理完，硬检查通过，最终检查完成，没有未解决实质问题。
- `running → ready_with_issues`：最终检查完成，完整稿硬检查通过，但有警告或因失败保留原文的范围；应用前 UI 显示并由作者确认这些问题。
- `running → failed`：快照损坏等不可恢复错误，不能继续／应用；可新建 run。
- 任意非 expired 状态可以 discard；ready/failed 等不是再次 resume 的入口。
- TTL 到期由清理逻辑删除内容，只保留必要 tombstone 或返回 410；不得将到期当全文检查成功。

ready/ready_with_issues/failed 保留至终态时间后 7 天；paused 连续 7 天无操作到期。queued/running 不按 TTL 删除。discard 立即清理冻结正文、候选与 Prompt 材料，响应仅为最小状态记录，RunView 正文不再可读；discarded 的再次 discard 返回同一状态。到期墓碑最多保留 7 天并返回 410，之后返回 404。

discarded 可在运行列表看到最小 RunSummary；GET RunView／新建 events 订阅返回 410，提示候选已丢弃，已有观察者只接收 finished 的最小状态。无正文快照的墓碑不合成一个空 RunView。

`source_changed`、`boundary_conflict` 或快照不能满足 `context_budget` 时 `resumable=false`，保留成果供查看，需更改要求／配置后新建 run。权限撤销期间不可继续；权限恢复后可重新核验。上游暂时故障、取消、重启与调用／时间预算暂停可继续；不能用 resume 修改冻结要求、策略或模型限额。

plan 的初次调用与一次额外调用名额均已消耗且合同仍不合法时，暂停为 invalid_model_output 且 resumable=false，避免 resume 重置节点恢复次数。沿用既有字段，不新增错误码；具体证据回填及降级规则见 [plan-contract-recovery.md](plan-contract-recovery.md)。

新 run 不使用 `applied` 状态：它描述候选生成，应用仍由旧 apply 描述。sourceCurrent=false 时保留可查看成果，禁止继续与覆盖；不能自动把 run 的 baseUpdatedAt 改成最新版本。

## 5. 观察流

每个事件有 `event`、`runId`、`revision`、`attemptId`、`seq`。`seq` 仅在当前 attempt 单调递增；客户端按 `(attemptId,seq)` 去重，不能假定 API 重启后 seq 连续。

| event | payload | 说明 |
|---|---|---|
| `snapshot` | RunView | 订阅／重连时先发送权威快照；丢弃旧临时流文本 |
| `stage` | phase、unitIndex、unitTotal、message | 范围／阶段进度，未知总量不伪造百分比 |
| `content` | unitId、candidateRevision、text | 当前未接受候选的临时增量；`text` 为真实 JSON 字符串，不额外二次转义换行 |
| `unit_settled` | unitId、disposition、summary | 已接受或保留原文；客户端重新 GET 获取完整拼稿 |
| `issue` | 公共 issue | 有明确问题；不作为自动停止的唯一信号 |
| `paused` | RunSummary | 明确暂停原因；用户取消不显示 error Toast |
| `finished` | RunSummary | ready／ready_with_issues／failed／discarded；随后关闭本订阅 |
| `error` | 现有 Error envelope 的公开字段 | 观察失败／权限失败；不把订阅失败误认后台任务失败 |

P0 不做事件历史重放；`Last-Event-ID` 不能用于省略 snapshot。重连始终 snapshot 后接实时事件，UI 无须依赖丢失的 content 增量重建正文。SSE 心跳沿用 15 秒；关闭订阅不绑定后台执行 AbortController。

## 6. 命令与错误

resume／discard 请求包含 `expectedRunRevision`；cancel 幂等且取消旧 attempt 时迟到回调无效。resume 可为新执行尝试补充默认预算，`usage.callCount` 等历史累计不清零。

cancel 请求包含观察到的 `expectedAttemptId`：仅取消匹配的活动尝试；同一尝试已取消时幂等返回，已进入另一 attempt 时返回 409，避免旧浏览器请求误取消新续跑。discard 的重复请求已处于 discarded 时也幂等返回；其余 revision 不匹配返回 409。

| 情况 | HTTP／语义 |
|---|---|
| 非法参数、空正文、超过 30000 长度 | 400，使用现有验证错误 envelope |
| JWT／项目成员权限不足 | 401／403，沿用既有鉴权处理 |
| 项目、章节或 run 不存在／属于其他创建者 | 404，避免泄露其他人的 run |
| 同作者同章已有 queued/running；幂等键冲突；run revision 冲突 | 409，沿用现有 envelope，区分 message；不新开错误码段 |
| 正文已变更 | 版本错误码 1307；HTTP 按更新后的 OpenAPI 与旧全局过滤器一致映射 |
| 内容安全阻断最终应用 | 沿用现有 apply 行为，不绕过其规则 |
| 上游失败 | 沿用 1502；后台 run 标 paused/upstream_failure，HTTP 与 SSE 观察语义分开 |
| run 到期 | 410；正文不可访问，UI 提示重新开始 |

手册将 1307 描述为 409，现有 apply 实现使用 BadRequestException；实施必须先确认全局过滤器实际映射并写明新入口响应，不能在新入口偷偷改变旧路径 HTTP。

## 7. 新模型调用的内部完成合同

为新精修 gateway 的严格调用增加完成元数据：`finishReason: stop|length|content_filter|unknown`、`completed: boolean`、可用 usage。公共生成 SSE `end` 上字段全部可选，旧调用不传严格标志时保持原响应及接受规则。

严格模式只有成功 end、传输正常完成且 finishReason=stop 才可接受正文。length／连接提前关闭拒绝；unknown 自动重试一次仍未知则暂停，不凭尾部句号判断完整。provider 解析已有统计须贯穿 generation trace → orchestrator end → API stream client，不重复实现供应商解析器。
