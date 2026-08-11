import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BUILTIN_CHAT_MODEL,
  normalizeUserGenerationPreferences,
} from './user-generation-preferences';

test('normalizeUserGenerationPreferences fills built-in defaults for empty input', () => {
  const prefs = normalizeUserGenerationPreferences({});
  assert.equal(prefs.writing.provider, 'deepseek');
  assert.equal(prefs.writing.model, DEFAULT_BUILTIN_CHAT_MODEL);
  assert.equal(prefs.writing.temperature, 0.7);
  assert.equal(prefs.utility.provider, 'deepseek');
  assert.equal(prefs.utility.model, DEFAULT_BUILTIN_CHAT_MODEL);
  assert.equal(prefs.utility.temperature, 0.7);
});

test('normalizeUserGenerationPreferences materializes null model and temperature', () => {
  const prefs = normalizeUserGenerationPreferences({
    writing: { provider: 'deepseek', model: null, temperature: null },
    utility: { provider: 'siliconflow', model: null, temperature: null },
  });
  assert.equal(prefs.writing.model, DEFAULT_BUILTIN_CHAT_MODEL);
  assert.equal(prefs.writing.temperature, 0.7);
  assert.equal(prefs.utility.provider, 'siliconflow');
  assert.equal(prefs.utility.model, DEFAULT_BUILTIN_CHAT_MODEL);
  assert.equal(prefs.utility.temperature, 0.7);
});

test('normalizeUserGenerationPreferences keeps writing and utility providers and models', () => {
  const prefs = normalizeUserGenerationPreferences({
    writing: {
      provider: 'siliconflow',
      model: 'Qwen/Qwen2.5-72B-Instruct',
      temperature: 0.85,
    },
    utility: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      temperature: 0.4,
    },
  });
  assert.equal(prefs.writing.provider, 'siliconflow');
  assert.equal(prefs.writing.model, 'Qwen/Qwen2.5-72B-Instruct');
  assert.equal(prefs.writing.temperature, 0.85);
  assert.equal(prefs.utility.provider, 'deepseek');
  assert.equal(prefs.utility.model, 'deepseek-chat');
  assert.equal(prefs.utility.temperature, 0.4);
});

test('normalizeUserGenerationPreferences rejects unknown provider', () => {
  assert.throws(
    () =>
      normalizeUserGenerationPreferences({
        writing: { provider: 'openai' as never, model: null, temperature: null },
      }),
    /provider/
  );
});
