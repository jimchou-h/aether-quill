## ADDED Requirements

### Requirement: Slim rewrite message assembly
When assembling LLM messages for chapter rewrite draft tasks (`chapter.optimize.draft` and `chapter.optimize.direct-draft`), the system MUST place reference context and retrieval evidence before the rewrite payload, MUST expose a single trailing output-instruction block in the user business prompt, and MUST state conflict priority in the task system prompt.

#### Scenario: Assembler section labels
- **WHEN** the orchestrator builds the user message
- **THEN** narrative context MUST be labeled `【参考上下文】` and the business prompt wrapper MUST be labeled `【任务输入】`

#### Scenario: Draft system states priority
- **WHEN** the draft or direct-draft task system prompt is the warehouse default
- **THEN** it MUST include conflict priority (user instruction over plan over reference/evidence over original) and MUST NOT duplicate the long “工作方式 / 请直接输出…” paragraphs that belong in `【输出要求】`

#### Scenario: Draft user prompt ends with output requirements
- **WHEN** `buildDraftUserPrompt` or `buildDirectDraftUserPrompt` runs
- **THEN** `<chapter-original>` (and `<optimization-plan>` when present) MUST appear before a final `【输出要求】` block, and the prompt MUST NOT repeat the old multi-line “请直接输出…实质性重写…” duplicate trailer
