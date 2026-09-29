## Context

作者主路径在 Vue 前端；本地已有 `pnpm dev`。仓库无 Playwright。共识：先巡检清单，再修 P0/P1；代码去重只跟清单。

## Goals / Non-Goals

**Goals:**
- 最小 Playwright smoke（本地脚本，不进 CI）
- 双视口巡检 + 轻量 AI（第 2 章 plan + 短范围 workbench draft）
- 产出分级清单并修复 P0/P1（含有证据的卡顿）

**Non-Goals:**
- 完整 e2e / CI / 视觉基线
- 整章 direct / auto-loop
- 全仓重构与注释运动
- OpenAPI 变更

## Decisions

1. **Playwright 落点：`apps/web/e2e/` + `@playwright/test`（web 包 devDep）**  
   - 备选：根目录 e2e → 否决（离前端源码远）  
   - 不进 CI：避免密钥与 flaky 阻塞合并

2. **认证：环境变量 `E2E_EMAIL` / `E2E_PASSWORD`，可选 `E2E_BASE_URL`（默认 Vite `http://127.0.0.1:5173`）**  
   - 用 `storageState` 缓存登录，减少重复登录

3. **巡检产物：`openspec/changes/author-path-ux-polish/audit-findings.md`**  
   - 每条含：页面、视口、严重度、复现、建议修复点  
   - tasks.md 在清单出来后勾选/追加具体修复项

4. **性能探针：Playwright + 可选 CDP Performance/长任务观察**  
   - 只修「打开弹窗卡、流式掉帧、列表滚动明显卡」且能复现的点  
   - 优先前端：节流 SSE 更新、大文本 v-html/diff、避免整树重渲染

5. **AI 轻跑成本控制**  
   - 第 2 章（~6500 字）只跑 plan  
   - 按场成稿框选 300–800 字 draft  
   - 若未复现再考虑整章 direct（非本轮默认）

## Risks / Trade-offs

- [Risk] 无 E2E 凭据无法巡检 → Mitigation：启动前检查 env，缺失则阻断并提示  
- [Risk] 旧 `dist` serve（如 :5555）与 vite 混用导致看错构建 → Mitigation：smoke 默认只打 Vite 5173  
- [Risk] AI 调用 flaky → Mitigation：AI 步骤可 `test.skip` 当无密钥/超时；样式巡检与 AI 步骤分离  
- [Trade-off] 不进 CI → 回归靠本地脚本；接受

## Migration Plan

1. 安装 Playwright + chromium  
2. 写 smoke（登录、导航、开弹窗、可选 AI）  
3. 跑双视口，写 audit-findings  
4. 修 P0/P1，更新 tasks  
5. 归档前再跑一遍 smoke

## Open Questions

- 用户需提供可用的 `E2E_EMAIL` / `E2E_PASSWORD`（进程 env 或本地未提交文件）  
- 目标项目 ID：若列表有多项，默认进第一个含第 2 章的项目；可用 `E2E_PROJECT_ID` 覆盖
