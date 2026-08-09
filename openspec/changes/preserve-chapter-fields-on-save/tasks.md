## 1. Summary preserve on content write

- [x] 1.1 Update `resolveChapterSummaryOnContentWrite` to keep non-empty `llm` summaries; fallback otherwise; adjust unit tests (red→green)
- [x] 1.2 Confirm `upsertChapter` still uses the util (no parallel overwrite); add/adjust service-level assertion if an existing test seam covers it
- [x] 1.3 Optional hardening: ChapterList save avoids spurious content trim that flips hash when only title/whitespace changes

## 2. Verify

- [x] 2.1 Run `@aether-quill/api` tests for `chapter-summary.util` (and related) and note result in delivery
