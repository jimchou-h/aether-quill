## ADDED Requirements

### Requirement: Diagnose only misses and regressions

自动循环复诊 MUST 只提出两类条目：用户优化要求明显未落到该段，或上一轮改写改坏 / 新引入偏离。MUST NOT 把项目 systemPrompt 或「还能更贴要求」写成润色条目。没有这两类问题时 MUST 输出空 `items`。

#### Scenario: No material miss or regression yields empty items

- **WHEN** 正文没有明显未落实的用户要求，也没有上轮改坏
- **THEN** 复诊 MUST 返回 `{"items":[]}`，MUST NOT 再出润色项

### Requirement: Convergence ignores medium polish

`shouldContinueAutoLoop` MUST 仅在存在 `severity=high`（或诊断未读完）时继续。仅有 medium / low 且诊断完整时 MUST `converged=true`。

#### Scenario: Medium-only round stops

- **WHEN** 本轮条目只有 medium 和 low，且 `discardedCount=0`，轮数未用尽
- **THEN** 循环 MUST 判定收敛并停止
