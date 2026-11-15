## 1. 章节锁定标识（AQ-396）

- [ ] 1.1 AQ-396 打通单章锁定／解锁：先更新 OpenAPI 与生成类型，再实现默认 false 的 Prisma 迁移、PG/JSON 读写、鉴权 PATCH，以及章节页操作和列表／详情锁标识；逐行为先写自动化红灯再实现。验收：owner/editor 可切换且幂等，viewer/越权/非法输入被拒，旧章默认未锁定，刷新／重启保留并按项目隔离，失败保留原状态，正文保存与优化应用保留标记，单独切换不修改正文版本或触发后处理；受影响包 lint/typecheck/test/build 通过并登记证据。

## 2. 验证映射与交付边界

`1.1` 对应执行票 [GitHub #49 — 章节锁定标识 1/1（AQ-396）](https://github.com/jimchou-h/aether-quill/issues/49)，本地镜像 `.scratch/add-chapter-lock-marker/issues/01-aq-396-chapter-lock-marker.md`（gitignored）。2026-11-15 作者已确认纯标记范围；GitHub 连接恢复后查重无重复，由 `.scratch` 兜底票同步创建远程票。自动化测试点从 `specs/chapter-lock-marker/spec.md` 的场景派生，按行为逐个红→绿，不按前后端横向拆票。

- API 行为：锁定／解锁与重复设置、写权限与项目隔离、缺章与参数类型校验、持久化失败。
- 存储与兼容：PG 单章／全量读写映射、旧 JSON 默认值和恢复、正文保存／导入覆盖／优化应用保留标记、标记切换保持正文版本。
- Web 行为：在现有 Playwright author-path smoke 中覆盖两处标识、刷新恢复、解锁、锁定后仍可编辑；补充请求失败、切章与切项目异步响应归属测试，确认不覆盖未保存正文。

状态：阶段 3 开发，任务 `0/1`；执行票 #49 为 `ready-for-agent`（AFK，无前置业务依赖），在隔离分支 `feat/aq-396-chapter-lock-marker` 逐行为红→绿。验证通过且 commit/push 后才勾选任务和关闭 issue；用户明确「验收通过」后才归档。
