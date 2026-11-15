# writing-optimize-multi-pass Specification

## Purpose
上一稿作为改写底本的多轮正文契约；现由方案改写冻结闭环消费：唯一第 2 轮以 sourceText + reviewGaps 收紧，对比基线仍为入库原文。
## Requirements
### Requirement: Draft multi-pass with previous draft as source

正文第 1 轮 MUST 以入库章节正文为 `<chapter-original>`。冻结验收判定有实质缺口时，唯一的第 2 轮 MUST 以上一轮成功正文为 `sourceText`，并注入 `reviewGaps`。对比区左侧 MUST 仍为入库原文。失败或中断 MUST 保留上一轮成功正文。系统 MUST NOT 再提供作者可调的正文次数 1～3。

#### Scenario: Second draft pass uses previous draft as chapter-original

- **WHEN** 冻结验收判定有实质缺口
- **THEN** 第 2 轮 draft 请求 MUST 带非空 `sourceText` 为第 1 轮正文，并带 `reviewGaps`

#### Scenario: Comparison baseline stays stored chapter

- **WHEN** 第 2 轮正文生成完成
- **THEN** 对比区左侧 MUST 仍为入库原文，MUST NOT 换成上一稿

