## MODIFIED Requirements

### Requirement: 收敛提前退出

本轮复诊无 `severity=high` 条目且诊断完整（`discardedCount=0`）时，循环 MUST 提前结束并标记 `converged`。仅有 medium / low 不得续跑。轮数上限仍是硬上界。

#### Scenario: No high items converges

- **WHEN** 本轮解析完整且没有任何 high 条目
- **THEN** `loop_round_end.converged` MUST 为 true，MUST NOT 再开下一轮
