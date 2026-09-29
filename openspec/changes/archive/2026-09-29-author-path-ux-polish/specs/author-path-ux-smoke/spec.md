## ADDED Requirements

### Requirement: 作者主路径具备本地可复跑的 Playwright smoke

系统 MUST 在 `apps/web` 提供最小 Playwright 配置与 smoke，覆盖登录、项目列表、章节页、项目设置，以及打开文笔优化与按场成稿弹窗。Smoke MUST 通过环境变量读取凭据，MUST NOT 把密码写入仓库。

#### Scenario: 缺少凭据时明确失败

- **WHEN** 未设置 `E2E_EMAIL` 或 `E2E_PASSWORD` 时运行依赖登录的 smoke
- **THEN** 测试 MUST 以清晰错误失败（或跳过并说明原因），MUST NOT 静默假绿

#### Scenario: 双视口可跑

- **WHEN** 以 `1440×900` 与 `768×1024` 运行 smoke
- **THEN** 上述主路径页面 MUST 可导航到，弹窗 MUST 可打开

### Requirement: 巡检清单驱动 P0/P1 修复

实施 MUST 先写入分级巡检清单，再修复 P0 与 P1。P2 MUST 可仅记录不修。代码去重与注释 MUST 仅出现在与清单相关的改动中。

#### Scenario: 清单先于大面积样式改动

- **WHEN** 开始修复样式或性能问题
- **THEN** 对应条目 MUST 已记录在本 change 的 audit findings 中（含页面、视口、严重度）

#### Scenario: 轻量 AI 复现路径

- **WHEN** 执行轻量 AI 巡检
- **THEN** MUST 对第 2 章触发文笔优化 plan，并对约 300–800 字范围触发按场成稿 draft（若环境允许）
- **AND** MUST NOT 默认要求整章 direct 出稿或 auto-loop

### Requirement: 有证据才做性能修改

性能相关修改 MUST 绑定可观察的卡顿或过长阻塞（如弹窗打开迟滞、流式更新掉帧、列表滚动卡顿）。MUST NOT 以「全面优化」为名做无复现的重构。

#### Scenario: 性能修复可追溯

- **WHEN** 提交性能相关前端改动
- **THEN** audit findings 或 tasks 中 MUST 能对应到具体复现描述
