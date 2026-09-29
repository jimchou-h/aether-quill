# chapter-ai-surface Specification

## Purpose
章节工作区 AI 产品面仅保留文笔优化与按场成稿；创作精修、终稿合规、一键终稿、批量精修与独立错字检查不再作为产品能力对外提供。

## Requirements
### Requirement: 章节 AI 产品面仅保留文笔优化与按场成稿

系统 MUST 在章节工作区仅提供以下 AI 能力入口：文笔优化（方案改写、直接改写、自动循环）与按场成稿。系统 MUST NOT 再提供创作精修、终稿合规检验、一键终稿质检、批量创作精修或独立错字检查/修正的产品入口。

#### Scenario: 章节列表无砍除入口

- **WHEN** 用户打开章节列表或章节操作菜单
- **THEN** 系统 MUST 展示文笔优化与按场成稿相关入口
- **AND** 系统 MUST NOT 展示创作精修、终稿合规、一键终稿或批量精修入口

#### Scenario: 设置页无精修偏好

- **WHEN** 用户打开项目设置中与章节 AI 相关的偏好
- **THEN** 系统 MUST NOT 展示仅服务于创作精修流水线的模块开关页

### Requirement: 砍除能力的 HTTP/SSE 合同移除

系统 MUST 从 OpenAPI 与实现中移除章节创作精修（`/pipeline/*`）、终稿合规（`/compliance-check/*`）以及独立错字（`optimize/typo-check`、`optimize/typo-fix`）的对外合同与可调用路由。调用已删除路径时，客户端 MUST 无法再按原合同成功调用（路径不存在或不再注册）。

#### Scenario: OpenAPI 不再描述砍除路径

- **WHEN** 查阅项目 OpenAPI 合同
- **THEN** 合同 MUST NOT 再包含上述 pipeline / compliance-check / typo 路径的有效 `$ref` 入口

#### Scenario: 保留路径仍可用

- **WHEN** 客户端调用文笔优化 plan/draft/apply/auto-loop 或按场成稿 draft/review/fix-span
- **THEN** 这些路径 MUST 仍按既有合同可用

### Requirement: 自动循环与按场成稿不受砍除影响

删除砍除栈后，系统 MUST 保持自动循环与按场成稿的既有可运行行为；若实现曾依赖 pipeline/compliance 模块中的共享 helper，MUST 在删除前将必要依赖迁到中性模块或等价实现，不得以「保留整棵精修/合规产品」为代价。

#### Scenario: 自动循环仍可启动流式回合

- **WHEN** 用户对某章启动自动循环
- **THEN** 系统 MUST 仍能完成诊断与改写所需的流式生成调用（不得因缺失 pipeline 产品服务而失败）

#### Scenario: 按场成稿范围内成稿仍可用

- **WHEN** 用户使用按场成稿对划定范围生成正文
- **THEN** 系统 MUST 按既有 workbench 合同完成请求，与砍除栈无关
