## Context

现状：三项在 `ProjectSettings`（`generationWritingModel` / `generationUtilityModel` / `generationTemperature`）。Orchestrator 用 `resolveGenerationCallProfile` 选 model/temp，但 `resolveProviderConfig()` **全局单一** DeepSeek 或 SiliconFlow。用户要的是：(1) 全局入口；(2) 写作/常规分厂商。

## Goals / Non-Goals

**Goals:**

- 用户级全局偏好 + 顶栏设置入口
- writing / utility 各自 `provider` + `model`；utility 与 writing 均有温度（写作温度一并迁入全局）
- 调用时按 tier 选对应厂商的 base URL + API key（env 已配则可通）
- Contract First 全链路

**Non-Goals:**

- UI 管理密钥
- 项目级继续作为主编辑入口（首期全局覆盖优先；项目字段只读兼容或忽略）

## Decisions

### D1 — 存储：用户级 JSON 偏好

- **选择**：在 User（或独立 `user_preferences`）存：

```ts
{
  writing: {
    provider: 'deepseek' | 'siliconflow';
    model: string | null;
    temperature: number | null; // null = env PROVIDER_TEMPERATURE_WRITING
  };
  utility: {
    provider: 'deepseek' | 'siliconflow';
    model: string | null;
    temperature: number; // 工具级，默认 0.7
  };
}
```

`model: null` = 该厂商/档位 env 默认（`PROVIDER_MODEL_WRITING` 等）。  
**已确认**：写作温度一并迁入全局（不再留在项目设置为主编辑源）。

- **备选**：纯 localStorage — 无法服务端生成使用，否决。纯 env — 无 UI，否决。

### D2 — 优先级

`env 默认 → 用户全局偏好 → 请求级覆盖`  
首期**忽略**项目级三字段写入（读路径可暂作迁移兜底一次）；项目设置 UI 移除编辑以免双源。

### D3 — 顶栏入口

`App.vue` `header-right`：设置按钮 → `/account/settings`（或 `/global-settings`），登录后可见。页面只含全局生成偏好（可后续扩展）。

### D4 — 分厂商路由

- Env 保持 `DEEPSEEK_API_KEY` + SiliconFlow key + 可选 `PROVIDER_API_URL`
- 解析表：`deepseek` → DeepSeek chat URL + key；`siliconflow` → SiliconFlow URL + key
- `ResolvedGenerationCallProfile` 增加 `provider`
- `generation.service` 按 profile.provider 取 URL/Key，不再「全进程一个 provider」
- 缺 key 时返回明确错误（可配置厂商但未配密钥）

### D5 — 竖切顺序

1. API 合同 + 用户偏好 CRUD + 空 UI 页/顶栏入口（可读可写，暂不改路由）
2. Orchestrator per-tier provider 路由 + 测试
3. 生成代理合并用户偏好；项目设置移除三项；端到端自检

## Risks / Trade-offs

- [双源残留] → UI 移除项目三项；文档写明以全局为准
- [只配一个厂商 key] → 选未配置厂商时明确报错，不静默打到错误 endpoint
- [旧项目字段] → 首次打开全局设置可预填自「当前项目」可选，非自动覆盖全部用户

## Migration Plan

1. 上线用户偏好 API（默认空 = 全走 env）
2. UI 迁出；项目页隐藏三项
3. Orchestrator 按 provider 路由
4. 回滚：恢复项目字段 UI + 单一 resolveProviderConfig

## Open Questions

- （已关闭）写作温度一并迁入全局
- 全局设置是否仅登录用户？**是**
