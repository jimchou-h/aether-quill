# chapter-summary-on-save Specification

## Purpose
TBD - created by archiving change preserve-chapter-fields-on-save. Update Purpose after archive.
## Requirements
### Requirement: Preserve LLM summary when chapter content is saved
When a chapter’s content is updated via the knowledge chapter upsert path and an existing non-empty summary with `summarySource` of `llm` is present, the system MUST preserve that summary (and its `summarySource` / `summaryUpdatedAt`) instead of replacing it with a content-truncation fallback.

#### Scenario: LLM summary kept after content edit
- **WHEN** a chapter has `summarySource: llm` with a non-empty summary and the user saves edited content (content hash changes)
- **THEN** the stored summary, `summarySource`, and `summaryUpdatedAt` MUST remain the previous LLM values

#### Scenario: Fallback when no LLM summary
- **WHEN** a chapter has no summary, or `summarySource` is not `llm`, and content changes on save
- **THEN** the system MUST set summary to the content-truncation fallback with `summarySource: fallback` and update `summaryUpdatedAt`

#### Scenario: Unchanged content hash does not rewrite summary
- **WHEN** the saved content hash equals the existing content hash
- **THEN** the system MUST NOT rewrite summary fields due to the content-write summary policy (title-only updates remain summary-safe)

