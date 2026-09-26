## REMOVED Requirements

### Requirement: Plan and draft pass counts

**Reason**: 开放轮次会让方案改写一直发明新愿望，与固定闭环冲突。

**Migration**: 方案改写改为 `from-plan-closed-run`：方案一次、正文一次、冻结验收、最多再一刀。

### Requirement: Plan multi-pass refine

**Reason**: 系统自动连跑方案会重新开卷，不再作为方案改写默认行为。

**Migration**: 作者仍可用「按意见修改方案」人工转向；系统不再按次数自动收紧方案。

### Requirement: Auto-start draft after plan passes

**Reason**: 自动开写服务于多轮方案，闭环在作者确认方案后开始。

**Migration**: 去掉该开关。确认方案后点「按方案改写并收口」进入闭环。

## MODIFIED Requirements

### Requirement: Draft multi-pass with previous draft as source

正文第 1 轮 MUST 以入库章节正文为 `<chapter-original>`。冻结验收判定有实质缺口时，唯一的第 2 轮 MUST 以上一轮成功正文为 `sourceText`，并注入 `reviewGaps`。对比区左侧与字数/删减校验 MUST 仍对入库原文。失败或中断 MUST 保留上一轮成功正文。系统 MUST NOT 再提供作者可调的正文次数 1～3。

#### Scenario: Second draft pass uses previous draft as chapter-original

- **WHEN** 冻结验收判定有实质缺口
- **THEN** 第 2 轮 draft 请求 MUST 带非空 `sourceText` 为第 1 轮正文，并带 `reviewGaps`

#### Scenario: Quality gate still uses stored chapter

- **WHEN** 第 2 轮合并正文相对入库原文过短且方案未允许删减
- **THEN** 质量校验 MUST 失败，不得因 `sourceText` 改成对上一稿比长度而放行
