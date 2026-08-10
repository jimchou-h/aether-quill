## Why

写作模型 / 常规模型 / 常规温度今天埋在**项目设置**里，跨项目要重复配；且运行时只有**一套**厂商 URL/Key，无法真正做到「常规用 DeepSeek、写作用硅基流动」。需要提升为全局（用户级）配置，并支持按档位选择厂商。

## What Changes

- 将「写作模型」「常规模型」「常规温度（工具级）」「写作温度」迁到**全局设置**（用户偏好），顶栏右侧增加设置入口进入
- 写作档与常规档各自可选厂商（至少 DeepSeek / SiliconFlow）+ 对应模型
- 生成解析链支持 per-tier provider（凭证仍来自已配置的 env keys）
- 项目设置页移除或降级上述字段编辑（避免双源；首期以全局为准）
- Contract First：新用户偏好 API + OpenAPI；orchestrator context / profile 扩展

## Non-goals

- 不在 UI 里让用户粘贴/保存 API Key（密钥仍 env）
- 不一次重写全部生成链路到 ProviderManager（可渐进；本 change 至少打通 per-tier URL/Key 路由）
- 不改 embedding 供应商选型（除非共用解析 helper）
- 不强制迁移历史项目字段（可一次性读取兜底或提示清空）

## Capabilities

### New Capabilities

- `global-generation-preferences`: 用户级全局生成偏好（模型/温度）与顶栏设置入口
- `per-tier-llm-provider`: 写作档与常规档可选择不同 LLM 厂商并正确路由调用

### Modified Capabilities

- （无既有 openspec 主规格直接覆盖项目 generation 字段；项目设置 UI 行为变更在 design 说明）

## Impact

- **Frontend**: `App.vue` 顶栏；新全局设置页/面板；`ProjectGenerationPreferences.vue` 去掉三项
- **API**: 新 `GET/PUT` 用户生成偏好；Auth/User 持久化；推送 orchestrator 时合并偏好
- **rag-orchestrator**: `resolveProviderConfig` / `resolveGenerationCallProfile` 按 tier+provider
- **OpenAPI / shared-types / .env.example / 配置规范文档**: 必更新
- **Error codes**: 可能新增「厂商未配置密钥」类（若尚无则补充）
