import { isWritingStyleInjectionTemplateKey } from '../writing-style-samples';
import type { LlmChatProviderId, UserGenerationPreferences } from './user-generation-preferences';

export type GenerationTier = 'writing' | 'utility';

export const GENERATION_TIER_WRITING: GenerationTier = 'writing';
export const GENERATION_TIER_UTILITY: GenerationTier = 'utility';

export const GENERATION_MODEL_ID_MAX_LENGTH = 128;

export const DEFAULT_WRITING_GENERATION_TEMPERATURE = 0.9;
export const DEFAULT_UTILITY_GENERATION_TEMPERATURE = 0.7;
export const DEFAULT_WRITING_FREQUENCY_PENALTY = 0.3;

export type GenerationProfileServiceRole = 'rag-orchestrator' | 'api';

export interface ResolvedGenerationProfileEnv {
  /** 回退模型（PROVIDER_MODEL 或 deepseek-chat） */
  fallbackModel: string;
  writingModel: string;
  utilityModel: string;
  writingTemperature: number;
  utilityTemperature: number;
  /** 未配置 PROVIDER_FREQUENCY_PENALTY_WRITING 时为 undefined */
  writingFrequencyPenalty?: number;
}

function trimEnv(key: string): string {
  return (process.env[key] ?? '').trim();
}

function parseTemperature(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 2) {
    throw new Error(`${key} must be a number in [0, 2]`);
  }
  return n;
}

function parseOptionalFrequencyPenalty(
  raw: string | undefined,
  key: string
): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 2) {
    throw new Error(`${key} must be a number in [0, 2]`);
  }
  return n;
}

function validateModelIdIfSet(raw: string | undefined, key: string): void {
  if (raw === undefined || raw.trim() === '') {
    return;
  }
  const normalized = normalizeGenerationModelId(raw);
  if (!normalized) {
    throw new Error(`${key} must be a non-empty model id up to ${GENERATION_MODEL_ID_MAX_LENGTH} chars`);
  }
}

export function normalizeGenerationModelId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > GENERATION_MODEL_ID_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

export function clampWritingGenerationTemperature(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_WRITING_GENERATION_TEMPERATURE;
  }
  return Math.min(2, Math.max(0, value));
}

export function resolveWritingGenerationTemperatureOverride(
  value: number | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return clampWritingGenerationTemperature(value);
}

/**
 * 启动期校验：分级生成相关环境变量（可选；未配置时保持与 PROVIDER_MODEL / 0.7 向后兼容）。
 */
export function assertGenerationProfileEnv(role: GenerationProfileServiceRole): void {
  if (trimEnv('AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION') === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION cannot be enabled when NODE_ENV=production'
      );
    }
    return;
  }

  const errors: string[] = [];
  const checks: Array<() => void> = [
    () => validateModelIdIfSet(process.env.PROVIDER_MODEL_WRITING, 'PROVIDER_MODEL_WRITING'),
    () => validateModelIdIfSet(process.env.PROVIDER_MODEL_UTILITY, 'PROVIDER_MODEL_UTILITY'),
    () => {
      try {
        parseTemperature(
          process.env.PROVIDER_TEMPERATURE_WRITING,
          DEFAULT_WRITING_GENERATION_TEMPERATURE,
          'PROVIDER_TEMPERATURE_WRITING'
        );
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    },
    () => {
      try {
        parseTemperature(
          process.env.PROVIDER_TEMPERATURE_UTILITY,
          DEFAULT_UTILITY_GENERATION_TEMPERATURE,
          'PROVIDER_TEMPERATURE_UTILITY'
        );
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    },
    () => {
      try {
        parseOptionalFrequencyPenalty(
          process.env.PROVIDER_FREQUENCY_PENALTY_WRITING,
          'PROVIDER_FREQUENCY_PENALTY_WRITING'
        );
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    },
  ];

  for (const check of checks) {
    try {
      check();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (errors.length > 0) {
    const payload = {
      event: 'generation_profile_env_invalid',
      service: role,
      errors,
    };
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(payload));
    throw new Error(`Generation profile environment validation failed (${errors.length} issue(s))`);
  }
}

/** 解析分级生成环境变量；须在 {@link assertGenerationProfileEnv} 通过后调用。 */
export function getResolvedGenerationProfileEnv(): ResolvedGenerationProfileEnv {
  const fallbackModel = trimEnv('PROVIDER_MODEL') || 'deepseek-chat';
  const legacyTemperature = parseTemperature(
    process.env.PROVIDER_TEMPERATURE,
    DEFAULT_UTILITY_GENERATION_TEMPERATURE,
    'PROVIDER_TEMPERATURE'
  );
  return {
    fallbackModel,
    writingModel: trimEnv('PROVIDER_MODEL_WRITING') || fallbackModel,
    utilityModel: trimEnv('PROVIDER_MODEL_UTILITY') || fallbackModel,
    writingTemperature: parseTemperature(
      process.env.PROVIDER_TEMPERATURE_WRITING,
      DEFAULT_WRITING_GENERATION_TEMPERATURE,
      'PROVIDER_TEMPERATURE_WRITING'
    ),
    utilityTemperature: parseTemperature(
      process.env.PROVIDER_TEMPERATURE_UTILITY,
      legacyTemperature,
      'PROVIDER_TEMPERATURE_UTILITY'
    ),
    writingFrequencyPenalty: parseOptionalFrequencyPenalty(
      process.env.PROVIDER_FREQUENCY_PENALTY_WRITING,
      'PROVIDER_FREQUENCY_PENALTY_WRITING'
    ),
  };
}

// ── Tier routing (AQ-341) ─────────────────────────────────────────────

export interface GenerationProfileProjectOverrides {
  generationWritingModel?: string | null;
  generationUtilityModel?: string | null;
  /** 工具级温度覆盖（项目 settings.generationTemperature） */
  generationTemperature?: number;
  writingGenerationTemperature?: number | null;
}

export interface ResolvedGenerationCallProfile {
  tier: GenerationTier;
  model: string;
  temperature: number;
  frequencyPenalty?: number;
  /** 聊天厂商；缺省 deepseek（兼容旧调用方） */
  provider: LlmChatProviderId;
}

export function clampUtilityGenerationTemperature(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_UTILITY_GENERATION_TEMPERATURE;
  }
  return Math.min(2, Math.max(0, value));
}

/** 写作级 templateKey：续写、优化 draft/typo-fix、pipeline 改写/revise/fix-items、同质化改写、规则修复 */
export function isWritingTierTemplateKey(templateKey: string): boolean {
  const key = templateKey.trim();
  if (!key) {
    return false;
  }
  if (isWritingStyleInjectionTemplateKey(key)) {
    return true;
  }
  if (key === 'chapter.pipeline.rules.fix') {
    return true;
  }
  return false;
}

export function resolveGenerationTierForTemplateKey(templateKey: string): GenerationTier {
  return isWritingTierTemplateKey(templateKey) ? GENERATION_TIER_WRITING : GENERATION_TIER_UTILITY;
}

/**
 * 按 templateKey → tier 解析 model / temperature / frequency_penalty / provider；
 * 优先级：env → 用户全局偏好 → 项目覆盖 → 请求级。
 */
export function resolveGenerationCallProfile(input: {
  templateKey?: string;
  projectOverrides?: GenerationProfileProjectOverrides;
  userPreferences?: UserGenerationPreferences | null;
  requestTemperature?: number;
  requestModel?: string;
  env?: ResolvedGenerationProfileEnv;
}): ResolvedGenerationCallProfile {
  const env = input.env ?? getResolvedGenerationProfileEnv();
  const tier = resolveGenerationTierForTemplateKey(input.templateKey ?? '');
  const userTier =
    tier === GENERATION_TIER_WRITING
      ? input.userPreferences?.writing
      : input.userPreferences?.utility;

  let provider: LlmChatProviderId = userTier?.provider ?? 'deepseek';
  let model =
    tier === GENERATION_TIER_WRITING ? env.writingModel : env.utilityModel;
  let temperature =
    tier === GENERATION_TIER_WRITING ? env.writingTemperature : env.utilityTemperature;
  let frequencyPenalty: number | undefined =
    tier === GENERATION_TIER_WRITING ? env.writingFrequencyPenalty : undefined;

  if (userTier) {
    const userModel = normalizeGenerationModelId(userTier.model);
    if (userModel) {
      model = userModel;
    }
    if (tier === GENERATION_TIER_WRITING) {
      if (typeof userTier.temperature === 'number' && Number.isFinite(userTier.temperature)) {
        temperature = clampWritingGenerationTemperature(userTier.temperature);
      }
    } else if (
      typeof userTier.temperature === 'number' &&
      Number.isFinite(userTier.temperature)
    ) {
      temperature = clampUtilityGenerationTemperature(userTier.temperature);
    }
  }

  const overrides = input.projectOverrides;
  if (tier === GENERATION_TIER_WRITING) {
    const projectModel = normalizeGenerationModelId(overrides?.generationWritingModel);
    if (projectModel) {
      model = projectModel;
    }
    const projectTemp = resolveWritingGenerationTemperatureOverride(
      overrides?.writingGenerationTemperature
    );
    if (projectTemp !== null) {
      temperature = projectTemp;
    }
  } else {
    const projectModel = normalizeGenerationModelId(overrides?.generationUtilityModel);
    if (projectModel) {
      model = projectModel;
    }
    if (
      typeof overrides?.generationTemperature === 'number' &&
      Number.isFinite(overrides.generationTemperature)
    ) {
      temperature = clampUtilityGenerationTemperature(overrides.generationTemperature);
    }
  }

  const requestModel = normalizeGenerationModelId(input.requestModel);
  if (requestModel) {
    model = requestModel;
  }
  if (typeof input.requestTemperature === 'number' && Number.isFinite(input.requestTemperature)) {
    temperature =
      tier === GENERATION_TIER_WRITING
        ? clampWritingGenerationTemperature(input.requestTemperature)
        : clampUtilityGenerationTemperature(input.requestTemperature);
  }

  return {
    tier,
    model,
    temperature,
    provider,
    ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
  };
}

export * from './user-generation-preferences';
export * from './llm-chat-provider-endpoint';
