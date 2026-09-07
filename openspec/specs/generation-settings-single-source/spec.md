# generation-settings-single-source Specification

## Purpose
写作/常规模型与温度以账户全局设置为唯一日常配置面；内置 DeepSeek flash 默认；AI 调用失败返回可读错误；env 仅保留密钥与运行参数。

## Requirements

### Requirement: Single frontend configuration surface

系统 MUST 将写作/常规的厂商、模型、温度的**用户配置入口**限定为前端全局设置页；MUST NOT 再要求用户通过 `PROVIDER_MODEL*` / `PROVIDER_TEMPERATURE*` 环境变量完成日常模型配置。

#### Scenario: User changes model only in UI

- **WHEN** 用户在账户设置页修改写作或常规模型并保存
- **THEN** 后续生成 MUST 使用所保存偏好，且不依赖 `.env` 中的 `PROVIDER_MODEL` 是否与之一致

### Requirement: Built-in DeepSeek flash defaults

未设置或空偏好时，系统 MUST 默认使用 `provider=deepseek` 与 `model=deepseek-v4-flash`（写作档与常规档均如此）；温度 MUST 默认均为 `0.7`；MUST NOT 再回退到 `PROVIDER_MODEL` / `PROVIDER_TEMPERATURE*`。

#### Scenario: Fresh user opens settings

- **WHEN** 用户首次打开全局模型设置且尚无已存偏好
- **THEN** 表单 MUST 展示 DeepSeek + `deepseek-v4-flash` + 温度 0.7，而非空白「环境默认」

### Requirement: Readable errors on AI API failures

当用户触发依赖 LLM 的接口（含 SSE）失败时，系统 MUST 向客户端返回可读错误信息，说明失败原因类别（例如：未配置对应厂商 API Key、模型不存在、上游拒绝），MUST NOT 仅返回无上下文的 HTTP 400 / 「Request failed with status code 400」。

#### Scenario: Missing SiliconFlow key on generate

- **WHEN** 用户全局偏好选用 siliconflow，但服务端未配置 SiliconFlow API Key，并触发一次 AI 生成
- **THEN** 客户端收到的错误 MUST 明确指出缺少 SiliconFlow（或对应）API Key，而非笼统 400

#### Scenario: Upstream rejects model id

- **WHEN** 上游返回模型不存在等业务错误
- **THEN** 客户端错误文案 MUST 包含可理解的原因摘要（可含 model id），便于用户回设置页修改

### Requirement: Env example omits unused model knobs

`.env.example` MUST NOT 再列出已不再作为产品配置面的 `PROVIDER_MODEL*`、`PROVIDER_TEMPERATURE*` 等字段；MUST 保留厂商密钥与仍被运行时使用的必要变量。

#### Scenario: New deployer copies example

- **WHEN** 开发者复制 `.env.example`
- **THEN** 文件中 MUST 能看清「密钥在 env、模型在前端设置」，且 MUST NOT 出现易误导的 `PROVIDER_MODEL=...` 日常配置项
