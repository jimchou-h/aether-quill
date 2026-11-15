## Context

方案改写已有分段扫描 + 整章统筹、以及 multi-pass 的 1～3 轮方案/正文。后者每轮都是开卷找问题，没有停点。作者要的是按项目 prompt 与本轮方案把章节改一档后收口，而不是一直优化。

## Goals / Non-Goals

**Goals:**

- 方案改写变成固定闭环：一方案、一正文、一冻结验收、最多再一刀。
- 验收只对照冻结合同（用户要求 + 本轮方案 + 项目 systemPrompt），不准新开润色愿望。
- 长章第二刀必须切上一稿，不能再切入库原文。

**Non-Goals:**

- 不开第四种模式。
- 不改直接改写 / 自动循环。
- 不追求文学零剩余。

## Decisions

1. **改现有方案改写，不加 Tab。** 再加模式只会让人不知道点哪个。

2. **闭环由前端串现有 SSE + 新 review SSE。** 备选是后端一条超长 SSE 跑完全程。否决原因：方案仍需人工确认或按意见改；中断点更清楚。

3. **验收用独立 `optimize/review`，不用再生成方案。** 方案接口会重新发明愿望。review 带 `systemPromptOverride` 限死输出 `CLOSED` / `GAPS`，并注入项目 systemPrompt；跳过检索以免再打一遍向量库。

4. **第二刀带 `sourceText` + `reviewGaps`。** 同一 draft 模板，缺口说明只补合同未落实处。长章 `splitIntoSegments` 改为切 `sourceText`。

5. **解析失败的保守策略。** 有 `CLOSED` 且无 `GAPS` → 停。有 `GAPS` → 再写。无标记且正文很短 → 停。无标记且说明较长 → 当有缺口，避免假收敛。

6. **人工改方案保留。** 「按意见改方案 / 放弃并重生成」是作者转向，不是系统自己再优化。

## Risks / Trade-offs

- [验收模型仍可能找新愿望] → prompt 硬限 + 只允许一刀补写。
- [长章验收 prompt 含整章新稿，TTFT 偏长] → 走 SSE timeout:0；跳过检索。
- [同一模型自评] → 轮数硬上界 1 次补写，不依赖它宣布完美。

## Migration Plan

- 方案改写不再展示轮次控件；旧 localStorage 偏好忽略即可。
- 回滚：恢复轮次 UI，下线 review 路径。

## Open Questions

- 无。
