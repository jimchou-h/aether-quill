## 1. Defaults & API

- [x] 1.1 默认偏好改为 deepseek + `deepseek-v4-flash`；写作/常规温度默认均为 `0.7`；`model`/`temperature` 空值读出时物化
- [x] 1.2 去掉对 `PROVIDER_MODEL*` / `PROVIDER_TEMPERATURE*` 的日常回退；单测覆盖默认物化
- [ ] 1.3 AI 调用错误透传：缺 key 时 `LlmProviderKeyMissing`（或等价）可读文案；上游 4xx 含 model + 原文摘要；API/SSE 到前端可展示

## 2. Frontend single source UX

- [x] 2.1 账户设置页：空态展示 deepseek-v4-flash、温度 0.7；文案不再强调「留空 = 环境默认」
- [x] 2.2 建议列表加入 `deepseek-v4-flash`（DeepSeek）
- [ ] 2.3 AI/SSE 错误展示使用服务端可读 `message`（不再只显示码 400）

## 3. Env example cleanup

- [x] 3.1 更新 `.env.example`：删除无用模型/温度字段；保留密钥与仍使用的运行参数并注明「模型在前端设置」

## 4. Verify

- [ ] 4.1 相关 typecheck/test；手测或单测：缺 key / 错误 model 时前端能看到原因文案
