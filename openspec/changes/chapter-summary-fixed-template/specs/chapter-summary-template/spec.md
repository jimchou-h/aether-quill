## ADDED Requirements

### Requirement: Fixed three-line chapter summary template
The system MUST generate chapter semantic summaries in exactly three labeled lines:

```text
情节：…
人物：…
未收线：…
```

Labels MUST be exact Chinese prefixes `情节：` / `人物：` / `未收线：`. The system MUST NOT instruct free-form multi-section headings.

#### Scenario: LLM prompt enforces template
- **WHEN** the orchestrator builds a chapter summary prompt
- **THEN** the prompt MUST require the three-line template, field guidance, and a target length of 180~280 characters including labels

#### Scenario: Successful LLM output is normalized
- **WHEN** the model returns text that contains all three required labels with non-empty values
- **THEN** the system MUST persist the normalized three-line string (whitespace compacted per line) as the chapter summary with `summarySource: llm`

#### Scenario: Invalid LLM output falls back
- **WHEN** the model returns empty text or text missing any required label/value
- **THEN** the system MUST store the template-shaped fallback summary with `summarySource: fallback`
