# AQ-383 / AQ-386：DeepSeek V4 Pro 能力登记修复

状态：代码修复与定向验证通过；标准 build 的 Prisma 步骤受运行服务 DLL 占用阻挡，待释放后重跑。AQ-386 真实模型验收仍未完成。（现有精修预算保护的缺陷修复，不新增产品范围。）

## 问题与复现

用户使用 `deepseek/deepseek-v4-pro` 精修 6556 字章节，第一窗 inspect 报“未登记冻结模型”的 context_budget，模型调用为 0。纯函数复现 `resolveRefinementModelCapability({ provider: 'deepseek', model: 'deepseek-v4-pro' })` 返回 null，断言失败；无需读取作者正文或调用模型。

根因：精确 provider/model 能力表只有 chat、reasoner、v4-flash 等登记，缺失 v4-pro；引擎的未知组合暂停行为符合既有保护合同。运行快照只冻结路由，没有冻结能力表项，更新代码后同一 Pro 路由可以重新解析能力并继续。

## 修复范围与验收标准（实现前登记）

- 为 **deepseek/deepseek-v4-pro** 新增能力项；provider/model 精确匹配与其他既有能力值保持原有行为。
- 官方上限依据：[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) 声明 1M 上下文；[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) 明确输出最大 393216 token。登记上下文采用保守的 1000000 token，输出采用明确的 393216 token；这是预算能力信息，不代表每次请求如此多输出。
- 保留现有必要输出计算、4096 token 安全预留、单次/总调用预算、严格完成校验。未知模型、其他 provider 同名模型仍不可默认放行。
- 红灯测试覆盖能力精确登记、inspect 前不再零调用暂停、两阶段 Pro 路由保持冻结，以及原零调用暂停 checkpoint 的续跑。
- 通过相关 util/engine 回归、API lint/typecheck/test/build 与 OpenSpec strict validate。
- 不变更 API、SSE、环境变量、模板、用户设置、原章节或既有 run 数据；不自动请求真实模型，不替用户应用稿件。

## 交付证据

日志目录：`.scratch/refinement-v4-pro-fix/`。

- 红灯 `red.log`：新增 3 项测试均失败，能力为 null，新建与零调用暂停续跑均为 paused，而非预期 ready。
- 绿灯 `green.log`：125/125（完整 util + engine 回归），0 skip。原始纯函数复现重跑 `original-repro-green.log` 返回明确的 Pro 能力和 `{ok:true,maxTokens:4096}`。
- API `api-test.log`：623 pass / 0 fail / 9 skip；跳过项是无专用 PG URL 的既有分支，不记通过。
- API lint、typecheck：exit 0。初次 lint 的新测试格式错误及修正记录保留在 `api-lint-first.log`；首次新测试把成功结果可选 pauseReason 当成必须为 null，已按引擎合同使用 `?? null`，不改变生产行为。
- API `nest build`：exit 0（`api-compile.log`）。标准 `pnpm --filter @aether-quill/api build` 的 Nest 编译已成功，但随后的 `prisma generate` 遇到 Windows `query_engine-windows.dll.node` rename EPERM（`api-build.log`）；未停止用户服务、未更改 schema 或 Prisma 生成配置，不把整个标准 build 标为通过。
- OpenSpec strict validate：valid（`validate.log`）。

源代码只新增一个 Pro 能力项，相关新测试分别检查精确匹配、真实引擎新建/续跑、各阶段保持冻结 Pro 路由以及请求仍仅使用必要的 4096 token。既有未知组合零调用暂停测试保持通过。

代码/日志指纹：[本轮证据](evidence/v4-pro-capability-fix-manifest-2026-10-07.json)。未提交、发布、归档或自动发起真实模型请求。其他既定非模型验收缺口仍见浏览器最终复验报告；本修复不代表 AQ-386 的真实模型文学质量验收完成。

## 用户恢复步骤

1. 让 API 服务加载更新后的代码。开发 watch 模式若已自动重启可直接使用；运行 dist/main 的实例需要重启 API。
2. 原文未改变、权限仍有效时，回到原精修运行点击“继续精修”。Pro 路由不需要重新选择；能力按更新代码精确解析。新运行和零调用 checkpoint 续跑已用假 gateway 测试。
3. 在服务释放 DLL 后补跑标准 build 门禁；不要通过删除未知模型保护或改变用户选型规避问题。真实模型首次输出及文学质量仍待用户本次试用验证。

回滚：删除本轮新增的 Pro 能力项即可回到原暂停行为；不影响其他模型登记、旧功能路径或已保存正文。
