## 1. Shared template utilities

- [x] 1.1 Add `packages/config/src/chapter-summary/` with format/normalize/fallback helpers + unit tests
- [x] 1.2 Export from `@aether-quill/config` and build the package

## 2. Generation path

- [x] 2.1 Update `buildChapterSummaryPrompt` to fixed three-line template (180~280 字)
- [x] 2.2 Normalize LLM output in `summarizeChapterContent`; invalid → empty so API falls back
- [x] 2.3 Wire API `buildFallbackChapterSummary` / summarize path to shared helpers

## 3. Verification

- [x] 3.1 Update `chapter-summary.util` tests for new fallback shape
- [x] 3.2 Run `@aether-quill/config` + `@aether-quill/api` + `@aether-quill/rag-orchestrator` tests
