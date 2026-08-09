# persona-card-link-display Specification

## Purpose
TBD - created by archiving change fix-persona-link-status-kb-save. Update Purpose after archive.
## Requirements
### Requirement: Persona page shows linked persona cards
The Persona settings page MUST resolve linked `persona_card` documents using the same unwrapped document list payload as other project pages, and MUST display the linked card title when a card’s `personaId` matches the persona.

#### Scenario: Bound card shows as linked
- **WHEN** a knowledge-base `persona_card` has `personaId` set to persona P and the user opens the Persona settings page
- **THEN** persona P’s「关联角色卡」control MUST show that card’s title (not「未关联」)

#### Scenario: Unbound persona stays unlinked
- **WHEN** no `persona_card` has `personaId` equal to persona P
- **THEN** persona P’s「关联角色卡」control MUST show「未关联」

#### Scenario: Document list unwrap is array-safe
- **WHEN** the documents list API response has already been unwrapped to an array by the HTTP client
- **THEN** the Persona page MUST treat that array as the document list (MUST NOT read a nested `.data` that yields an empty list)

