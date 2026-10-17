# AQ-388 开发与评测记录

> 记录时间：2026-10-16（Asia/Shanghai）；状态：DOING，尚未达到质量发布门禁。

## 已完成的工程验证

- API：`pnpm --filter @aether-quill/api lint` 通过；`pnpm exec tsc --noEmit` 通过；`pnpm --filter @aether-quill/api test` 为 650 pass / 9 skip / 0 fail；`nest build` 已完成。
- Web：`pnpm --filter @aether-quill/web lint`、`vue-tsc --noEmit`、`test`（193 pass / 0 fail）通过；因已有 `dist/assets` 删除时报 ENOTEMPTY，改在 `.scratch/aq388-web-build` 进行独立 Vite 构建，通过（3991 modules）。
- rag-orchestrator：lint、build、test（189 pass / 0 fail）通过。
- prompt-templates：lint、typecheck、build 通过。
- `openspec validate improve-plan-based-chapter-rewrite --strict` 与目标文件 `git diff --check` 通过。

## 未通过的发布门禁

- API 标准 `pnpm --filter @aether-quill/api build` 在 Nest 编译后执行 `prisma generate`，替换 `query_engine-windows.dll.node` 时遭遇 Windows `EPERM` 文件占用；需进程释放后重跑。
- GS-G / GS-C 真实模型回归未完成：本地 `http://127.0.0.1:3001/health` 当前不可达；现有 `scripts/eval/gs-g-plot-continuity-samples.json` 测的是前章衔接，不覆盖 AQ-388 的指定拍点与保留项。须用适合的非敏感小说样章建立至少包含“目标未改、有效内容误改、逐字锁丢失、旧自由方案”的样例，并与旧默认模板对照人工评审。未获得样章对照结论前不标记 DONE。
- GitHub CLI 令牌失效，执行票使用 `.scratch/improve-plan-based-chapter-rewrite/issues/01-aq-388-plan-based-rewrite.md` 本地兜底；未 commit、push 或关票。

## 已知限制

- V1 保留自然语言方案，拍点与保留项由模型语义验收；自动化测试验证请求与状态合同，不能证明真实文学质量。
- 自检现在同时输入原文、方案与成稿；长章上下文与费用需在真实模型评测中检查。超限或解析异常会明确显示未完成检查。
- 项目已发布的自定义 Task Prompt 仍高于仓库默认；本次只变更默认模板与运行时提示，不覆盖用户已发布文本。
