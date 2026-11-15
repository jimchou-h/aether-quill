## Why

原先为避免无限润色，系统将自动循环复诊限制为“用户要求明显未落实”和“上轮改坏”。作者反馈一般错误也只有点名后才被发现。AQ-395 需要恢复主动基础纠错，同时保持可定位、有终点的修正边界。

## What Changes

- 复诊逐段主动检查基础语言、指代、动作状态、设定及视角错误；用户清单是额外重点，不是范围上限。
- 普通但有明确证据的可修错误也报 high；纯主观润色愿望不报，不反复报告已解决问题。
- 同步 API 默认、程序追加范围、编排兜底及新增 v1.0.0 模板治理副本。
- 通过当前设置页仅更新作者项目已发布的 `chapter.optimize.loop.plan`，保留回滚点；其他项目的自定义稿不强制迁移。

## Capabilities

### New Capabilities

- `auto-loop-gap-only-diagnose`: 自动循环定位基础错误、用户要求遗漏及改写回退，限制无目标润色。

### Modified Capabilities

- `chapter-auto-optimize-loop`: 保持仅 high 或诊断不完整时续跑，轮数上限不变。

## Non-goals

- 不改模型、温度、检索、章节切分、定位/删除引擎及其他写作模式。
- 不把文风偏好变成无限润色条目，不恢复 medium/low 续跑。
- 不批量覆盖项目自定义 Prompt，不进行付费模型回归。

## Impact

- OpenAPI / 错误码 / JSON 字段无变更。
- API 复诊种子和输入拼装、orchestrator 默认、模板包治理登记及中性回归。
- 复诊仍省略项目 systemPrompt，人物卡与参考上下文仅用于核实问题。
