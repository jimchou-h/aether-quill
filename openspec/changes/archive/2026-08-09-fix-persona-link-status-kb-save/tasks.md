## 1. Persona card link display

- [x] 1.1 Add array-safe document list unwrap helper (or reuse `unwrapPayload`) and unit test: unwrapped array + nested `.data` both work
- [x] 1.2 Fix `Persona.vue` / `PersonaCardView` link map to use the helper; verify「关联角色卡」shows card title when `personaId` matches
- [x] 1.3 Add regression test covering linked vs unlinked display mapping

## 2. Persona chapter status view

- [x] 2.1 Port/share `resolvePersonaSnapshotAsOfChapter` semantics to a web (or shared) pure util + unit tests (latest, `chapterNo <= N`, empty fallback)
- [x] 2.2 Add Persona UI chapter filter (「最新」/「截至第 N 章」) wired to `chapterStates`; default remains latest `persona.state`
- [x] 2.3 Add UI/util test or component-level assertion for filtered snapshot display

## 3. Knowledge document save latency

- [x] 3.1 Refactor `syncDocumentsToPostgres` (or add incremental helper) so one document upsert does not delete/recreate unrelated docs’ versions/chunks; keep empty-snapshot safety gate
- [x] 3.2 Wire document create/update to await incremental sync only; add unit/integration test proving unrelated chunks untouched
- [x] 3.3 Smoke: save one knowledge doc in a multi-doc project and confirm list/get + link fields durable; note latency if still >~1s for follow-up
