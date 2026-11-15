## MODIFIED Requirements

### Requirement: Convergence and early exit

方案每一条目 MUST 带 `severity`，取值 `high` / `medium` / `low`；`severity` 解析 MUST 容忍常见中文档位与大小写差异，未知或缺省档位 MUST 归一化为 `medium`，MUST NOT 仅因 severity 无法识别而丢弃条目。当某轮复诊未产出任何 `high` 条目**且该轮无任何条目被丢弃**时，系统 MUST NOT 再进入下一轮，并 MUST 标记 `converged`——仅剩 `medium` / `low` 或空条目即收工（复诊 prompt 约定确认需修正的条目一律标 `high`，不以 medium/low 收纳润色愿望）。轮数上限 MUST 始终作为硬上界生效，即使仍有 `high` 条目也 MUST 停止。

#### Scenario: Only low severity items ends the loop early

- **WHEN** 轮数上限为 3，第 2 轮复诊只产出 `low` 条目
- **THEN** 系统 MUST NOT 发起第 3 轮，`converged` MUST 为 true

#### Scenario: Medium-only items end the loop

- **WHEN** 轮数上限为 3，第 1 轮复诊只产出 `medium` 条目且无条目被丢弃
- **THEN** 系统 MUST NOT 发起第 2 轮，`converged` MUST 为 true

#### Scenario: Budget caps an unconverged loop

- **WHEN** 轮数上限为 2，第 2 轮仍产出 `high` 条目
- **THEN** 系统 MUST 在第 2 轮结束后停止，`converged` MUST 为 false

#### Scenario: Discarded items block a convergence claim

- **WHEN** 某轮有条目因结构不合法被丢弃，且存活条目中没有 `high`
- **THEN** 系统 MUST NOT 标记 `converged`，因为被丢弃的条目可能正是 `high`；循环 MUST 在轮数预算内继续

#### Scenario: Every item discarded is a contract failure, not convergence

- **WHEN** 某轮复诊输出可解析为 JSON，但其中每一条目都因缺少定位信息或可执行指令而被丢弃
- **THEN** 系统 MUST 以 `plan_parse_failed` 终止并保留当前稿，MUST NOT 标记 `converged`，且 MUST NOT 向用户显示"未发现严重问题"