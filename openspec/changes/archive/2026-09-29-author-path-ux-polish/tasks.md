## 1. Playwright 最小接入

- [x] 1.1 在 `apps/web` 添加 `@playwright/test`、配置与 `e2e:smoke` 脚本（不进 CI）
- [x] 1.2 实现登录 storageState + 主路径导航 smoke（双视口）；缺凭据时明确失败
- [x] 1.3 扩展 smoke：打开文笔优化 / 按场成稿弹窗；可选轻量 AI（plan + 短范围 draft）→ `e2e/author-path.audit.spec.ts`

## 2. 巡检清单

- [x] 2.1 跑双视口 smoke/巡检，写入 `audit-findings.md`（P0/P1/P2）
- [x] 2.2 将 P0/P1 条目回填为本文件第 3 节可勾选修复任务

## 3. P0/P1 修复

- [x] 3.1 P1：关闭/切换章节 AI Dialog 时 dismiss 页面级 completed 进度条，避免串台
- [x] 3.2 P1：章节操作条降噪（「生成摘要」改为 secondary；actions 已 flex-wrap）
- [x] 3.3 P1：按场成稿无成稿时「应用整章」用 secondary 样式
- [x] 3.4 P1：章节 Tab 标题与「第 N 章」去重显示
- [x] 3.5 回归：单元测 + web typecheck；指定项目 `1779122988480` desktop smoke/audit 已通过

## 4. 备注

- 长章卡顿：项目 `1779122988480` 已复跑；最长章为第 61 章（~2.1 万字），plan ~44s / 按场成稿打开 ~444ms。若要钉第 2 章可加 `E2E_CHAPTER_NO`。
