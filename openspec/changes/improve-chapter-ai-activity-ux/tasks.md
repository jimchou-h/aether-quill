## 1. Activity model & page bar

- [x] 1.1 定义章节页 AI 活动状态（字段：source / chapterNo / taskKey / title|message / stage / steps / interruptible / error），并提供 start / applyProgress / complete / fail / cancel / reset；单测覆盖状态转换与「禁止静默覆盖」
- [x] 1.2 章节页挂载统一活动条（基于现有 `AiTaskProgressPanel` 升级或包装）：展示可读文案、步骤、错误、可中断时的中断按钮；进行中不再靠顶栏 `message` 刷进度

## 2. After-save readable progress

- [x] 2.1 after-save 进度映射为中文阶段文案并写入页面活动条；确认后立即 start；失败/取消态符合 spec；单测覆盖 action→文案映射
- [x] 2.2 若现有 SSE 事件不足以表达可读阶段，按 Contract First 最小补齐 OpenAPI + 前后端字段，再接到活动条

## 3. Dialog step clarity + sync

- [x] 3.1 写作优化弹窗：步骤态区分生成中 / 待确认 / 失败；运行中同步页面活动条；可中断流暴露中断
- [x] 3.2 创作精修弹窗：步骤条与 `step`/`running` 对齐；子阶段写入活动条 message；同步页面 SSOT
- [x] 3.3 终稿 / 合规等同页 AI 弹窗同步到同一活动条（避免入口遗漏）

## 4. Conflict & toast分工

- [x] 4.1 忙碌冲突：有 active 时新操作提示等待/先中断（或确认后中断再开）；禁止静默覆盖；单测或组件测覆盖
- [x] 4.2 收敛重复进度文案：进行中只用活动条；终态可用一次性 success/error 反馈

## 5. Verify

- [x] 5.1 相关 lint/typecheck/test；对照 spec 场景做手测清单（保存后处理、写作优化、创作精修、中断、冲突触发）
