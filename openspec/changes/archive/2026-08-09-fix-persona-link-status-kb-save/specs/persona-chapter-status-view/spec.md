## ADDED Requirements

### Requirement: View persona status as of a chapter
The Persona settings UI MUST allow the user to view a persona’s status using `chapterStates` (chapter-anchored snapshots), not only the latest `persona.state` mirror.

#### Scenario: Default shows latest state
- **WHEN** the user opens a persona without selecting a historical chapter filter
- **THEN** the UI MUST show the current `persona.state` (latest mirror), consistent with today’s default

#### Scenario: Filter by chapter uses chapterStates
- **WHEN** the user selects「截至第 N 章」(or equivalent) for a persona that has `chapterStates` entries
- **THEN** the UI MUST display the snapshot resolved for chapter N (same semantics as generation-side `resolvePersonaSnapshotAsOfChapter`: the latest `chapterStates` entry with `chapterNo <= N`, else fall back to `persona.state` if none)

#### Scenario: Empty chapterStates falls back
- **WHEN** the user selects a chapter filter but the persona has no `chapterStates`
- **THEN** the UI MUST fall back to `persona.state` and MUST NOT crash

### Requirement: Chapter status is read-only in this change
This change MUST NOT require a new API to edit historical `chapterStates` rows; editing continues to update the latest persona state unless a follow-up change expands write semantics.

#### Scenario: No new write contract required
- **WHEN** the user only views status as of chapter N
- **THEN** the client MUST use existing persona payload fields (`state`, `chapterStates`) without requiring new OpenAPI endpoints
