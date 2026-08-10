## 1. Contract & user preferences API

- [x] 1.1 OpenAPI + shared-types：用户全局生成偏好 schema（writing/utility：provider + model；writing + utility temperature）与 GET/PUT 路径
- [x] 1.2 API 持久化（User preferences JSON 或等价表）+ 单测：读写与默认空
- [x] 1.3 错误码：厂商未配置密钥（`LlmProviderKeyMissing` 1340）

## 2. Per-tier provider routing

- [x] 2.1 `resolveGenerationCallProfile`（或等价）输出 provider；按 tier 解析 URL/Key 与温度（config 层已完成；orchestrator 接线进行中）
- [x] 2.2 rag-orchestrator 生成调用按 profile.provider 路由；单测覆盖「双厂商」与「缺 key」
- [x] 2.3 API→orchestrator 上下文注入用户全局偏好（优先级：env → user → request）

## 3. Global settings UI

- [x] 3.1 `App.vue` 顶栏右侧设置按钮 → 全局设置路由/页
- [x] 3.2 全局设置页：写作/常规各自厂商+模型、写作温度与常规温度；建议列表按厂商过滤；保存调用用户偏好 API
- [x] 3.3 项目 `ProjectGenerationPreferences` 移除（或停用）写作/常规模型与温度编辑，避免双源

## 4. Verify

- [x] 4.1 相关 lint/typecheck/test；手测：常规 DeepSeek + 写作 SiliconFlow（在双 key 环境）或注明环境限制
  - config / auth / orchestrator routing 单测已绿；web+api typecheck 通过
  - 双厂商手测依赖本地同时配置 `DEEPSEEK_API_KEY` + `SILICONFLOW_API_KEY`（未在本机完成端到端手测）
