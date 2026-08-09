## ADDED Requirements

### Requirement: Knowledge document save must not block on full-library PG rewrite
Creating or updating a knowledge document MUST NOT wait for a full rewrite of all documents’ versions and chunks in PostgreSQL before returning success to the client.

#### Scenario: Single document save returns promptly
- **WHEN** the user saves one knowledge document in a project that already has many documents with chunks
- **THEN** the API MUST return success without awaiting a full-library delete+recreate of every document’s versions/chunks

#### Scenario: Saved document remains durable
- **WHEN** a document create/update succeeds
- **THEN** that document’s content and `personaId` (when set) MUST be durable in the project’s persistence path (memory + configured PG) such that a subsequent list/get returns the saved values

#### Scenario: Concurrent saves do not wipe data
- **WHEN** multiple document saves occur while PG sync is in flight
- **THEN** the sync path MUST NOT replace a non-empty PG library with an empty in-memory snapshot

### Requirement: Save latency target for typical libraries
For a project with on the order of tens of documents (including persona cards with chunks), a single-document save round-trip SHOULD complete in under ~1s under local/dev conditions once incremental sync is in place; if the target is missed, instrumentation MUST identify the remaining bottleneck.

#### Scenario: Regression guard via unit/integration test
- **WHEN** automated tests cover the PG sync helper
- **THEN** they MUST assert that updating one document does not delete/recreate unrelated documents’ chunk rows (or equivalent incremental contract)
