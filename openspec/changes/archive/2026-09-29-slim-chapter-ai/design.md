## Context

章节 AI 目前存在两套并行栈：

- **保留栈**：文笔优化（plan / direct / auto-loop）+ 按场成稿 workbench
- **砍除栈**：创作精修 pipeline、终稿合规、一键终稿、批量精修、独立 typo

砍除栈与保留栈在 UI/路由层基本独立，但自动循环实现上复用了：

- `chapter-pipeline-orchestrator.client` 的 `streamPipelineGeneration` / `generatePipelinePlainText`
- `findLatestPipelineSessionForChapter`（仅作人物名 fallback）
- `buildCompliancePersonaBlock`（人物卡注入块）

约束：Contract First；一次竖切可 revert；不得打断自动循环与按场成稿。

## Goals / Non-Goals

**Goals:**

- 产品面与 API 合同上只剩保留栈
- 砍除栈前后端、OpenAPI、仓库默认 prompt 登记一并移除
- 自动循环所需共享 helper 迁到中性命名模块（或最小保留实现），行为不变

**Non-Goals:**

- 不重写文笔优化 / 按场成稿交互
- 不把 typo 做成第五个产品入口
- 不在本 change 做全仓架构重构

## Decisions

1. **竖切一次删除砍除栈（FE + API + OpenAPI + prompt 默认）**  
   - 备选：先藏 UI 再删 API → 半吊子状态更久，收益低  
   - 选定：与主路径耦合弱，一次竖切 + 单 commit 便于 revert

2. **共享 SSE helper 先抽后删**  
   - 将 `streamPipelineGeneration` / `generatePipelinePlainText` 迁到中性文件（如 `chapter-generation-stream.client.ts`），auto-loop 改 import  
   - 删除 `ChapterPipelineService`、pipeline session 产品存储与 `/pipeline/*` 路由  
   - `findLatestPipelineSessionForChapter` fallback：改为仅用请求名/正文推断（去掉对 pipeline session 的依赖），避免为 fallback 保留整棵 session store

3. **`buildCompliancePersonaBlock` 降级保留**  
   - 函数迁到中性 util（如 `chapter-persona-prompt.util.ts`）或留在被精简后的模块并改名  
   - 删除合规会话/大纲/改写产品路径，但保留人物块构建给 auto-loop

4. **`content-safety.pipeline.ts` 保留**  
   - 与章节精修产品无关的内容安全扫描继续服务其它路径

5. **仓库默认 prompt**  
   - 从 api / rag-orchestrator / prompt-templates 去掉 pipeline、compliance、typo 默认登记  
   - 本地已发布副本不迁移、不删除

## Risks / Trade-offs

- [Risk] 漏改 auto-loop import 导致编译/运行失败 → Mitigation：先迁共享 helper 与人物块，再删服务；跑 auto-loop / workbench 相关单测  
- [Risk] OpenAPI 与前端 client 不同步 → Mitigation：先改 openapi 再改 client/controller  
- [Risk] Settings 残留 pipeline 开关造成幽灵 UI → Mitigation：去掉 `ProjectPipelinePreferences` 入口与相关绑定  
- [Trade-off] 失去专用 typo/合规产品 → 接受；用自动循环指令覆盖校对类需求

## Migration Plan

1. 更新 OpenAPI（删除砍除路径）  
2. 抽取共享 helper + 调整 auto-loop 依赖  
3. 删除前端入口与 Dialog、后端服务/路由、prompt 默认  
4. 单测与 typecheck 绿  
5. 回滚：`git revert` 本 change 对应 commit

## Open Questions

无（grilling 已对齐：硬砍、保留四入口、竖切第一刀）。
