## 1. 切窗纯函数

- [ ] 1.1 `splitAutoLoopCharWindows`：`0` / 低于阈值整章一窗；否则按剩余段落攒满约 N 字；不腰斩；拼回逐字节等于原文
  - 测试：`chapter-auto-loop.util.test.ts`
- [ ] 1.2 `extractAutoLoopWindowTail`：取上一窗最后一段，超 400 字截末尾
  - 测试：同上

## 2. 每窗独立循环

- [ ] 2.1 `runChapterAutoLoopWindows`：顺序调用内层循环；已完成锁死；`round.draft` / `finalDraft` 为整章拼稿
  - 测试：`chapter-auto-loop.engine.test.ts` stub 断言每窗 diagnose 次数、窗 2 不改窗 1、拼稿含两窗
- [ ] 2.2 弹窗 N 轮对每一窗生效；窗失败停止后续窗；resume 跳过已锁死窗
  - 测试：同上，含 `plan_parse_failed` 与 windowPack resume
- [ ] 2.3 复诊 prompt 注入只读上一窗末文；service 读 `chapterOptimizeSegmentCharSize`
  - 测试：prompt 单测含「只读」；engine 把 tail 传进 diagnose input
- [x] 2.4 复诊不注入【下章衔接】；改写仅末窗/整章可注入；context 带 windowIndex/windowTotal
  - 测试：`knowledge-retrieval.test.ts`；prompt 单测禁止摘录下章衔接

## 3. 进度与设置

- [ ] 3.1 OpenAPI `windowIndex` / `windowTotal`；controller / 前端活动条「第 i/M 窗」；续跑文案带窗号
  - 测试：`chapterAutoLoopItems.test.ts` 续跑文案
- [ ] 3.2 设置页 hint 提到自动循环；新窗开始时条目面板按该窗刷新
  - 测试：hint 字符串断言（组件或常量）
