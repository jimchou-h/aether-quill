## Why

`global-model-provider-settings` 已把模型迁到顶栏全局设置，但仍存在「env 兜底模型 / 温度」与「前端设置」双源心智；用户容易以为改 `.env` 的 `PROVIDER_MODEL` 与 UI 等效。需要**只保留前端设置页作为模型配置入口**，代码内置明确默认值，精简 `.env.example`。另：AI 调用失败时常只看到裸 `400`，缺少可读原因（缺 key、模型不存在、厂商拒绝等），需在调用链路把原因透传到前端。

## What Changes

- 生成偏好**唯一用户入口**：顶栏账户设置页（不再引导用户依赖 `PROVIDER_MODEL*` / 温度类 env）
- 默认值统一为 DeepSeek + `deepseek-v4-flash`；**写作/常规温度默认均为 0.7**
- AI 相关接口失败时，向前端返回**可读错误**（缺厂商 key、模型不存在、上游 HTTP 详情等），避免只显示笼统 400
- `.env.example` 去掉已无日常用途的模型/温度兜底字段，仅保留密钥与必要运行参数

## Non-goals

- 仍不在 UI 中录入/存储 API Key
- **不在设置页预先做缺 key 拦截/告警**（缺 key 在实际调用 AI 时提示即可）
- 不删除运行时读取 `DEEPSEEK_API_KEY` / `SILICONFLOW_API_KEY` 的能力
- 不强制迁移已保存的非默认偏好
- 不改 embedding 供应商配置方式

## Capabilities

### New Capabilities

- `generation-settings-single-source`: 前端唯一配置源 + 内置默认 + env 示例精简 + AI 调用可读错误

### Modified Capabilities

- `global-generation-preferences`: 默认值与 `model: null` 语义改为内置 deepseek-v4-flash；温度默认 0.7
- `per-tier-llm-provider`: 缺 key / 上游 400 等错误码与文案可透传到前端

## Impact

- **Frontend**: 账户设置默认展示；Toast/对话框展示服务端可读错误
- **API / orchestrator**: 错误映射（含 `LlmProviderKeyMissing` 与上游 body）；默认常量
- **`.env.example`**: 删除无用模型/温度字段
