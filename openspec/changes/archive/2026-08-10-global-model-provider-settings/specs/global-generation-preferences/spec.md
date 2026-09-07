## ADDED Requirements

### Requirement: User-level global generation preferences
The system MUST persist per-user global generation preferences for writing-tier and utility-tier model selection, writing temperature, and utility temperature, independent of any single project’s settings.

#### Scenario: Save and reload preferences
- **WHEN** an authenticated user updates writing model, writing temperature, utility model, and/or utility temperature in global settings and saves
- **THEN** a subsequent GET of that user’s preferences MUST return the saved values

#### Scenario: Defaults when unset
- **WHEN** the user has never set a preference field
- **THEN** generation MUST fall back to environment defaults for that field (same semantics as today’s null project override)

### Requirement: Global settings entry in app header
The web app MUST expose a settings control on the right side of the global navigation header that navigates to the global generation preferences UI.

#### Scenario: Open global settings from header
- **WHEN** a logged-in user clicks the header settings control
- **THEN** the global generation preferences screen MUST open

### Requirement: Project settings no longer own these generation fields
The project settings「生成偏好」UI MUST NOT be the primary editor for writing model, writing temperature, utility model, or utility temperature once global settings exist (fields removed or clearly read-only redirected).

#### Scenario: Project settings page does not edit global generation model/temp fields
- **WHEN** the user opens a project’s settings page
- **THEN** they MUST NOT be required to edit writing/utility model or writing/utility temperature there to change global behavior
