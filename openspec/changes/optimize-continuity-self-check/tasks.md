## 1. Contract & prompts

- [x] 1.1 Add OpenAPI path/schema for `POST /api/projects/{id}/knowledge/chapters/{chapterNo}/optimize/continuity-review` (request: planText, draftText; response: hasMaterialGaps, reviewText, items)
- [x] 1.2 Register warehouse task default `chapter.optimize.continuity-review` in prompt-templates + api util + orchestrator task-prompt-defaults
- [x] 1.3 Add unit tests for review result parsing (CLOSED / GAPS + items)

## 2. API continuity review

- [x] 2.1 Implement `ProjectsService` continuity-review call (utility profile, inject plan + draft, no chapter rewrite)
- [x] 2.2 Wire controller endpoint; sync shared-types as needed
- [x] 2.3 Add service/util tests for gap detection payload shaping used by refine

## 3. Web from-plan self-check flow

- [x] 3.1 After from-plan draft success in `ChapterOptimizeDialog`, auto-run continuity-review; show stage copy（自检中）
- [x] 3.2 If gaps: keep `draftBeforeRefine`, run one refine with `reviewGaps`, show refined draft as primary candidate
- [x] 3.3 Show self-check summary panel (passed / auto-fixed / remaining); never auto-apply
- [x] 3.4 Add author「标记问题并修复」：notes → repair refine against current draft; allow revert to previous candidate in-session
- [x] 3.5 Add frontend unit/wiring tests for stage transitions and refine-once guard

## 4. Verification

- [x] 4.1 Run targeted api/web tests for continuity review + dialog wiring
- [ ] 4.2 Manual smoke: from-plan draft → self-check → optional mark-fix → apply still explicit
