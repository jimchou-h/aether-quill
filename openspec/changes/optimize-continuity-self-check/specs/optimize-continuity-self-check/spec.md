## ADDED Requirements

### Requirement: Continuity review after from-plan draft

The system SHALL provide a continuity review step that compares a from-plan optimize draft against the confirmed optimization plan (including plot-beat list, scene states, reference dependencies, and verbatim locks when present) and the chapter original context needed for transitions.

The review MUST focus on continuity defects only: missing or dropped beats, dangling references, spatial/pose violations, missing location transitions, and verbatim-lock rewrites. The review MUST NOT request pure prose enrichment.

#### Scenario: Review finds no material gaps

- **WHEN** continuity review runs on a draft that satisfies the plan continuity contract
- **THEN** the system reports no material gaps (empty issue list or equivalent CLOSED result)
- **AND** the draft shown to the author remains that draft without an automatic refine pass

#### Scenario: Review finds material gaps

- **WHEN** continuity review finds one or more continuity defects
- **THEN** the system returns a structured issue summary suitable for display and for driving a single refine pass
- **AND** each issue identifies the defect type and an actionable fix intent

### Requirement: Automatic self-check before author final review

For the manual from-plan optimize flow, after a successful draft generation completes, the system SHALL automatically run continuity review before presenting the draft as the author's primary final candidate.

#### Scenario: Auto refine once when gaps exist

- **WHEN** continuity review reports material gaps after the initial from-plan draft
- **THEN** the system MUST run at most one refine pass that applies those gaps as revision constraints against the just-produced draft
- **AND** the author is then shown the refined draft as the primary final candidate
- **AND** the UI exposes a short self-check summary (passed, or gaps found and auto-fixed / remaining)

#### Scenario: Skip refine when review is clean

- **WHEN** continuity review reports no material gaps
- **THEN** the system MUST NOT run an automatic refine pass
- **AND** the author is shown the original draft with a passed self-check summary

#### Scenario: Apply still requires confirmation

- **WHEN** self-check and optional refine finish
- **THEN** the chapter body in persistence MUST remain unchanged until the author explicitly applies the draft

### Requirement: Author can mark remaining issues for AI fix

After the self-checked final candidate is shown, the author SHALL be able to describe remaining issues and request an AI fix without being forced to re-run a full plan generation.

#### Scenario: Mark issues and repair

- **WHEN** the author submits one or more marked issue notes against the current final candidate
- **THEN** the system runs a repair pass constrained by those notes (refine and/or span fix)
- **AND** updates the displayed final candidate to the repair result
- **AND** still requires explicit apply before overwriting the stored chapter

#### Scenario: Preserve pre-repair draft for comparison

- **WHEN** an automatic refine or author-requested repair replaces the displayed draft
- **THEN** the client SHOULD keep the previous candidate available for the author to compare or revert within the optimize session
