## ADDED Requirements

### Requirement: Per-tier LLM provider selection
Writing-tier and utility-tier generation preferences MUST each include a provider choice of at least `deepseek` and `siliconflow`, and the runtime MUST route chat completions for that tier to the matching vendor endpoint and API key from environment configuration.

#### Scenario: Different providers for writing and utility
- **WHEN** the user sets utility provider to `deepseek` with a DeepSeek model and writing provider to `siliconflow` with a SiliconFlow model, and both vendor keys are configured in the environment
- **THEN** utility-tier calls MUST use DeepSeek’s chat endpoint/key and writing-tier calls MUST use SiliconFlow’s chat endpoint/key

#### Scenario: Provider selected but key missing
- **WHEN** the user selects a provider whose API key is not configured in the environment
- **THEN** the generation request MUST fail with a clear, documented error (MUST NOT silently call the other vendor’s endpoint)

### Requirement: Model suggestions filtered by provider
The global settings UI MUST present model suggestions appropriate to the selected provider for each tier.

#### Scenario: Switch provider updates suggestions
- **WHEN** the user switches the writing provider from DeepSeek to SiliconFlow
- **THEN** the writing model suggestion list MUST show SiliconFlow-oriented model ids (not only DeepSeek ids)
