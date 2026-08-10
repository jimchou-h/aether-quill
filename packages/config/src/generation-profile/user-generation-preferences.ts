export const LLM_CHAT_PROVIDER_IDS = ['deepseek', 'siliconflow'] as const;
export type LlmChatProviderId = (typeof LLM_CHAT_PROVIDER_IDS)[number];

const MODEL_ID_MAX_LENGTH = 128;
const DEFAULT_UTILITY_TEMPERATURE = 0.7;
const DEFAULT_WRITING_TEMPERATURE = 0.9;

export interface UserGenerationTierPreferences {
  provider: LlmChatProviderId;
  /** null = use env default model for this tier */
  model: string | null;
  /**
   * Writing: null = env PROVIDER_TEMPERATURE_WRITING.
   * Utility: always a number (default 0.7).
   */
  temperature: number | null;
}

export interface UserGenerationPreferences {
  writing: UserGenerationTierPreferences;
  utility: UserGenerationTierPreferences;
}

export const DEFAULT_USER_GENERATION_PREFERENCES: UserGenerationPreferences = {
  writing: {
    provider: 'deepseek',
    model: null,
    temperature: null,
  },
  utility: {
    provider: 'deepseek',
    model: null,
    temperature: DEFAULT_UTILITY_TEMPERATURE,
  },
};

function normalizeModelId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MODEL_ID_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

function clampTemp(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(2, Math.max(0, value));
}

function isLlmChatProviderId(value: unknown): value is LlmChatProviderId {
  return value === 'deepseek' || value === 'siliconflow';
}

function normalizeTier(
  raw: unknown,
  defaults: UserGenerationTierPreferences,
  options: { allowNullTemperature: boolean }
): UserGenerationTierPreferences {
  const source =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const providerRaw = source.provider ?? defaults.provider;
  if (!isLlmChatProviderId(providerRaw)) {
    throw new Error(`Invalid LLM provider: ${String(providerRaw)}`);
  }

  const model =
    source.model === undefined ? defaults.model : normalizeModelId(source.model);

  let temperature: number | null;
  if (source.temperature === undefined) {
    temperature = defaults.temperature;
  } else if (source.temperature === null) {
    if (!options.allowNullTemperature) {
      temperature = defaults.temperature ?? DEFAULT_UTILITY_TEMPERATURE;
    } else {
      temperature = null;
    }
  } else if (typeof source.temperature === 'number') {
    temperature = options.allowNullTemperature
      ? clampTemp(source.temperature, DEFAULT_WRITING_TEMPERATURE)
      : clampTemp(source.temperature, DEFAULT_UTILITY_TEMPERATURE);
  } else {
    throw new Error('temperature must be a number or null');
  }

  return {
    provider: providerRaw,
    model,
    temperature,
  };
}

/**
 * Normalize and validate user global generation preferences.
 * Throws on invalid provider / temperature shape.
 */
export function normalizeUserGenerationPreferences(
  input: unknown
): UserGenerationPreferences {
  const source =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  return {
    writing: normalizeTier(source.writing, DEFAULT_USER_GENERATION_PREFERENCES.writing, {
      allowNullTemperature: true,
    }),
    utility: normalizeTier(source.utility, DEFAULT_USER_GENERATION_PREFERENCES.utility, {
      allowNullTemperature: false,
    }),
  };
}
