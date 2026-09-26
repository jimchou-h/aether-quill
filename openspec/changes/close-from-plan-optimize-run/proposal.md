## Why

方案改写的「方案次数 / 正文次数」是开卷连跑：每一轮都能再发明新愿望，作者永远停不下来。需要把方案改写收成一次冻结合同的闭环——写完对照合同验收，最多再补一刀就停。

## What Changes

- 方案改写固定为：扫描 → 方案 1 次 → 正文 1 次 → 冻结验收 → 最多再改一刀 → 停。
- 去掉方案改写上的方案次数、正文次数、方案完成后自动开写。
- 新增冻结验收：对照用户要求 + 本轮方案 + 项目文风，只判实质未落实或改坏；禁止新开润色愿望。
- 有实质缺口时，用上一稿 + 缺口说明再写一刀；没有则收口。
- Draft 契约增加可选 `reviewGaps`；新增 `optimize/review` SSE。
- 人工「按意见改方案」保留。直接改写、自动循环不改。

## Capabilities

### New Capabilities

- `from-plan-closed-run`: 方案改写的冻结验收与硬停闭环。

### Modified Capabilities

- `writing-optimize-multi-pass`: 方案改写不再暴露 1～3 轮连跑控件；闭环取代开放轮次。

## Non-goals

- 不开第四种改写模式。
- 不改直接改写、自动循环、创作精修、终稿合规。
- 不把「最佳」定义成文学零剩余；收口只认冻结合同无实质缺口。
- 不新增错误码。

## Impact

- OpenAPI：新路径 `POST .../optimize/review`；`ChapterOptimizationDraftRequest.reviewGaps`。
- 错误码：无新增。
- API：review SSE、draft 第二刀注入缺口、长章第二刀按上一稿切段。
- 前端：`ChapterOptimizeDialog` 方案改写固定闭环与文案。
