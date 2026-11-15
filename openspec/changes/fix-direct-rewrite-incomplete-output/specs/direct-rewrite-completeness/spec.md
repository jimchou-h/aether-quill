## ADDED Requirements

### Requirement: 直接改写只在完整流结束后交付

系统 MUST 在直接改写正文生成时识别供应商的完成原因与完成标记。`finish_reason=length` 或其他明确的非正常结束、缺少供应商完成标记、以及缺少编排服务终止事件时，MUST 报告失败，MUST NOT 将已有片段标为完整成稿。

#### Scenario: 输出长度截断

- **WHEN** DeepSeek Pro 已输出部分正文，但返回 `finish_reason=length` 和 `[DONE]`
- **THEN** 系统 MUST 报告正文被截断，并将 trace 标记为失败

#### Scenario: 供应商提前断流

- **WHEN** 供应商输出部分正文后连接结束，未发送 `[DONE]`
- **THEN** 系统 MUST 报告流未完成，不能发出成功终态

#### Scenario: 编排服务提前断流

- **WHEN** API 已收到部分正文，但未收到编排服务的 `end` 事件
- **THEN** API MUST 报告失败，不能合并并交付该正文

#### Scenario: 正常完成

- **WHEN** 供应商返回正常 `stop` 和 `[DONE]`，编排服务返回 `end`
- **THEN** 系统 MUST 继续交付完整正文

### Requirement: 分批正文的段界与最终稿一致

章节优化正文 SSE MUST 将生成块间的双换行同步给前端；第二块及后续块尚未产生非空正文时 MUST NOT 预写分隔符。每次成功结束 MUST 在 `end.finalDraftText` 返回校验及后处理后的完整正文，即使后处理没有修改文本。直接改写与方案改写共用此行为。

#### Scenario: 两个生成块没有自带换行

- **WHEN** 两块分别输出 `他放下手机。` 和 `“收到消息了。”她说。`，且后处理未修改正文
- **THEN** 追加流 MUST 包含两块之间的双换行，成功 `end.finalDraftText` MUST 等于同样保留该段界的完整稿

#### Scenario: 单块或尚未输出正文的后续块

- **WHEN** 只有一块，或后续块尚未产生非空正文便失败
- **THEN** 系统 MUST NOT 添加前导空行或为无正文的块预写分隔符；失败 MUST NOT 发出成功 `end`

#### Scenario: 后处理修改了最终正文

- **WHEN** 所有块正常完成且后处理修改了合并稿
- **THEN** 成功 `end.finalDraftText` MUST 返回修改后的完整稿，沿用已有全文替换事件校准预览
