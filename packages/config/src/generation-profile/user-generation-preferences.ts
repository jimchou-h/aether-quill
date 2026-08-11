export const LLM_CHAT_PROVIDER_IDS = ['deepseek', 'siliconflow'] as const;
export type LlmChatProviderId = (typeof LLM_CHAT_PROVIDER_IDS)[number];

const MODEL_ID_MAX_LENGTH = 128;

/** 内置默认聊天模型（前端唯一配置源；不再回退 PROVIDER_MODEL） */
export const DEFAULT_BUILTIN_CHAT_MODEL = 'deepseek-v4-flash';
/** 写作/常规内置默认温度 */
export const DEFAULT_GENERATION_TEMPERATURE = 0.7;

export interface UserGenerationTierPreferences {
  provider: LlmChatProviderId;
  /** 具体模型 id；空值在归一化时物化为内置默认 */
  model: string | null;
  /** 0–2；空值在归一化时物化为 0.7 */
  temperature: number | null;
}

export interface UserGenerationPreferences {
  writing: UserGenerationTierPreferences;
  utility: UserGenerationTierPreferences;
}

export const DEFAULT_USER_GENERATION_PREFERENCES: UserGenerationPreferences = {
  writing: {
    provider: 'deepseek',
    model: DEFAULT_BUILTIN_CHAT_MODEL,
    temperature: DEFAULT_GENERATION_TEMPERATURE,
  },
  utility: {
    provider: 'deepseek',
    model: DEFAULT_BUILTIN_CHAT_MODEL,
    temperature: DEFAULT_GENERATION_TEMPERATURE,
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
  defaults: UserGenerationTierPreferences
): UserGenerationTierPreferences {
  const source =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const providerRaw = source.provider ?? defaults.provider;
  if (!isLlmChatProviderId(providerRaw)) {
    throw new Error(`Invalid LLM provider: ${String(providerRaw)}`);
  }

  let model: string | null;
  if (source.model === undefined) {
    model = defaults.model;
  } else {
    model = normalizeModelId(source.model);
  }
  if (!model) {
    model = defaults.model ?? DEFAULT_BUILTIN_CHAT_MODEL;
  }

  let temperature: number;
  if (source.temperature === undefined || source.temperature === null) {
    temperature =
      typeof defaults.temperature === 'number' && Number.isFinite(defaults.temperature)
        ? defaults.temperature
        : DEFAULT_GENERATION_TEMPERATURE;
  } else if (typeof source.temperature === 'number') {
    temperature = clampTemp(source.temperature, DEFAULT_GENERATION_TEMPERATURE);
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
 * Empty / null model or temperature are materialized to built-in defaults.
 * Throws on invalid provider / temperature shape.
 */
export function normalizeUserGenerationPreferences(
  input: unknown
): UserGenerationPreferences {
  const source =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  return {
    writing: normalizeTier(source.writing, DEFAULT_USER_GENERATION_PREFERENCES.writing),
    utility: normalizeTier(source.utility, DEFAULT_USER_GENERATION_PREFERENCES.utility),
  };
}
