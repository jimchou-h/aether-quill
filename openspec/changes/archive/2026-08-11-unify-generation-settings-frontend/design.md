## Context

上一 change 已落地用户级全局偏好 + 分厂商路由。残留问题：

1. `PROVIDER_MODEL` 等仍作兜底，与 UI 形成双入口
2. 默认 `model: null` → 回退到可能不兼容的 env 短名
3. AI 调用失败时前端常只看到 `400`，不知道是缺 key、模型 id 错误还是上游拒绝
4. `.env.example` 仍列出大量可删的模型/温度变量

## Goals / Non-Goals

**Goals**

- 用户只通过前端全局设置页管理厂商/模型/温度
- 代码默认：`provider=deepseek`，`model=deepseek-v4-flash`，**temperature=0.7**（写作与常规）
- AI 调用失败时返回可读中文原因（含缺 key、上游 message）
- `.env.example` 只留密钥 + 确需的运行参数

**Non-Goals**

- UI 管密钥；设置页预先缺 key 告警；改 embedding 配置 UX

## Decisions

### D1 — 单一配置源

- **用户可见**：仅账户设置「全局模型设置」
- **Env**：只提供厂商 Key（及可选 URL / `PROVIDER_MAX_TOKENS`）
- **不再**把 `PROVIDER_MODEL*`、`PROVIDER_TEMPERATURE*` 当作产品配置面

### D2 — 内置默认

```ts
DEFAULT: {
  writing: { provider: 'deepseek', model: 'deepseek-v4-flash', temperature: 0.7 },
  utility: { provider: 'deepseek', model: 'deepseek-v4-flash', temperature: 0.7 },
}
```

- 新用户 / 空偏好：直接返回上述默认（不再 `model: null` 表示 env）
- 已保存偏好：原样返回
- 读出时若 `model: null`：物化为 `deepseek-v4-flash`；写作 `temperature: null`：物化为 `0.7`

### D3 — 调用时可读错误（非设置页预检）

- **不在**设置页根据 `providersConfigured` 预先告警（用户已明确：调用 AI 时再提示）
- Orchestrator / API 在缺 key、上游 4xx 时：
  - 映射明确错误码（已有 `LlmProviderKeyMissing` 1340 等）
  - `message` 含厂商、model、上游原文摘要（例如「Model does not exist」）
- 前端对 AI/SSE 错误统一展示该 `message`，避免只显示「Request failed with status code 400」

### D4 — .env.example 精简

删除示例中的：`PROVIDER_MODEL*`、`PROVIDER_TEMPERATURE*`、`PROVIDER_FREQUENCY_PENALTY_WRITING`、遗留跨厂商 `PROVIDER_API_URL`  
保留：`DEEPSEEK_API_KEY`、`SILICONFLOW_API_KEY`、`SILICONFLOW_API_BASE`、`PROVIDER_MAX_TOKENS`（若仍读取）

## Risks

- 老部署依赖 env 模型：升级后改走内置默认，需提示在全局设置确认
- 需核对 DeepSeek 官方是否提供 `deepseek-v4-flash` 这一 model id

## Migration

- 无强制 DB 迁移；默认常量 + 读出物化即可

