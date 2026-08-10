import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveGenerationCallProfile,
  type GenerationProfileProjectOverrides,
  type ResolvedGenerationProfileEnv,
} from '@aether-quill/config';
import { GenerationService } from './generation.service';

const SPLIT_ENV: ResolvedGenerationProfileEnv = {
  fallbackModel: 'base-model',
  writingModel: 'writing-model-env',
  utilityModel: 'utility-model-env',
  writingTemperature: 0.92,
  utilityTemperature: 0.32,
  writingFrequencyPenalty: 0.3,
};

function resolveProfileForProject(
  templateKey: string,
  projectOverrides?: GenerationProfileProjectOverrides,
  requestTemperature?: number
) {
  return resolveGenerationCallProfile({
    templateKey,
    projectOverrides,
    requestTemperature,
    env: SPLIT_ENV,
  });
}

/** 复刻 main.ts 写入 trace 的上下文字段 */
function buildTraceContextFields(profile: ReturnType<typeof resolveGenerationCallProfile>) {
  return {
    generation_tier: profile.tier,
    generation_temperature: profile.temperature,
    ...(profile.frequencyPenalty !== undefined
      ? { generation_frequency_penalty: profile.frequencyPenalty }
      : {}),
  };
}

test('writing templateKey resolves writing model and frequency_penalty for trace', () => {
  const profile = resolveProfileForProject('chapter.pipeline.sensory.rewrite');
  const traceFields = buildTraceContextFields(profile);

  assert.equal(profile.tier, 'writing');
  assert.equal(profile.model, 'writing-model-env');
  assert.equal(profile.temperature, 0.92);
  assert.equal(profile.frequencyPenalty, 0.3);
  assert.equal(traceFields.generation_tier, 'writing');
  assert.equal(traceFields.generation_temperature, 0.92);
  assert.equal(traceFields.generation_frequency_penalty, 0.3);
});

test('utility templateKey resolves utility model without frequency_penalty', () => {
  const profile = resolveProfileForProject('chapter.pipeline.sensory.outline');
  const traceFields = buildTraceContextFields(profile);

  assert.equal(profile.tier, 'utility');
  assert.equal(profile.model, 'utility-model-env');
  assert.equal(profile.temperature, 0.32);
  assert.equal(profile.frequencyPenalty, undefined);
  assert.equal(traceFields.generation_tier, 'utility');
  assert.equal(traceFields.generation_frequency_penalty, undefined);
});

test('project settings override env models per tier', () => {
  const writing = resolveProfileForProject('write.chapter', {
    generationWritingModel: 'project-writing',
    generationUtilityModel: 'project-utility',
    generationTemperature: 0.25,
    writingGenerationTemperature: 0.88,
  });
  assert.equal(writing.model, 'project-writing');
  assert.equal(writing.temperature, 0.88);

  const utility = resolveProfileForProject('chapter.pipeline.brief.synthesize', {
    generationWritingModel: 'project-writing',
    generationUtilityModel: 'project-utility',
    generationTemperature: 0.25,
    writingGenerationTemperature: 0.88,
  });
  assert.equal(utility.model, 'project-utility');
  assert.equal(utility.temperature, 0.25);
});

test('unconfigured tier env falls back to PROVIDER_MODEL and legacy utility temperature', () => {
  const prev = {
    model: process.env.PROVIDER_MODEL,
    writing: process.env.PROVIDER_MODEL_WRITING,
    utility: process.env.PROVIDER_MODEL_UTILITY,
    temp: process.env.PROVIDER_TEMPERATURE,
    writingTemp: process.env.PROVIDER_TEMPERATURE_WRITING,
    utilityTemp: process.env.PROVIDER_TEMPERATURE_UTILITY,
    penalty: process.env.PROVIDER_FREQUENCY_PENALTY_WRITING,
    skip: process.env.AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION,
  };
  try {
    process.env.AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION = 'true';
    delete process.env.PROVIDER_MODEL_WRITING;
    delete process.env.PROVIDER_MODEL_UTILITY;
    delete process.env.PROVIDER_TEMPERATURE_WRITING;
    delete process.env.PROVIDER_TEMPERATURE_UTILITY;
    delete process.env.PROVIDER_FREQUENCY_PENALTY_WRITING;
    process.env.PROVIDER_MODEL = 'legacy-base';
    process.env.PROVIDER_TEMPERATURE = '0.65';

    const writing = resolveGenerationCallProfile({
      templateKey: 'chapter.pipeline.sensory.rewrite',
    });
    const utility = resolveGenerationCallProfile({
      templateKey: 'chapter.pipeline.sensory.outline',
    });

    assert.equal(writing.model, 'legacy-base');
    assert.equal(utility.model, 'legacy-base');
    assert.equal(utility.temperature, 0.65);
    assert.equal(writing.frequencyPenalty, undefined);
  } finally {
    if (prev.model === undefined) delete process.env.PROVIDER_MODEL;
    else process.env.PROVIDER_MODEL = prev.model;
    if (prev.writing === undefined) delete process.env.PROVIDER_MODEL_WRITING;
    else process.env.PROVIDER_MODEL_WRITING = prev.writing;
    if (prev.utility === undefined) delete process.env.PROVIDER_MODEL_UTILITY;
    else process.env.PROVIDER_MODEL_UTILITY = prev.utility;
    if (prev.temp === undefined) delete process.env.PROVIDER_TEMPERATURE;
    else process.env.PROVIDER_TEMPERATURE = prev.temp;
    if (prev.writingTemp === undefined) delete process.env.PROVIDER_TEMPERATURE_WRITING;
    else process.env.PROVIDER_TEMPERATURE_WRITING = prev.writingTemp;
    if (prev.utilityTemp === undefined) delete process.env.PROVIDER_TEMPERATURE_UTILITY;
    else process.env.PROVIDER_TEMPERATURE_UTILITY = prev.utilityTemp;
    if (prev.penalty === undefined) delete process.env.PROVIDER_FREQUENCY_PENALTY_WRITING;
    else process.env.PROVIDER_FREQUENCY_PENALTY_WRITING = prev.penalty;
    if (prev.skip === undefined) delete process.env.AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION;
    else process.env.AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION = prev.skip;
  }
});

test('user preferences select different providers per tier', () => {
  const writing = resolveGenerationCallProfile({
    templateKey: 'write.chapter',
    userPreferences: {
      writing: { provider: 'siliconflow', model: 'Qwen/Qwen2.5-7B-Instruct', temperature: 0.85 },
      utility: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4 },
    },
    env: SPLIT_ENV,
  });
  assert.equal(writing.tier, 'writing');
  assert.equal(writing.provider, 'siliconflow');
  assert.equal(writing.model, 'Qwen/Qwen2.5-7B-Instruct');
  assert.equal(writing.temperature, 0.85);

  const utility = resolveGenerationCallProfile({
    templateKey: 'chapter.pipeline.sensory.outline',
    userPreferences: {
      writing: { provider: 'siliconflow', model: 'Qwen/Qwen2.5-7B-Instruct', temperature: 0.85 },
      utility: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.4 },
    },
    env: SPLIT_ENV,
  });
  assert.equal(utility.tier, 'utility');
  assert.equal(utility.provider, 'deepseek');
  assert.equal(utility.model, 'deepseek-chat');
  assert.equal(utility.temperature, 0.4);
});

test('GenerationService.resolveProviderConfig routes dual vendors and fails when key missing', () => {
  const prev = {
    ds: process.env.DEEPSEEK_API_KEY,
    sf: process.env.SILICONFLOW_API_KEY,
    generic: process.env.PROVIDER_API_KEY,
  };
  const service = new GenerationService();
  const resolveProviderConfig = (
    service as unknown as {
      resolveProviderConfig: (provider?: 'deepseek' | 'siliconflow') => {
        providerUrl: string;
        apiKey: string;
      };
    }
  ).resolveProviderConfig.bind(service);

  try {
    process.env.DEEPSEEK_API_KEY = 'ds-key';
    process.env.SILICONFLOW_API_KEY = 'sf-key';
    delete process.env.PROVIDER_API_KEY;

    const deepseek = resolveProviderConfig('deepseek');
    assert.equal(deepseek.apiKey, 'ds-key');
    assert.match(deepseek.providerUrl, /deepseek/);

    const silicon = resolveProviderConfig('siliconflow');
    assert.equal(silicon.apiKey, 'sf-key');
    assert.match(silicon.providerUrl, /siliconflow/);

    delete process.env.SILICONFLOW_API_KEY;
    assert.throws(() => resolveProviderConfig('siliconflow'), /SiliconFlow/);
  } finally {
    if (prev.ds === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev.ds;
    if (prev.sf === undefined) delete process.env.SILICONFLOW_API_KEY;
    else process.env.SILICONFLOW_API_KEY = prev.sf;
    if (prev.generic === undefined) delete process.env.PROVIDER_API_KEY;
    else process.env.PROVIDER_API_KEY = prev.generic;
  }
});

test('GenerationService.resolveCallOptionsForTrace uses trace model and frequency penalty', () => {
  const prevKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  try {
    const service = new GenerationService();
    const resolve = (
      service as unknown as {
        resolveCallOptionsForTrace: (trace: {
          model: string;
          temperature?: number;
          context: Record<string, unknown>;
        }) => { model: string; temperature: number; frequencyPenalty?: number };
      }
    ).resolveCallOptionsForTrace.bind(service);

    const options = resolve({
      model: 'writing-model-x',
      temperature: 0.92,
      context: { generation_frequency_penalty: 0.25 },
    });
    assert.equal(options.model, 'writing-model-x');
    assert.equal(options.temperature, 0.92);
    assert.equal(options.frequencyPenalty, 0.25);
  } finally {
    if (prevKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = prevKey;
    }
  }
});

test('GenerationService.buildProviderRequestBody attaches frequency_penalty for writing calls', () => {
  const service = new GenerationService();
  const buildBody = (
    service as unknown as {
      buildProviderRequestBody: (
        messages: Array<{ role: string; content: string }>,
        provider: {
          providerUrl: string;
          apiKey: string;
          model: string;
          maxTokens: number;
          temperature: number;
        },
        options?: { frequencyPenalty?: number; model?: string; temperature?: number }
      ) => Record<string, unknown>;
    }
  ).buildProviderRequestBody.bind(service);

  const provider = {
    providerUrl: 'https://example.com',
    apiKey: 'k',
    model: 'default-model',
    maxTokens: 4096,
    temperature: 0.7,
  };

  const withPenalty = buildBody([{ role: 'user', content: 'hi' }], provider, {
    model: 'writing-model-env',
    temperature: 0.92,
    frequencyPenalty: 0.3,
  });
  assert.equal(withPenalty.model, 'writing-model-env');
  assert.equal(withPenalty.temperature, 0.92);
  assert.equal(withPenalty.frequency_penalty, 0.3);

  const withoutPenalty = buildBody([{ role: 'user', content: 'hi' }], provider, {
    model: 'utility-model-env',
    temperature: 0.32,
  });
  assert.equal(withoutPenalty.frequency_penalty, undefined);
});
