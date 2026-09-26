## ADDED Requirements

### Requirement: From-plan run is a closed sequence

方案改写 MUST 按固定顺序执行：生成方案一次（长章可分段扫描后统筹）、作者确认或按意见修改方案、生成正文一次、冻结验收、若有实质缺口则再改写一次、然后停止。系统 MUST NOT 在同一次正文闭环里再生成新方案。

#### Scenario: Closed draft run after confirmed plan

- **WHEN** 作者在方案改写中确认当前方案并开始生成正文
- **THEN** 系统 MUST 先按方案写一稿，再做冻结验收；无实质缺口则停在对比页，有实质缺口则仅再写一刀后停

### Requirement: Frozen review only checks the locked contract

冻结验收 MUST 对照用户优化要求、本轮已确认方案、以及项目 systemPrompt。验收 MUST NOT 提出合同之外的新润色愿望，MUST NOT 输出新正文或新方案。结论标记 MUST 为 `【验收结论】CLOSED` 或 `【验收结论】GAPS`。

#### Scenario: No material gaps stops the run

- **WHEN** 验收输出含 `【验收结论】CLOSED` 且不含 `【验收结论】GAPS`
- **THEN** 系统 MUST NOT 再生成正文，并告知本轮已收口

#### Scenario: Material gaps trigger one refine pass

- **WHEN** 验收输出含 `【验收结论】GAPS`
- **THEN** 系统 MUST 以上一稿为 `sourceText`、以缺口说明为 `reviewGaps` 再请求一次 from-plan draft，完成后 MUST 停止

### Requirement: Review API is a dedicated SSE

系统 MUST 提供 `POST /api/projects/{id}/knowledge/chapters/{chapterNo}/optimize/review` SSE。请求 MUST 包含 `instruction`、`planText`、`draftText`。结束事件 MUST 带回 `reviewText` 与 `hasMaterialGaps`。

#### Scenario: Review end event carries verdict

- **WHEN** 冻结验收成功结束
- **THEN** SSE `end` MUST 包含解析后的 `hasMaterialGaps` 与完整 `reviewText`

### Requirement: Second knife uses previous draft and gap list

from-plan draft 在存在 `sourceText` 时 MUST 以该稿为改写底本。存在 `reviewGaps` 时 MUST 注入缺口说明，并约束只补这些实质缺口。长章分段 MUST 切 `sourceText` 而不是入库原文。质量校验仍 MUST 对照入库原文。

#### Scenario: Segmented refine splits the previous draft

- **WHEN** 上一稿超过项目分段字数且带 `sourceText` 与 `reviewGaps`
- **THEN** 各段 `<segment-original>` MUST 来自上一稿对应片段，prompt MUST 含缺口说明
