---
name: rag-doc-generator
description: Generates structured project docs for Aether Quill from natural-language requirements. Use when the user asks to create, update, or refine implementation plans, development checklists, task progress boards, API/config specs, provider adaptation docs (DeepSeek/SiliconFlow), RAG evaluation baselines, collaboration docs, AGENTS.md, or .docs documentation.
---

# RAG Doc Generator

## Purpose

为 Aether Quill 项目将用户需求转换为可执行文档，并保持与现有规范一致。

## Required Inputs

最少需要以下输入：
- 用户的目标需求（要生成什么类型文档）
- 目标范围（新建文档或更新现有文档）

如果用户未指定文件名或位置，默认写入 `.docs/`，并遵循现有命名规范。

## Mandatory Read Order

在生成或修改文档前，必须按顺序读取：
1. `/.docs/README.md`
2. `/.docs/01-架构总览/README.md`
3. `/.docs/02-开发执行/README.md`
4. `/.docs/02-开发执行/任务开发进度清单-v1.md`（若存在）
5. `/.docs/03-接口与配置/README.md`
6. `/.docs/04-质量与治理/README.md`
7. `/.docs/05-协作规范/README.md`
8. `/AGENTS.md`（若存在）

## Document Routing Rules

根据内容类型选择目录与落盘策略：
- 架构/范围/目标类：`01-架构总览` 对应文档
- 任务拆解/执行清单类：`02-开发执行` 对应文档
- API/错误码/环境配置类：`03-接口与配置` 对应文档
- 评测/Prompt 治理/验收类：`04-质量与治理` 对应文档
- 协作协议/分支规范类：`05-协作规范` 对应文档

如新增文档：
- 文件名使用 `<主题>-v<版本>.md`
- 同步更新 `/.docs/README.md` 和对应分层 `README.md` 的索引

## Authoring Workflow

1. 明确文档类型：方案、清单、规范、协议、角色指令  
2. 对齐约束来源：从现有 `.docs` 文档提取术语和阈值  
3. 生成文档主体：目标、范围、规则、流程、门禁、交付标准  
4. 做一致性检查：术语、路径、版本号、依赖关系  
5. 更新目录索引：总入口 + 分层入口  
6. 若涉及 `AQ-XXX` 任务状态变化，同步更新 `/.docs/02-开发执行/任务开发进度清单-v1.md`  
7. 输出完成说明：仅报告已完成事项与文件清单

## Quality Gates (Must Pass)

- 术语一致：`trace_id`、`AQ-XXX`、`SSE`、错误码命名等必须一致
- 结构完整：必须有“目的/范围/执行规则/验收标准”
- 可执行性：每个流程有清晰输入、输出、完成判定
- 可追溯：关联到已有基线文档，不允许孤立新规则
- 不重复造轮子：优先更新现有文档，避免平行重复版本
- 若涉及任务执行：必须同步进度看板，不允许只改任务文档不改状态
- 若涉及模型供应商（DeepSeek/SiliconFlow）适配：必须同步配置规范、错误码手册、任务与进度看板
- 若涉及 Prompt 可配置化：必须明确 `systemPromptText` 字段、接口与页面落点

## Output Style

- 使用中文
- 表述直接，不输出泛泛建议
- 默认一次性给出完整文档，不拆分到多轮建议
- 只报告已落地结果与文件路径

## Templates

常用模板见 [templates.md](templates.md)。
