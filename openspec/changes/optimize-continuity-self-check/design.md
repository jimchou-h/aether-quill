## Context

方案改写（`chapter.optimize.plan` → `chapter.optimize.draft`）会整章重写。作者已在方案 prompt 中加入情节点清单、场景状态、指代依赖，但成稿后仍缺自动对照验收。自动循环已有「冻结验收 → reviewGaps 再改一刀」；按场成稿有 pose/vocab review。本变更把「连续性尺子」接到 from-plan 主路径，并允许作者对漏网问题点名修复。

约束：Contract First（OpenAPI）；不默认 apply；自动 refine 最多 1 次，避免整章反复重写把合理段落改坏。

## Goals / Non-Goals

**Goals:**

- from-plan 成稿结束后默认连续性自检，再展示终稿。
- 有实质缺口时最多自动 refine 一刀（注入缺口说明，非整章盲写新方案）。
- 作者可标记残留问题并触发定向修复。
- 自检只查连续性/空间/指代/逐字锁，不审文笔偏好。

**Non-Goals:**

- 不强制方案输出严格 JSON（首期用方案全文作合同）。
- 不改按场成稿「禁止另起剧情」产品定位。
- 不解决 diffChars 性能（独立议题）。

## Decisions

1. **专用 task：`chapter.optimize.continuity-review`**  
   - 相对冻结验收：尺子明确为情节点/场景状态/指代/逐字锁/换场。  
   - 相对按场 review：面向整章 from-plan 成稿，不全盘复用 workbench kind。  
   - 输出结构化文本或 JSON（`items[]` + `summary`），无问题返回空列表 / CLOSED。

2. **编排落在 API（与现有 optimize 流一致）**  
   - 成稿 SSE 结束后：调用 continuity-review（可非流式纯文本）→ 若有缺口则带 `reviewGaps` 再跑一刀 draft refine（复用现有 from-plan refine / reviewGaps 注入）。  
   - 前端也可编排（类似 auto-loop），但首期优先 API 或前端编排与 auto-loop 对齐，减少双端分叉；选定：**前端编排**（与 `ChapterOptimizeDialog` 冻结验收一致），便于展示阶段文案与取消。

3. **自动修 = refine 一刀，不是 fix-span 批量**  
   - 首期：缺口汇总 → 一次 from-plan refine（`sourceText=成稿`，`reviewGaps=自检说明`）。  
   - 作者点名修复：可走选区 fix-span 或「按批注再 refine」；首期实现「批注文本 → 再 refine / 局部指令」中成本更低的一种（优先批注 + refine；选区修复可复用 workbench fix-span 若已有 UI 钩子）。

4. **作者体验**  
   - 阶段：成稿中 → 自检中 →（可选）自动修订中 → 展示终稿 + 自检摘要。  
   - 应用按钮仍只作用于当前展示的终稿。  
   - 自检无缺口：直接展示成稿，摘要显示「连续性自检通过」。

5. **OpenAPI**  
   - 新增 `POST .../optimize/continuity-review`（请求：planText、draftText、chapterNo；响应：items/hasGaps/reviewText）。  
   - 点名修复可复用现有 draft（带 instruction/reviewGaps）或后续加轻量 endpoint；首期复用 draft + 批注作为 reviewGaps。

## Risks / Trade-offs

- **[Risk] 自检假阳性 → 误 refine 改坏好段落** → Mitigation：自动 refine 上限 1；摘要展示改动原因；作者可回退到自检前成稿（前端保留 `draftBeforeRefine`）。  
- **[Risk] 方案无清单时自检空转** → Mitigation：无清单时降级为「姿势/换场/悬空指代」通用检查，并提示方案缺少第 5/6/7 节。  
- **[Risk] 多一次 LLM 成本与耗时** → Mitigation：utility 档位；CLOSED 则跳过 refine。  
- **[Trade-off] 前端编排 vs 后端一键** → 选前端编排以对齐 auto-loop UX；后续可收拢到后端。

## Migration Plan

- 仅行为增量；无 DB migration。  
- 发布 task 默认 prompt 后，旧项目未发布副本时走仓库默认。  
- 回滚：关闭前端自动自检开关或忽略新 endpoint。

## Open Questions

- 点名修复首期用「批注 + refine」还是必须上选区高亮 fix-span？（默认：批注 + refine，选区为增强。）
