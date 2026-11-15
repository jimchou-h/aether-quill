# auto-loop-gap-only-diagnose Specification

## Purpose
TBD - created by archiving change stop-auto-loop-open-polish. Update Purpose after archive.
## Requirements
### Requirement: Diagnose concrete errors and user priorities

自动循环复诊 MUST 逐段主动检查有文本依据的基础语言、指代、动作状态、设定和视角错误，并检查用户指定重点与上一轮未修/新引入问题。用户清单 MUST NOT 作为检查范围上限；有明确依据的普通错误也可进入 high 修复队列。MUST NOT 把项目文风或「还能更贴要求」自动拆成主观润色项。

#### Scenario: User did not name a basic error

- **WHEN** 用户只强调某项检查，但当前正文还存在其他基础错误
- **THEN** 默认及真实组装输入 MUST 允许主动检查该错误，不得以仅两类或仅清单规则排除

#### Scenario: Only subjective polish remains

- **WHEN** 基础错误、用户明确要求和上轮改坏均已解决，仅剩可改可不改的文风偏好
- **THEN** 复诊 MUST 返回 `{"items":[]}`，不得重复已解决条目或另开润色愿望

#### Scenario: Published task overrides warehouse default

- **WHEN** 当前项目发布稿仍为旧的只查清单文本
- **THEN** 本次修复 MUST 通过已有设置流程同步该目标项目并记录回滚点，不能以默认种子已改宣称当前项目已生效

### Requirement: Convergence ignores medium polish

`shouldContinueAutoLoop` MUST 仅在存在 `severity=high`（或诊断未读完）时继续。仅有 medium / low 且诊断完整时 MUST `converged=true`。

#### Scenario: Medium-only round stops

- **WHEN** 本轮条目只有 medium 和 low，且 `discardedCount=0`，轮数未用尽
- **THEN** 循环 MUST 判定收敛并停止

