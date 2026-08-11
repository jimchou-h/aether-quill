import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertGenerationProfileEnv,
  clampWritingGenerationTemperature,
  getResolvedGenerationProfileEnv,
  isWritingTierTemplateKey,
  normalizeGenerationModelId,
  resolveGenerationCallProfile,
  resolveGenerationTierForTemplateKey,
} from './index';

test('normalizeGenerationModelId trims and rejects empty or overlong ids', () => {
  assert.equal(normalizeGenerationModelId('  deepseek-chat  '), 'deepseek-chat');
  assert.equal(normalizeGenerationModelId(''), null);
  assert.equal(normalizeGenerationModelId('a'.repeat(129)), null);
});

test('getResolvedGenerationProfileEnv falls back to PROVIDER_MODEL and legacy temperature', () => {
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
    process.env.PROVIDER_MODEL = 'base-model';
    process.env.PROVIDER_TEMPERATURE = '0.65';
    assertGenerationProfileEnv('rag-orchestrator');
    const resolved = getResolvedGenerationProfileEnv();
    assert.equal(resolved.writingModel, 'base-model');
    assert.equal(resolved.utilityModel, 'base-model');
    assert.equal(resolved.utilityTemperature, 0.65);
    assert.equal(resolved.writingTemperature, 0.7);
    assert.equal(resolved.writingFrequencyPenalty, undefined);
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

test('assertGenerationProfileEnv rejects invalid temperature', () => {
  const prev = {
    writingTemp: process.env.PROVIDER_TEMPERATURE_WRITING,
    skip: process.env.AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION,
  };
  try {
    delete process.env.AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION;
    process.env.PROVIDER_TEMPERATURE_WRITING = '9';
    assert.throws(
      () => assertGenerationProfileEnv('rag-orchestrator'),
      /Generation profile environment validation failed/
    );
  } finally {
    if (prev.writingTemp === undefined) delete process.env.PROVIDER_TEMPERATURE_WRITING;
    else process.env.PROVIDER_TEMPERATURE_WRITING = prev.writingTemp;
    if (prev.skip === undefined) delete process.env.AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION;
    else process.env.AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION = prev.skip;
  }
});

test('clampWritingGenerationTemperature clamps to [0, 2]', () => {
  assert.equal(clampWritingGenerationTemperature(3), 2);
  assert.equal(clampWritingGenerationTemperature(-1), 0);
  assert.equal(clampWritingGenerationTemperature(0.95), 0.95);
});

test('resolveGenerationTierForTemplateKey maps writing vs utility tasks', () => {
  assert.equal(resolveGenerationTierForTemplateKey('write.chapter'), 'writing');
  assert.equal(resolveGenerationTierForTemplateKey('chapter.pipeline.sensory.rewrite'), 'writing');
  assert.equal(resolveGenerationTierForTemplateKey('chapter.pipeline.rules.fix'), 'writing');
  assert.equal(resolveGenerationTierForTemplateKey('chapter.pipeline.sensory.outline'), 'utility');
  assert.equal(resolveGenerationTierForTemplateKey('chapter.pipeline.brief.synthesize'), 'utility');
  assert.equal(resolveGenerationTierForTemplateKey(''), 'utility');
  assert.equal(isWritingTierTemplateKey('chapter.optimize.plan'), false);
});

test('resolveGenerationCallProfile uses built-in defaults; project overrides when no user prefs', () => {
  const env = {
    fallbackModel: 'base',
    writingModel: 'writing-env',
    utilityModel: 'utility-env',
    writingTemperature: 0.9,
    utilityTemperature: 0.35,
    writingFrequencyPenalty: 0.3,
  };
  const writing = resolveGenerationCallProfile({
    templateKey: 'chapter.pipeline.sensory.rewrite',
    env,
  });
  assert.equal(writing.tier, 'writing');
  assert.equal(writing.model, 'deepseek-v4-flash');
  assert.equal(writing.temperature, 0.7);
  assert.equal(writing.frequencyPenalty, 0.3);

  const utility = resolveGenerationCallProfile({
    templateKey: 'chapter.pipeline.sensory.outline',
    env,
    projectOverrides: {
      generationUtilityModel: 'project-utility',
      generationTemperature: 0.25,
    },
  });
  assert.equal(utility.tier, 'utility');
  assert.equal(utility.model, 'project-utility');
  assert.equal(utility.temperature, 0.25);
  assert.equal(utility.frequencyPenalty, undefined);
});
