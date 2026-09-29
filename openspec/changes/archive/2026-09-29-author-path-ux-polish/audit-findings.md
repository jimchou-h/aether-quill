# Author-path UX audit findings

Date: 2026-09-29  
Env: Vite `127.0.0.1:5173`, `E2E_EMAIL=admin@example.com`  
Viewports: desktop `1440×900`, narrow `768×1024`  
Artifacts: `apps/web/e2e-artifacts/*.png`  
Target project: `E2E_PROJECT_ID=1779122988480`（用户指定；含长章）

## Metrics (light AI, project 1779122988480 / desktop)

| Run | Longest chapter | Plan | Workbench draft | Dialog open |
|-----|-----------------|------|-----------------|-------------|
| 首轮（误进短项目） | ch1 ~695 字 | ~15.7s | ~2.0s | opt 72ms / wb 106ms |
| 指定项目复跑 | **ch61 ~21769 字** | **~44.0s** | ~3.1s (66 chars) | opt 89ms / **wb 444ms** |

溢出探测器未报横向 page overflow。弹窗打开本身不卡；plan 耗时主要是模型。长章下按场成稿打开约 **444ms**（仍可接受，略慢于短章）。

> 说明：脚本按「最长章」选目标；本项目最长为第 61 章，而非第 2 章。若要强制第 2 章，可再加 `E2E_CHAPTER_NO=2`。

## P0

（本次巡检未发现阻断性布局错位 / 不可点 / 明显对比度崩溃）

## P1

1. **章节页 AI 进度条串台** — **已修**（`dismissIdleAiTaskProgress` 在 Dialog 开/关时清理 completed 横幅）  
2. **章节操作条过密** — **部分已修**（「生成摘要」改为 secondary；actions 已 flex-wrap）  
3. **按场成稿未生成前「应用」过抢眼** — **已修**（无成稿时 secondary + disabled）  
4. **章节 Tab 标题重复** — **已修**（`formatChapterTabTitle`）
## P2

1. 登录成功 Toast 叠在项目列表上方较久（`desktop-01-projects.png`）  
2. 章节页黄色「结构化信息」提示条常驻，信息噪音大  
3. 设置页分阶段加载（先空白「正在加载设置…」再出各 panel）  
4. 项目列表测试项目多、卡片操作四按钮同权，扫视成本高（本轮不改数据）  
5. 长章（6500 字）流式卡顿未在本环境复现——缺目标项目数据

## Performance notes

- 优先修 **进度条串台** 与 **按钮层级**（认知卡顿），再谈 SSE 节流。  
- 有长章项目后：用 audit 脚本再跑 plan + 短范围 draft，抓 `content` 更新掉帧再动渲染。
