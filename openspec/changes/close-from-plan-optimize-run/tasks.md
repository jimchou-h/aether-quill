## 1. Contract

- [x] 1.1 OpenAPI 增加 `optimize/review` 与 `ChapterOptimizationReviewRequest`；draft 增加 `reviewGaps`
- [x] 1.2 单测：验收解析 `CLOSED` / `GAPS` / 无标记回退

## 2. Review + second knife

- [x] 2.1 util：冻结验收 prompt、draft/segment 注入 `reviewGaps`、长章切 `sourceText`
- [x] 2.2 API：review SSE；draft 透传 `reviewGaps`；单测覆盖注入与切段底本

## 3. Closed UI

- [x] 3.1 方案改写去掉轮次控件；确认方案后走「正文 → 验收 → 最多一刀」
- [x] 3.2 前端文案/阶段标签单测；闭环收口状态可测
