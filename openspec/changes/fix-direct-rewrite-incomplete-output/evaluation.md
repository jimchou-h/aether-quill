# AQ-394 段界同步修复记录（2026-11-02）

## 已定位与修复

- 中性输入通过真实前端 SSE 事件处理与文本 sink 可复现：两块分别为 `他放下手机。`、`“收到消息了。”她说。` 时，缺少块间分隔且成功终态缺少最终全文，预览粘连。补充最终全文后可恢复段界。
- API 现在仅在第二块及后续块第一次非空内容前发送一次双换行；空内容不消耗状态，尚未输出便失败时不预写分隔符。
- 成功 `end.finalDraftText` 始终返回校验及后处理后的完整稿，现有前端直接沿用全文替换逻辑。块内排版、生成请求、Prompt、模型和业务正文均未修改。
- 只包装章节优化分段调用；共享的工作台范围生成仍保持原来的拼接语义。直接改写与方案改写均覆盖。

## 自动验证

- 新增 `chapter-optimize-paragraph-boundary.test.ts`：初始 3 fail / 2 pass；修复并补空片段、首片段前失败后 7/7 pass。测试使用真实服务入口、切分及编排 SSE 解析，仅模拟上游流并关闭安全重写，不读写业务存储或调用模型。
- 本次新增 7 例及既有 SSE 完成判定 2 例在包级测试中均通过。覆盖两种模式、单块内部空行、失败与缺结束标记、空内容与无正文失败。
- API 整包测试：693 tests，682 pass / 2 fail / 9 skip。两个失败位于 `chapter-optimize.util.test.ts:331`、`:486`，分别仍匹配旧 Prompt 文本“改动幅度由”和“禁止大段照抄原文”；本次未修改模板或这些既有断言。
- 改动服务文件及新增测试 ESLint 通过。API 整包 lint 的 5 个既有格式错误位于 `editor-chat-chapter.util.ts`、`editor-chat.controller.test.ts`、`editor-chat.openapi.test.ts`，本次未扩范围修改。
- API `typecheck` 通过。标准 `build` 的 Nest 编译完成，随后 Prisma 生成器替换运行中 Windows DLL 时 `EPERM`，构建门禁未全通过；未终止服务规避占用。
- OpenSpec strict 校验及改动文件 `git diff --check` 通过。未调用真实模型，不以此宣称文学质量改善。

## 交付状态与回滚

- 本地修复完成，API 当前存在 watch 进程；未提交、推送或归档。因整包门禁仍有上述问题，AQ-394 保持 `DOING`，不宣称全部检查通过。
- 回滚只撤销本次服务中的分隔符包装、成功终态必传全文及其内部类型三处改动；不得整文件还原，以免覆盖同文件的既有未提交修改。

---

# AQ-390 排查与验证记录

> 2026-10-26；本地修复已完成，待作者用 DeepSeek V3 Pro 实际试用；任务保持 DOING。

## 已复现的问题

- `chapter.optimize.direct-draft` 的真实编排服务生成路径中，模拟供应商返回部分正文后以 `finish_reason=length` 收束，旧代码仍将 trace 标为 completed。
- 模拟供应商输出部分正文后无 `[DONE]` 即断流，旧代码仍将非空正文标为 completed。
- API 收到编排服务部分 `content` 后缺少 `end`，旧代码仍将片段视作有效段落。

## 修复与回归

- 编排服务现在要求供应商完成标记；明确的非正常结束原因返回错误。失败 trace 保存 `finishReason`，落盘仅存元数据，不存正文。
- API 正文生成要求编排服务 `end`；缺失时返回错误，不发出成稿成功事件。
- 定向测试：编排服务 8/8、API 2/2 通过；改动文件 ESLint 通过；编排服务 typecheck 通过。此前包级 API 测试 674 pass / 9 skip、编排服务 193 pass；此次最后修改后仅重跑上述定向测试。
- 编排服务 build 通过；API `nest build` 已完成，但标准 `build` 的 Prisma DLL 替换遭 Windows 文件占用 `EPERM`。API 整包 lint 受并行编辑对话文件的 6 处格式问题阻断，AQ-390 改动文件 lint 通过。
- `openspec validate fix-direct-rewrite-incomplete-output --strict` 通过。

## 待作者试用

- 用 DeepSeek V3 Pro 直接改写一章，确认完整输出仍正常展示；遇到长度截断或断流时应显示错误，不出现“优化正文已生成”。
- 旧 trace 落盘未保存结束原因，无法据此确认作者此前具体是哪种情况；新运行会保存。未执行付费真实模型回归，也未评估文学质量。
