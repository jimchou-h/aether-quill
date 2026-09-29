## Why

作者主路径（登录 → 项目 → 章节 → 设置，含文笔优化 / 按场成稿）在砍除精修栈后仍有样式、弹窗体验与流式交互卡顿问题，但缺少可复跑的巡检与明确修复边界。需要先清单后修，避免无目标全站美化。

## What Changes

- 为作者主路径接入**最小 Playwright smoke**（本地可跑，暂不进 CI）
- 在 `1440×900` 与 `768×1024` 下巡检主路径，产出 P0/P1/P2 问题清单
- 轻量 AI：第 2 章文笔优化 **plan** + 按场成稿短范围 **draft**，复现流式卡顿
- 修复 **P0 + P1**（布局/可点性/弹窗体验/有证据的卡顿）；P2 只列清单
- 代码去重与注释仅跟随清单相关改动（不写废话注释、不做无关重构）

## Non-goals

- 不接入完整 e2e CI / 视觉回归基线
- 不跑整章 direct 出稿或 auto-loop
- 不做全仓重复扫描或注释规范大补
- 不改 OpenAPI / 错误码 / 后端合同（除非巡检发现合同缺陷并另立条目）

## Capabilities

### New Capabilities

- `author-path-ux-smoke`: 作者主路径 Playwright smoke、巡检清单与 P0/P1 体验/性能修复边界

### Modified Capabilities

- （无）既有 `chapter-ai-surface` 产品面不改需求，仅打磨实现体验

## Impact

- `apps/web`：页面/弹窗样式与渲染性能；新增 Playwright 最小配置与脚本
- 依赖：`@playwright/test`（devDependency）；本地 `E2E_EMAIL` / `E2E_PASSWORD`
- OpenAPI / error-code：**无影响**（本 change 不改合同）
- 需本地 `pnpm dev`（或等价）与可用项目数据（含第 2 章）
