> 按**竖切**排期：每个切片自带契约 + 后端 + 前端 + 自动化测试，完成后即端到端可用。禁止「先全部后端再全部前端」。

> 2026-11-15 归档前验证：按代码现实修订章级闸门（20% 崩塌兜底，不裁决改动幅度）、收敛（high-only）、末轮命中上限豁免、severity 容错；补 `resume: true` 无会话拒绝（8.4）。原文件存在编码损坏（U+FFFD），已按上下文重建。

## 1. 切片一：单轮最小闭环（tracer bullet）

端到端目标：用户选 `auto-loop`、点开始，后端跑**一轮**复诊 + 局部改写，前端拿到成稿并能 apply。

- [x] 1.1 OpenAPI 契约：新增 `optimize/auto-loop`（SSE）与 `auto-loop/session`（GET）路径文件，新增 `ChapterAutoLoopRequest` / `ChapterAutoLoopItem` / `ChapterAutoLoopRound` / `ChapterAutoLoopSession` schema，登记 SSE 事件 `loop_round_start` / `loop_plan_items` / `loop_item_status` / `loop_round_end`；在 `openapi/openapi.yaml` 挂载
- [x] 1.2 新增 2 个 task prompt key `chapter.optimize.loop.plan` / `chapter.optimize.loop.draft`，默认文本在 util 种子、`task-prompt-defaults.ts`、orchestrator `WAREHOUSE_TASK_PROMPT_DEFAULTS` **三处同步**
  - 测试：`services/api/src/modules/task-prompts/task-prompt-defaults.test.ts` 断言两个 key 存在且三处文本一致
- [x] 1.3 段落编号与无损拼回纯函数（`splitIndexedParagraphs` / `renderIndexedParagraphs` / `applyParagraphReplacements`）
  - 测试：`chapter-auto-loop.util.test.ts` 覆盖「未命中段落逐字节相同」「单槽位吐多段」「空行分隔符还原」
- [x] 1.4 条目解析纯函数（`parseAutoLoopPlanItems`）：解析模型 JSON，校验必填 `paragraphIndex` / `anchorQuote` / `instruction`，脏数据丢弃并计数；`severity` 未知或缺省归一化为 `medium`，不因 severity 丢弃
  - 测试：同上文件，覆盖合法 / 缺字段 / severity 容错 / 脏 JSON 包裹
- [x] 1.5 循环编排 service 单轮路径 + controller SSE 路由 + `auto-loop/session` GET
  - 测试：`chapter-auto-loop.engine.test.ts` 用 stub LLM 断言单轮事件序列与成稿
- [x] 1.6 前端：`api.ts` 客户端与类型；`ChapterOptimizeDialog` 新增 `auto-loop` 模式与步骤条；成稿进 diff 并复用现有 apply
  - 测试：`writingOptimizeStepVisual.test.ts` 含 `auto-loop` 步骤条断言

## 2. 切片二：定位双保险与两级降级

- [x] 2.1 `resolveItemAnchor`：编号命中直接用；不命中则引文归一化模糊匹配，唯一命中记 `relocated`，零或多命中记 `skipped_unlocatable`
  - 测试：`chapter-auto-loop.util.test.ts` 覆盖「引文救回错编号」「零命中」「多命中」
- [x] 2.2 SSE 推送条目状态与 `unlocatableCount`；前端在条目面板明列「N 条未能定位已跳过」
  - 测试：前端 `chapterAutoLoopItems.test.ts` 断言降级条目渲染为可见的跳过行

## 3. 切片三：分层闸门

- [x] 3.1 段级校验 `validateAutoLoopSegment`：拒收空输出 / 占位语 / Markdown / 说明性开头；不因扩写或收紧失败；失败只回滚该段并记 `rolled_back`
  - 测试：`chapter-auto-loop.util.test.ts` 覆盖坏段回滚不影响同轮好段，以及扩写通过
- [x] 3.2 章级校验 `validateAutoLoopRound`：基准为入库原文，只守正文丢失兜底（低于 20% 视为链路故障整轮回滚）；不裁决改动幅度，不设上限
  - 测试：同上文件，覆盖扩写通过、崩塌仍回滚
- [x] 3.3 前端呈现回滚原因（段级 / 章级各自文案）
  - 测试：`chapterAutoLoopItems.test.ts` 断言两类回滚文案

## 4. 切片四：多轮、收敛与命中上限

- [x] 4.1 `resolveAutoLoopHitCap` 命中上限 `min(12, max(3, floor(总段数 × 0.35)))` + 按 severity / index 排序截断为 `deferred`；末轮放开上限清掉可定位条目
  - 测试：`chapter-auto-loop.util.test.ts` 覆盖 10 段 9 条只命中 3，其余 deferred；`chapter-auto-loop.engine.test.ts` 覆盖末轮豁免
- [x] 4.2 `shouldContinueAutoLoop` 收敛判定：无 `high` 即 `converged` 停；轮数上限硬上界
  - 测试：同上文件，覆盖「无 high 提前停」「有 high 但到上限也停」
- [x] 4.3 多轮编排：第 2 轮起复诊输入为上一轮成稿，并注入原始 instruction + 上一轮条目最终状态
  - 测试：`chapter-auto-loop.engine.test.ts` 断言第 2 轮复诊入参为第 1 轮成稿
- [x] 4.4 前端轮数上限控件 1～5，默认 2，localStorage 记忆
  - 测试：`writingOptimizeMultiPass.test.ts`（或新增 prefs 测试）覆盖默认值与 clamp

## 5. 切片五：条目实时可见与停止收稿

- [x] 5.1 复诊结束即推 `loop_plan_items`，逐条处理后推 `loop_item_status`
  - 测试：`chapter-auto-loop.engine.test.ts` 断言条目先于改写事件到达
- [x] 5.2 前端条目面板实时渲染 + 状态回填；「停在当前轮并收下」按钮 abort SSE 并进入 diff，保留最近完成轮成稿
  - 测试：`chapterAutoLoopItems.test.ts` 断言停止后成稿为最近完成轮而非入库原文
- [x] 5.3 接入 `useAiTaskProgress` 活动条与中断句柄，taskKey 文案映射
  - 测试：`useAiTaskProgress` 相关测试含 auto-loop taskKey 文案

## 6. 切片六：会话恢复

- [x] 6.1 进程内 session store（key `projectId:chapterNo:userId`，TTL 4h），存各轮条目 / 成稿 / 基线 `updatedAt`
  - 测试：`chapter-auto-loop-session.store.test.ts` 覆盖写入、读取、TTL 过期
- [x] 6.2 前端打开弹窗时尝试恢复；过期或不存在时静默退回全新开始
  - 测试：`chapterAutoLoopItems.test.ts`（或新增）断言空会话不报错且呈现可全新开始

## 7. 回归与门禁

- [x] 7.1 `from-plan` / `direct` 行为零变更；`chapter.optimize.loop.*` 落入「文笔优化」分组；`loop.draft` 进风格样本白名单、`loop.plan` 不进
  - 测试：`taskPromptGroups.test.ts` + `packages/config/src/writing-style-samples/injection.test.ts`
- [x] 7.2 自检门禁：`pnpm -r lint` / `typecheck` / `test` / `build` 全绿

## 8. 失败后续跑

- [x] 8.1 复诊 JSON 单条脏字段不得整轮判死：漏引号 id 可修回；外层解不开时按单条捞合法条目
  - 测试：`chapter-auto-loop.util.test.ts`
- [x] 8.2 引擎在 `plan_parse_failed` / 改写中断时留下 resume 断点；`resume: true` 从复诊或剩余段落继续
  - 测试：`chapter-auto-loop.engine.test.ts`
- [x] 8.3 OpenAPI `ChapterAutoLoopRequest.resume` 与 session 可续跑字段；前端失败态提供「从失败处继续」
  - 测试：`chapterAutoLoopItems.test.ts` 断言续跑文案与会话恢复
- [x] 8.4 `resume: true` 无可续跑会话时拒绝（400 语义），不静默当成全新开始
  - 测试：`chapter-auto-loop.service.test.ts` 断言抛出 BadRequestException

## 9. 整段删除抽槽

- [x] 9.1 命中段全部条目为整段/整句删除时，抽掉槽位使邻段衔接，不调用改写 LLM，不把空输出当成生成失败
  - 测试：`chapter-auto-loop.util.test.ts` 判定与拼回；`chapter-auto-loop.engine.test.ts` 断言未调用 rewrite
- [x] 9.2 条目状态 `deleted`；前端文案「已删除」
  - 测试：`chapterAutoLoopItems.test.ts`