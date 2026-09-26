## Context

方案改写已收成冻结合同闭环。自动循环仍按「落实用户要求」开卷找条目，并把 medium 当续跑条件。

## Goals / Non-Goals

**Goals:** 复诊只出漏点与改坏；没有 high 就停。

**Non-Goals:** 不把自动循环改成合规/角色卡专检。

## Decisions

1. **Prompt 改两类白名单，收敛改回只认 high。** 只改 prompt 不够，模型仍会把润色标 medium。
2. **User prompt 追加限定。** 即使 Settings 里还是旧的已发布 `loop.plan`，每轮 user prompt 也会禁止开卷润色。
3. **Diagnose 省略项目 systemPrompt。** 文风圣经不当诊断标准；改写段仍可带上。

## Risks / Trade-offs

- [真·部分未落实被标 medium 会停] → 接受；漏点应标 high。作者可再开一轮。
- [已发布旧 prompt 仍偏落实] → user prompt 限定压住。

## Migration Plan

重启 API。可选：在设置页重新发布 `chapter.optimize.loop.plan`。

## Open Questions

- 无。
